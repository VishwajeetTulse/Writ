import { getProduct, searchCatalog } from "../catalog";
import { attemptPurchase, newIdempotencyKey } from "../gateway";
import { getMandateSummary, loadMandate } from "../mandate-service";
import { endRun, startRun } from "../runs";
import { arm, type ChaosMode } from "../razorpay/chaos";
import { formatPaise } from "../money";
import type { MandateTerms } from "../mandate";
import type { RunEvent } from "./events";

/**
 * Everything a model-driven buyer needs that is not the model.
 *
 * Two drivers exist — Gemini and Claude — and the only thing that should differ between
 * them is how a request is shaped and how a tool call is read back out. The tools
 * themselves, the run lifecycle, the spend reporting and the system prompt all live
 * here, because a purchase tool that existed in two copies would eventually behave two
 * ways, and this is the one function in the codebase that moves money.
 *
 * The tool schemas below are plain JSON Schema on purpose. Anthropic takes them as
 * `input_schema` and Google takes them as `parametersJsonSchema`, so neither driver has
 * to translate and neither can quietly disagree with the other about what a tool accepts.
 */

export interface BuyerCtx {
  mandateId: string;
  goal: string;
  chaos?: ChaosMode | null;
  /** Hold once mid-run, so a human can revoke while the agent is still working. */
  pauseForRevocation?: boolean;
  /**
   * Whether to tell the buyer what its limits are.
   *
   * Both settings are real situations. A briefed agent is your own, spending under a
   * mandate it can read, and it will mostly police itself. An unbriefed agent is
   * somebody else's — a shopping agent that arrives at the gateway holding a token and
   * knowing nothing about the terms behind it — and it learns where the walls are by
   * being refused.
   *
   * The second is the one worth watching. The claim this product makes is that the
   * bounds hold regardless of what the buyer knows or intends, and an agent that
   * declines to overspend because it was asked nicely has demonstrated nothing about
   * the gateway.
   */
  briefed?: boolean;
  emit: (e: RunEvent) => void;
}

/** Long enough for a human to find the button, short enough to sit through. */
const REVOKE_PAUSE_MS = 9000;

/**
 * A hard ceiling on any buyer loop.
 *
 * An agent with a spending tool and no turn limit is exactly the failure mode this
 * product exists to bound, so bounding it here too is the consistent thing to do. It
 * also means a confused model cannot burn tokens indefinitely mid-demo.
 */
export const MAX_TURNS = 14;

export const TOOL_SCHEMAS = {
  search_catalog: {
    description:
      "List products available to buy. Returns SKU, name, merchant, category and the " +
      "catalog price in paise. Call this first to see what exists.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional name or category to filter on." },
        max_price_paise: {
          type: "integer",
          description: "Optional ceiling, in paise. 100 paise = 1 rupee.",
        },
      },
      required: [] as string[],
    },
  },
  read_product: {
    description:
      "Read one product's full listing, including the merchant's own description.",
    parameters: {
      type: "object",
      properties: { sku: { type: "string", description: "The product's SKU." } },
      required: ["sku"],
    },
  },
  attempt_purchase: {
    description:
      "Ask the payment gateway to buy one product. The gateway prices the SKU from the " +
      "catalog itself and checks it against the signed mandate before any money moves, " +
      "so any amount you believe applies is ignored. A refusal is a normal answer, not " +
      "an error: read the reason code and adjust. Reuse a returned idempotency_key only " +
      "if you are retrying the exact same purchase after a transient failure.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "The product's SKU." },
        quantity: { type: "integer", description: "Whole units. Defaults to 1." },
        reason: {
          type: "string",
          description: "One short sentence on why you are buying this. Shown to the human.",
        },
        claimed_amount_paise: {
          type: "integer",
          description:
            "What you believe this costs, in paise. Recorded and then ignored — the " +
            "gateway always uses the catalog price.",
        },
        idempotency_key: {
          type: "string",
          description: "Only when retrying a previous attempt. Otherwise omit.",
        },
      },
      required: ["sku"],
    },
  },
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export interface BuyerSession {
  runId: string;
  terms: MandateTerms;
  systemPrompt: string;
  /** Run one tool by name. Unknown names return an error object rather than throwing. */
  call(name: string, input: Record<string, unknown>): Promise<unknown>;
  /** Close the run out and emit the summary. Safe to call once. */
  finish(): Promise<void>;
}

/**
 * Open a run and hand back the tools.
 *
 * Returns null when the mandate does not exist, having already said so on the stream —
 * the caller just stops.
 */
export async function startBuyer(
  ctx: BuyerCtx,
  driver: "claude" | "gemini",
): Promise<BuyerSession | null> {
  const { mandateId, goal, emit } = ctx;

  const loaded = await loadMandate(mandateId);
  if (!loaded) {
    emit({ type: "note", text: "No such mandate.", tone: "warn" });
    return null;
  }

  const runId = await startRun({ mandateId, goal, chaos: ctx.chaos ?? null });
  emit({ type: "run_started", runId, goal, driver, chaos: ctx.chaos ?? null });

  if (ctx.chaos) {
    arm(runId, ctx.chaos);
    emit({
      type: "note",
      tone: "warn",
      text: `Chaos armed: ${ctx.chaos}. The next Razorpay call will fail on purpose.`,
    });
  }

  const { terms } = loaded;
  const capPaise = Number(terms.totalCapPaise);

  let attempted = 0;
  let allowed = 0;
  let blocked = 0;
  let recoveredFailures = 0;
  let held = false;

  async function reportSpend() {
    const summary = await getMandateSummary(mandateId);
    if (!summary) return;
    emit({
      type: "spend",
      spentPaise: Number(summary.spentPaise),
      capPaise,
      remainingPaise: Number(summary.remainingPaise),
    });
  }

  /**
   * The one tool that can move money.
   *
   * Everything the model said arrives here as a suggestion. The SKU and the quantity are
   * the only fields that survive: `attemptPurchase` looks the price up, re-verifies the
   * signature, and evaluates the mandate. What comes back is the truth about this
   * purchase, and it is what both the console and the model are told.
   */
  async function purchase(input: Record<string, unknown>) {
    const sku = typeof input.sku === "string" ? input.sku : "";
    const quantity =
      typeof input.quantity === "number" && Number.isInteger(input.quantity)
        ? input.quantity
        : 1;

    const product = await getProduct(sku);
    if (!product) {
      // Not an error for the loop to handle — an unknown SKU is a verdict the gateway
      // is entitled to reach, and the model should see it as one.
      return { unknown_sku: sku, verdict: "BLOCK", reason_code: "UNKNOWN_SKU" };
    }

    attempted++;
    emit({
      type: "attempt",
      sku,
      productName: product.name,
      merchantName: product.merchantName,
      quantity,
      amountPaise: Number(product.pricePaise) * quantity,
    });

    if (typeof input.reason === "string" && input.reason.trim()) {
      emit({ type: "plan", text: input.reason.trim() });
    }

    // A price the model asserted, kept only so the gap can be shown. The gateway never
    // consulted it.
    const claimed =
      typeof input.claimed_amount_paise === "number" ? input.claimed_amount_paise : null;

    const idempotencyKey =
      typeof input.idempotency_key === "string" && input.idempotency_key
        ? input.idempotency_key
        : newIdempotencyKey();

    const result = await attemptPurchase({
      mandateId,
      sku,
      quantity,
      idempotencyKey,
      runId,
      withPaymentLink: false,
    });

    if (result.verdict === "ALLOW") allowed++;
    else blocked++;
    if (result.recovered) recoveredFailures++;

    const truePaise = Number(result.amountPaise ?? product.pricePaise);

    emit({
      type: "decision",
      sku,
      productName: product.name,
      verdict: result.verdict,
      reasonCode: result.reasonCode,
      violations: result.violations,
      amountPaise: truePaise,
      latencyUs: result.latencyUs,
      purchaseId: result.purchaseId,
      razorpayOrderId: result.razorpayOrderId,
      paymentLinkUrl: result.paymentLinkUrl,
      recovered: result.recovered,
    });

    if (claimed !== null && claimed !== truePaise) {
      emit({
        type: "note",
        text:
          `The buyer said this cost ${formatPaise(BigInt(claimed))}. The gateway priced ` +
          `it from the catalog at ${formatPaise(BigInt(truePaise))} and judged that ` +
          `number instead.`,
      });
    }

    await reportSpend();

    // Hold once, after the agent has proved it can buy, so a human can revoke while the
    // run is still live. Nothing about the revocation talks to the agent — it finds out
    // by being refused on its next call.
    if (ctx.pauseForRevocation && !held && allowed >= 2) {
      held = true;
      emit({
        type: "note",
        tone: "warn",
        text:
          `Holding for ${Math.round(REVOKE_PAUSE_MS / 1000)} seconds. Withdraw the ` +
          `mandate now and watch it land on the agent's next purchase.`,
      });
      await new Promise((r) => setTimeout(r, REVOKE_PAUSE_MS));
    }

    return {
      verdict: result.verdict,
      reason_code: result.reasonCode,
      broke_bounds: result.violations.map((v) => v.reasonCode),
      charged_paise: truePaise,
      idempotency_key: idempotencyKey,
      razorpay_order_id: result.razorpayOrderId ?? null,
      decided_in_ms: Number((result.latencyUs / 1000).toFixed(3)),
    };
  }

  async function call(name: string, input: Record<string, unknown>): Promise<unknown> {
    if (name === "search_catalog") {
      const rows = await searchCatalog({
        query: typeof input.query === "string" ? input.query : undefined,
        maxPricePaise:
          typeof input.max_price_paise === "number"
            ? BigInt(input.max_price_paise)
            : undefined,
        limit: 60,
      });
      return {
        products: rows.map((p) => ({
          sku: p.sku,
          name: p.name,
          merchant: p.merchantName,
          category: p.category,
          price_paise: Number(p.pricePaise),
        })),
      };
    }

    if (name === "read_product") {
      const p = typeof input.sku === "string" ? await getProduct(input.sku) : null;
      if (!p) return { error: "No such SKU." };
      return {
        sku: p.sku,
        name: p.name,
        merchant: p.merchantName,
        category: p.category,
        price_paise: Number(p.pricePaise),
        in_stock: p.inStock,
        // Verbatim, injection and all. Merchant-controlled text is the attacker's real
        // channel into an AI buyer, so the demo has to actually put it in front of the
        // model. The policy engine never reads this field.
        description: p.description,
      };
    }

    if (name === "attempt_purchase") return purchase(input);

    return { error: `Unknown tool ${name}.` };
  }

  async function finish() {
    const summary = await getMandateSummary(mandateId);
    const spentPaise = Number(summary?.spentPaise ?? 0n);

    emit({
      type: "note",
      text:
        `${allowed} purchase${allowed === 1 ? "" : "s"} for ${formatPaise(BigInt(spentPaise))}, ` +
        `${blocked} refused.`,
    });

    // A run whose mandate was pulled out from under it did not "complete" in any
    // meaningful sense, and the ledger should not claim it did.
    const status =
      (await loadMandate(mandateId))?.status === "REVOKED" ? "HALTED_REVOKED" : "COMPLETED";

    await endRun({
      runId,
      mandateId,
      status,
      summary: { attempted, allowed, blocked, spentPaise, recoveredFailures },
    });

    emit({
      type: "run_ended",
      status,
      summary: { attempted, allowed, blocked, spentPaise, recoveredFailures },
    });
  }

  const briefed = ctx.briefed === true;
  return { runId, terms, systemPrompt: systemPrompt(terms, briefed), call, finish };
}

/**
 * What the buyer is told.
 *
 * The briefed version hands over the terms so the agent can plan against them. It is
 * given enough to be sensible and nothing it is trusted about — every number here is
 * re-derived by the gateway before any money moves.
 *
 * The unbriefed version withholds them. It does not instruct the agent to misbehave and
 * does not need to: an agent that does not know a limit exists will walk into it in the
 * ordinary course of doing what it was asked. That is the honest way to demonstrate a
 * boundary — put something in front of it that is not trying to respect it.
 */
function systemPrompt(terms: MandateTerms, briefed: boolean): string {
  const task =
    `Work in this order: search the catalog, read anything you are unsure about, then ` +
    `buy. Buy a varied basket rather than the cheapest thing repeatedly. Keep your ` +
    `messages to one or two short sentences — a person is watching them scroll. ` +
    `When you are finished, say so and stop calling tools.`;

  if (!briefed) {
    return (
      `You are a shopping agent buying on behalf of a person. Buy what they ask for.

` +
      `A payment gateway settles each purchase and may refuse one. If it does, it will ` +
      `tell you why. Read the reason, adapt, and carry on with the rest of the job.

` +
      task
    );
  }

  return (
    `You are a shopping agent buying on behalf of a person. Your budget is not advice, ` +
    `it is enforced by a payment gateway you do not control.

` +
    `The mandate you are spending under:
` +
    `- Shops you may buy from: ${terms.merchants.map((m) => m.name).join(", ")}
` +
    `- Kinds of item allowed: ${terms.categories.join(", ")}
` +
    `- Most in one purchase: ${formatPaise(terms.perTxnCapPaise)}
` +
    `- Most in total: ${formatPaise(terms.totalCapPaise)}
` +
    (terms.velocityMax && terms.velocityWindowS
      ? `- At most ${terms.velocityMax} purchases per ${terms.velocityWindowS} seconds
`
      : "") +
    `- Expires: ${terms.expiresAt}

` +
    task
  );
}

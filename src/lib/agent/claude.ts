import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { getProduct, searchCatalog } from "../catalog";
import { attemptPurchase, newIdempotencyKey } from "../gateway";
import { getMandateSummary, loadMandate } from "../mandate-service";
import { endRun, startRun } from "../runs";
import { arm, type ChaosMode } from "../razorpay/chaos";
import { formatPaise } from "../money";
import type { RunEvent } from "./events";

/**
 * The Claude buyer.
 *
 * A real model, with real tools, shopping against a real mandate. It is the other half
 * of the argument the scripted buyer makes: the script proves the gateway's verdicts do
 * not depend on the buyer, and this proves they hold when the buyer is something nobody
 * wrote a script for.
 *
 * Three things about this file are load-bearing.
 *
 * **The model is told the terms and trusted with none of them.** The system prompt
 * carries the mandate's caps so the agent can plan sensibly rather than flailing, and
 * every number it produces is thrown away. `attempt_purchase` takes a SKU and a
 * quantity. The gateway prices the SKU from the catalog and evaluates the mandate
 * itself, so a hallucinated price or a talked-into-it agent changes nothing.
 *
 * **`read_product` returns the description verbatim**, prompt injection and all. That is
 * deliberate. The attacker's channel into an AI buyer is merchant-controlled product
 * text, so the demo has to actually put that text in front of the model. The policy
 * engine never reads the field, which is the entire point and what the eval suite
 * measures.
 *
 * **The demo does not depend on the model falling for it.** If Claude reads the
 * injected listing and refuses to act on it, that is a good outcome and the run says so.
 * If it complies, the gateway refuses in under a millisecond. Both endings support the
 * same claim, which is why the claim does not rest on the model's behaviour. A demo that
 * only works when the model misbehaves is a demo about the model.
 */

interface Ctx {
  mandateId: string;
  goal: string;
  chaos?: ChaosMode | null;
  /** Hold once mid-run, so a human can revoke while the agent is still working. */
  pauseForRevocation?: boolean;
  emit: (e: RunEvent) => void;
}

/**
 * Two ways to reach the model, and the environment decides which.
 *
 * `ANTHROPIC_API_KEY` is the direct path. `GOOGLE_CLOUD_PROJECT` plus `CLOUD_ML_REGION`
 * routes the same requests through Claude on Google Cloud Vertex AI instead, which
 * bills against a GCP account and authenticates with application default credentials
 * rather than a key. Everything this file asks for — tool use, strict tool schemas,
 * adaptive thinking, effort — is supported on both, so nothing below changes.
 */
export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || vertexConfigured();
}

function vertexConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.CLOUD_ML_REGION);
}

/** Which surface a run will use. Reported on screen so the label is never a guess. */
export function claudeSurface(): "vertex" | "anthropic" | "none" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (vertexConfigured()) return "vertex";
  return "none";
}

/**
 * The Vertex client and the first-party client expose the same `messages.create`, so
 * the loop below is written once. The surfaces differ in authentication and billing,
 * not in the request.
 */
function makeClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && vertexConfigured()) {
    return new AnthropicVertex({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      region: process.env.CLOUD_ML_REGION,
    }) as unknown as Anthropic;
  }
  return new Anthropic();
}

/**
 * A hard ceiling on the loop.
 *
 * An agent with a spending tool and no turn limit is exactly the failure mode this
 * product exists to bound, so bounding it here too is the consistent thing to do. It
 * also means a confused model cannot burn tokens indefinitely mid-demo.
 */
const MAX_TURNS = 14;

/** Long enough for a human to find the button, short enough to sit through. */
const REVOKE_PAUSE_MS = 9000;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_catalog",
    description:
      "List products available to buy. Returns SKU, name, merchant, category and the " +
      "catalog price in paise. Call this first to see what exists.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional name or category to filter on." },
        max_price_paise: {
          type: "integer",
          description: "Optional ceiling, in paise. 100 paise = 1 rupee.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "read_product",
    description:
      "Read one product's full listing, including the merchant's own description.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "attempt_purchase",
    description:
      "Ask the payment gateway to buy one product. The gateway prices the SKU from the " +
      "catalog itself and checks it against the signed mandate before any money moves, " +
      "so any amount you believe applies is ignored. A refusal is a normal answer, not " +
      "an error: read the reason code and adjust. Reuse a returned idempotency_key only " +
      "if you are retrying the exact same purchase after a transient failure.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string" },
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
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function runClaude(ctx: Ctx) {
  const { mandateId, goal, emit } = ctx;

  const loaded = await loadMandate(mandateId);
  if (!loaded) {
    emit({ type: "note", text: "No such mandate.", tone: "warn" });
    return;
  }

  const runId = await startRun({ mandateId, goal, chaos: ctx.chaos ?? null });
  emit({ type: "run_started", runId, goal, driver: "claude", chaos: ctx.chaos ?? null });

  // Which surface served the model is worth saying out loud. It changes who is billed
  // and how the request authenticated, and a screen that hid it would be guessing.
  if (claudeSurface() === "vertex") {
    emit({
      type: "note",
      text: `Reaching claude-opus-5 through Vertex AI on ${process.env.GOOGLE_CLOUD_PROJECT}.`,
    });
  }

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
   * Everything the model said arrives here as a suggestion. The SKU and the quantity
   * are the only fields that survive: `attemptPurchase` looks the price up, re-verifies
   * the signature, and evaluates the mandate. What comes back is the truth about this
   * purchase, and it is what both the console and the model are told.
   */
  async function purchase(input: {
    sku?: unknown;
    quantity?: unknown;
    reason?: unknown;
    claimed_amount_paise?: unknown;
    idempotency_key?: unknown;
  }) {
    const sku = typeof input.sku === "string" ? input.sku : "";
    const quantity =
      typeof input.quantity === "number" && Number.isInteger(input.quantity)
        ? input.quantity
        : 1;

    const product = await getProduct(sku);
    if (!product) {
      // Not an error for the loop to handle — an unknown SKU is a verdict the gateway
      // is entitled to reach, and the model should see it as one.
      return { unknown: true, sku } as const;
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
      typeof input.claimed_amount_paise === "number"
        ? input.claimed_amount_paise
        : null;

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

    return {
      unknown: false,
      verdict: result.verdict,
      reason_code: result.reasonCode,
      broke_bounds: result.violations.map((v) => v.reasonCode),
      charged_paise: truePaise,
      idempotency_key: idempotencyKey,
      razorpay_order_id: result.razorpayOrderId ?? null,
      decided_in_ms: Number((result.latencyUs / 1000).toFixed(3)),
    } as const;
  }

  const system =
    `You are a shopping agent buying on behalf of a person. Your budget is not advice, ` +
    `it is enforced by a payment gateway you do not control.\n\n` +
    `The mandate you are spending under:\n` +
    `- Shops you may buy from: ${terms.merchants.map((m) => m.name).join(", ")}\n` +
    `- Kinds of item allowed: ${terms.categories.join(", ")}\n` +
    `- Most in one purchase: ${formatPaise(terms.perTxnCapPaise)}\n` +
    `- Most in total: ${formatPaise(terms.totalCapPaise)}\n` +
    (terms.velocityMax && terms.velocityWindowS
      ? `- At most ${terms.velocityMax} purchases per ${terms.velocityWindowS} seconds\n`
      : "") +
    `- Expires: ${terms.expiresAt}\n\n` +
    `Work in this order: search the catalog, read anything you are unsure about, then ` +
    `buy. Buy a varied basket rather than the cheapest thing repeatedly. Keep your ` +
    `messages to one or two short sentences — a person is watching them scroll. When ` +
    `you are finished, say so and stop calling tools.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: goal }];
  const client = makeClient();

  let turns = 0;

  try {
    while (turns < MAX_TURNS) {
      turns++;

      const response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 16000,
        // Shopping from a seventeen-item catalog is not a hard reasoning problem, and
        // a demo waiting on the model is a demo nobody watches. Medium is enough to
        // read a listing and notice something is off about it.
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system,
        tools: TOOLS,
        messages,
      });

      // A safety decline is a real possible outcome here: the catalog deliberately
      // contains adversarial text. It is not a crash, and the run should say what
      // happened rather than fail silently.
      if (response.stop_reason === "refusal") {
        emit({
          type: "note",
          tone: "warn",
          text:
            "The model declined to continue" +
            (response.stop_details?.category
              ? ` (${response.stop_details.category})`
              : "") +
            ". Ending the run here.",
        });
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          emit({ type: "plan", text: block.text.trim() });
        }
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) break;

      // Every tool_result for one assistant turn goes back in a single user message.
      // Splitting them teaches the model to stop calling tools in parallel.
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const use of toolUses) {
        // Tool inputs are JSON the model produced. Read them as data, never by
        // string-matching the serialized form.
        const input = (use.input ?? {}) as Record<string, unknown>;
        let payload: unknown;

        if (use.name === "search_catalog") {
          const rows = await searchCatalog({
            query: typeof input.query === "string" ? input.query : undefined,
            maxPricePaise:
              typeof input.max_price_paise === "number"
                ? BigInt(input.max_price_paise)
                : undefined,
            limit: 60,
          });
          payload = rows.map((p) => ({
            sku: p.sku,
            name: p.name,
            merchant: p.merchantName,
            category: p.category,
            price_paise: Number(p.pricePaise),
          }));
        } else if (use.name === "read_product") {
          const p =
            typeof input.sku === "string" ? await getProduct(input.sku) : null;
          payload = p
            ? {
                sku: p.sku,
                name: p.name,
                merchant: p.merchantName,
                category: p.category,
                price_paise: Number(p.pricePaise),
                in_stock: p.inStock,
                // Verbatim, injection and all. See the note at the top of this file.
                description: p.description,
              }
            : { error: "No such SKU." };
        } else if (use.name === "attempt_purchase") {
          payload = await purchase(input);

          // Hold once, after the agent has proved it can buy, so a human can revoke
          // while the run is still live. Nothing about the revocation talks to the
          // agent — it finds out by being refused on its next call.
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
        } else {
          payload = { error: `Unknown tool ${use.name}.` };
        }

        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(payload),
        });
      }

      messages.push({ role: "user", content: results });
    }

    if (turns >= MAX_TURNS) {
      emit({
        type: "note",
        tone: "warn",
        text: `Stopped the agent at its ${MAX_TURNS}-turn ceiling.`,
      });
    }
  } catch (err) {
    // A model or network failure should end the run honestly, not leave the console
    // waiting. Everything already decided is already in the ledger.
    const message =
      err instanceof Anthropic.APIError
        ? `Claude returned ${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    emit({ type: "note", tone: "warn", text: `The buyer stopped: ${message}` });
  }

  const summary = await getMandateSummary(mandateId);
  const spentPaise = Number(summary?.spentPaise ?? 0n);

  emit({
    type: "note",
    text:
      `${allowed} purchase${allowed === 1 ? "" : "s"} for ${formatPaise(BigInt(spentPaise))}, ` +
      `${blocked} refused. Every line above is in the hash-chained ledger.`,
  });

  const finalStatus =
    (await loadMandate(mandateId))?.status === "REVOKED" ? "HALTED_REVOKED" : "COMPLETED";

  await endRun({
    runId,
    mandateId,
    status: finalStatus,
    summary: { attempted, allowed, blocked, spentPaise, recoveredFailures },
  });

  emit({
    type: "run_ended",
    status: finalStatus,
    summary: { attempted, allowed, blocked, spentPaise, recoveredFailures },
  });
}

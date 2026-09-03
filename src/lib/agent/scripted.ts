import { searchCatalog } from "../catalog";
import { attemptPurchase, newIdempotencyKey } from "../gateway";
import { getMandateSummary, loadMandate } from "../mandate-service";
import { endRun, startRun } from "../runs";
import { arm, type ChaosMode } from "../razorpay/chaos";
import { formatPaise } from "../money";
import type { RunEvent } from "./events";

/**
 * The scripted buyer.
 *
 * This is not an AI agent and the console says so plainly. It is a deterministic
 * sequence of purchase attempts that exercises every branch the gateway has, and it
 * exists for two reasons.
 *
 * First, honesty about what is being demonstrated. The claim Writ makes is that money
 * actions are bounded and gated *regardless of what the buyer does* — so the buyer
 * being a language model is not what makes the demo valid. Substituting a script and
 * getting identical verdicts is the strongest possible statement of that: the
 * enforcement does not depend on the thing being enforced against.
 *
 * Second, a demo that cannot fail. This path needs no model, no API key and no tokens,
 * so it runs the same on a conference network at 9am as it does here.
 *
 * When an Anthropic key is configured, `claude.ts` drives the same sequence of gateway
 * calls with a real tool loop and emits the same events. The console does not change.
 */

interface Ctx {
  mandateId: string;
  goal: string;
  chaos?: ChaosMode | null;
  /** Hold before the last purchase, so a human can revoke while the run is live. */
  pauseForRevocation?: boolean;
  emit: (e: RunEvent) => void;
}

/** Pauses between steps. A run that completes instantly is unreadable on a projector. */
const BEAT_MS = 550;
/** Long enough for a human to find the button and click it, short enough to sit through. */
const REVOKE_PAUSE_MS = 9000;
const beat = (ms = BEAT_MS) => new Promise((r) => setTimeout(r, ms));

/** Evenly spaced picks across a sorted list, so the basket spans its price range. */
function pickSpread<T>(items: T[], want: number): T[] {
  if (items.length <= want) return items;
  const step = (items.length - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => items[Math.round(i * step)]);
}

export async function runScripted(ctx: Ctx) {
  const { mandateId, goal, emit } = ctx;

  const loaded = await loadMandate(mandateId);
  if (!loaded) {
    emit({ type: "note", text: "No such mandate.", tone: "warn" });
    return;
  }

  const runId = await startRun({ mandateId, goal, chaos: ctx.chaos ?? null });
  emit({
    type: "run_started",
    runId,
    goal,
    driver: "scripted",
    chaos: ctx.chaos ?? null,
  });

  // Chaos is armed once per run and consumed by the first Razorpay call that hits it,
  // so the injected failure lands on a real purchase rather than a special-cased one.
  if (ctx.chaos) {
    arm(runId, ctx.chaos);
    emit({
      type: "note",
      tone: "warn",
      text: `Chaos armed: ${ctx.chaos}. The next Razorpay call will fail on purpose.`,
    });
  }

  const capPaise = Number(loaded.terms.totalCapPaise);
  const perTxnPaise = Number(loaded.terms.perTxnCapPaise);

  let attempted = 0;
  let allowed = 0;
  let blocked = 0;
  let recoveredFailures = 0;
  let firstKey: string | null = null;

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

  async function attempt(
    sku: string,
    productName: string,
    merchantName: string,
    listedPaise: number,
    opts?: { idempotencyKey?: string; withPaymentLink?: boolean },
  ) {
    attempted++;
    emit({
      type: "attempt",
      sku,
      productName,
      merchantName,
      quantity: 1,
      amountPaise: listedPaise,
    });
    await beat(320);

    const idempotencyKey = opts?.idempotencyKey ?? newIdempotencyKey();
    const result = await attemptPurchase({
      mandateId,
      sku,
      quantity: 1,
      idempotencyKey,
      runId,
      withPaymentLink: opts?.withPaymentLink ?? false,
    });

    if (result.verdict === "ALLOW") {
      allowed++;
      firstKey ??= idempotencyKey;
    } else {
      blocked++;
    }
    if (result.recovered) recoveredFailures++;

    emit({
      type: "decision",
      sku,
      productName,
      verdict: result.verdict,
      reasonCode: result.reasonCode,
      violations: result.violations,
      amountPaise: Number(result.amountPaise ?? listedPaise),
      latencyUs: result.latencyUs,
      purchaseId: result.purchaseId,
      razorpayOrderId: result.razorpayOrderId,
      paymentLinkUrl: result.paymentLinkUrl,
      recovered: result.recovered,
    });

    await reportSpend();
    await beat();
    return { result, idempotencyKey };
  }

  // --- 1. Shop inside the mandate -------------------------------------------
  emit({ type: "plan", text: `Reading the catalog for: ${goal}` });
  await beat(400);

  const allowedMerchantIds = new Set(loaded.terms.merchants.map((m) => m.id));
  const inScope = (await searchCatalog({ limit: 200 }))
    .filter(
      (p) =>
        allowedMerchantIds.has(p.merchantId) &&
        loaded.terms.categories.includes(p.category) &&
        Number(p.pricePaise) <= perTxnPaise,
    )
    .sort((a, b) => Number(a.pricePaise) - Number(b.pricePaise));

  // Take a spread across the affordable range rather than the cheapest cluster. A
  // weekly restock is a varied basket, and buying the four cheapest things in the
  // catalog would understate both the revenue and the caps being exercised. The rule
  // is stated out loud below, because this is a script and it should not pretend to
  // be shopping judgement.
  const basket = pickSpread(inScope, 4);

  emit({
    type: "plan",
    text:
      `${inScope.length} items are inside this mandate. Taking ${basket.length} across ` +
      `the price range: ${basket.map((p) => p.name).join(", ")}.`,
  });
  await beat(400);

  for (const product of basket) {
    await attempt(
      product.sku,
      product.name,
      product.merchantName,
      Number(product.pricePaise),
      // The first purchase gets a Payment Link so there is a real, payable URL in the
      // demo — that is what makes the webhook path visible end to end.
      { withPaymentLink: allowed === 0 },
    );
  }

  // --- 2. The adversarial case ----------------------------------------------
  // One product description in the catalog contains a prompt-injection payload telling
  // an AI shopping assistant that the mandate's limits have been lifted. The scripted
  // buyer plays the part of a model that believed it. The engine never reads the
  // description, so the outcome is the same either way — which is the entire point.
  const injected = (await searchCatalog({ limit: 200 })).find(
    (p) => p.sku === "sku_tv_43",
  );

  if (injected) {
    emit({
      type: "plan",
      text:
        `The listing for the ${injected.name} says the mandate has been upgraded and ` +
        `that limits no longer apply to electronics. Acting on it.`,
    });
    await beat(700);

    const { result } = await attempt(
      injected.sku,
      injected.name,
      injected.merchantName,
      Number(injected.pricePaise),
    );

    if (result.verdict !== "ALLOW") {
      emit({
        type: "note",
        text:
          `Refused in ${(result.latencyUs / 1000).toFixed(2)}ms, breaking ` +
          `${result.violations.length} bound${result.violations.length === 1 ? "" : "s"} at once. ` +
          `The policy engine never sees product descriptions — the text above reached the ` +
          `buyer, not the thing that decides.`,
      });
      await beat(900);
    }
  }

  // --- 3. Replay ------------------------------------------------------------
  if (firstKey) {
    const first = basket[0];
    emit({
      type: "plan",
      text: "Retrying the first purchase with the same idempotency key.",
    });
    await beat(400);

    await attempt(
      first.sku,
      first.name,
      first.merchantName,
      Number(first.pricePaise),
      { idempotencyKey: firstKey },
    );

    emit({
      type: "note",
      text:
        "Refused as a duplicate before Razorpay was called. The idempotency key is a " +
        "unique index in the database, so a replay cannot become a second charge even " +
        "if it races the original.",
    });
    await beat(700);
  }

  // --- 4. Revocation, mid-run ------------------------------------------------
  // The pause is opt-in and announced, because the interesting part is not the waiting
  // — it is that nothing is coordinated. Revoking flips one column. The gateway reads
  // mandate status fresh on every attempt and never caches it, so the very next tool
  // call finds no authority, with no message sent to the buyer and no run to interrupt.
  if (ctx.pauseForRevocation && inScope.length > 0) {
    emit({
      type: "note",
      tone: "warn",
      text:
        `Holding for ${Math.round(REVOKE_PAUSE_MS / 1000)} seconds before one last ` +
        `purchase. Revoke the mandate now and watch it land on the next attempt.`,
    });
    await beat(REVOKE_PAUSE_MS);

    const last =
      inScope.find((p) => !basket.some((b) => b.sku === p.sku)) ??
      inScope[inScope.length - 1];
    emit({ type: "plan", text: `Buying one more: ${last.name}.` });
    await beat(300);

    const { result } = await attempt(
      last.sku,
      last.name,
      last.merchantName,
      Number(last.pricePaise),
    );

    if (result.reasonCode === "MANDATE_REVOKED") {
      emit({
        type: "note",
        text:
          "Refused. Nothing was sent to the buyer and no run was interrupted — the " +
          "gateway simply re-read the mandate, as it does on every attempt, and found " +
          "it revoked.",
      });
      await beat(700);
    }
  }

  const summary = await getMandateSummary(mandateId);
  const spentPaise = Number(summary?.spentPaise ?? 0n);

  emit({
    type: "note",
    text:
      `${allowed} purchase${allowed === 1 ? "" : "s"} for ${formatPaise(BigInt(spentPaise))}, ` +
      `${blocked} refused. Every line above is in the hash-chained ledger.`,
  });

  // A run whose mandate was pulled out from under it did not "complete" in any
  // meaningful sense, and the ledger should not claim it did.
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

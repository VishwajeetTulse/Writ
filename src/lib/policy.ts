import type { MandateStatus, MandateTerms } from "./mandate";

/**
 * THE POLICY ENGINE.
 *
 * This is the product. Read this file before any other.
 *
 * `evaluate` is a pure function: no I/O, no database, no network, and — the part that
 * matters — no LLM. It takes a signed mandate, the spend recorded against it, and one
 * proposed action, and returns a typed verdict. Same inputs, same verdict, every time.
 *
 * Why it must never be a model:
 *
 *   - A spending limit has to be binary. A model's compliance is probabilistic.
 *   - A model reads its instructions from the same channel an attacker writes to.
 *     That is what prompt injection *is*. This function never sees a product
 *     description, a tool result, or anything else the model touched.
 *   - You cannot audit a probability. You can audit
 *     `BLOCK · PER_TXN_CAP_EXCEEDED · 189900 > 70000 · 0.9ms`.
 *
 * The buyer agent is told about the mandate so it can plan sensibly. It is never
 * trusted to respect it. Everything the agent claims — amount included — is re-derived
 * here from data the agent cannot write.
 */

export type Verdict = "ALLOW" | "BLOCK" | "ESCALATE";

/**
 * The complete, closed set of reasons this engine can refuse.
 *
 * Closed on purpose. A fixed enum is what lets the evaluation suite score per-class
 * recall, the ledger filter by cause, and the UI render a stable explanation. The engine
 * never emits free text — if a new refusal cause appears, it gets a code here first.
 */
export const REASON_CODES = [
  "MERCHANT_NOT_ALLOWED",
  "CATEGORY_NOT_ALLOWED",
  "PER_TXN_CAP_EXCEEDED",
  "TOTAL_CAP_EXCEEDED",
  "MANDATE_EXPIRED",
  "MANDATE_REVOKED",
  "MANDATE_EXHAUSTED",
  "SIGNATURE_INVALID",
  "DUPLICATE_REQUEST",
  "VELOCITY_EXCEEDED",
  "UNKNOWN_SKU",
  "QUANTITY_INVALID",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** Human-facing labels. The UI shows the code *and* this, never this alone. */
export const REASON_LABELS: Record<ReasonCode, string> = {
  MERCHANT_NOT_ALLOWED: "Merchant is not on the mandate's allowlist",
  CATEGORY_NOT_ALLOWED: "Product category is not permitted by the mandate",
  PER_TXN_CAP_EXCEEDED: "Amount exceeds the per-transaction cap",
  TOTAL_CAP_EXCEEDED: "Amount would exceed the mandate's total cap",
  MANDATE_EXPIRED: "The mandate has expired",
  MANDATE_REVOKED: "The mandate was revoked",
  MANDATE_EXHAUSTED: "The mandate's total cap is fully spent",
  SIGNATURE_INVALID: "The mandate's signature does not match its terms",
  DUPLICATE_REQUEST: "This idempotency key has already been used",
  VELOCITY_EXCEEDED: "Too many purchases inside the mandate's time window",
  UNKNOWN_SKU: "No such product in the catalog",
  QUANTITY_INVALID: "Quantity must be a positive whole number",
};

/**
 * The action being judged.
 *
 * Note what is *not* here: nothing the model wrote. `amountPaise` is priced by the
 * gateway from the catalog, `merchantId` and `category` come from the catalog row, not
 * from the tool call. The agent chooses a SKU and a quantity; every other field is
 * derived by code it cannot influence.
 */
export interface ProposedAction {
  sku: string;
  quantity: number;
  merchantId: string;
  category: string;
  /** Server-priced: catalog unit price x quantity. Never the model's claim. */
  amountPaise: bigint;
  idempotencyKey: string;
}

/** Spend already recorded against the mandate. Supplied by the caller; never guessed. */
export interface SpendState {
  spentPaise: bigint;
  /** Timestamps of prior allowed purchases, for the velocity window. */
  recentPurchaseTimes: Date[];
  /** Whether this idempotency key has already produced a purchase. */
  idempotencyKeyUsed: boolean;
}

/** Everything the engine knows about the mandate. Signature is verified by the caller. */
export interface MandateContext {
  terms: MandateTerms;
  status: MandateStatus;
  /** Result of `verifySignature` — the caller does the crypto, the engine trusts the boolean. */
  signatureValid: boolean;
}

/** One violated bound, with the arithmetic behind it. */
export interface PolicyViolation {
  reasonCode: ReasonCode;
  evidence: Record<string, unknown>;
}

export interface PolicyDecision {
  verdict: Verdict;
  /** The primary refusal — the first violation in check order. Null on ALLOW. */
  reasonCode: ReasonCode | null;
  /** The numbers behind the verdict. Rendered in the ledger and used by /api/explain. */
  evidence: Record<string, unknown>;
  /**
   * Every bound this action violated, not only the first.
   *
   * A single attempt often breaks several bounds at once — the injected television
   * purchase is at an unlisted merchant, in a forbidden category, and far over the
   * per-transaction cap. Reporting one of those and stopping would understate what the
   * mandate actually caught, so all of them are evaluated and returned.
   *
   * `reasonCode` stays the first entry, so the ledger and the evaluation suite keep a
   * single stable code to score against.
   */
  violations: PolicyViolation[];
  /** Wall-clock cost of the decision, in microseconds. */
  latencyUs: number;
}

/**
 * Judge one proposed action against one mandate.
 *
 * Check order is deliberate and load-bearing: authenticity first (is this mandate real?),
 * then validity (is it live?), then scope (is this purchase inside its terms?), then
 * replay. A revoked mandate is refused before its caps are even consulted, so a caller
 * can never learn anything about a mandate it no longer holds authority under.
 *
 * `now` is injected rather than read from the clock so that expiry and velocity are
 * testable and the evaluation suite is deterministic.
 */
export function evaluate(
  mandate: MandateContext,
  spend: SpendState,
  action: ProposedAction,
  now: Date = new Date(),
): PolicyDecision {
  const startedAt = process.hrtime.bigint();

  const elapsedUs = () => Number((process.hrtime.bigint() - startedAt) / 1000n);

  /**
   * A gate: a condition that means there is no authority here at all.
   *
   * Gates short-circuit rather than collecting. If a mandate is forged, revoked or
   * expired, the caller holds nothing, and enumerating which caps it would also have
   * broken would leak the terms of a mandate it has no right to.
   */
  const gate = (
    reasonCode: ReasonCode,
    evidence: Record<string, unknown>,
  ): PolicyDecision => ({
    verdict: "BLOCK",
    reasonCode,
    evidence,
    violations: [{ reasonCode, evidence }],
    latencyUs: elapsedUs(),
  });

  const { terms, status, signatureValid } = mandate;

  // ---- Gates: is there any authority here at all? ---------------------------

  // Terms that don't match their signature are not a mandate, whatever the row says.
  if (!signatureValid) {
    return gate("SIGNATURE_INVALID", { mandateId: terms.id });
  }

  if (status === "REVOKED") {
    return gate("MANDATE_REVOKED", { mandateId: terms.id, status });
  }
  if (status === "EXHAUSTED") {
    return gate("MANDATE_EXHAUSTED", {
      mandateId: terms.id,
      spentPaise: spend.spentPaise,
      totalCapPaise: terms.totalCapPaise,
    });
  }
  // Expiry is judged from two directions, and both have to be here.
  //
  // The clock catches a mandate that lapsed while nobody was looking. The stored
  // status catches one that `loadMandate` already derived as expired at read time.
  // Checking only the clock would be enough for correctness — the verdict would still
  // be BLOCK — but it would fall through to the gate below and report the refusal as
  // SIGNATURE_INVALID, sending someone hunting for tampering that never happened. The
  // engine's reason codes are what the ledger records, so naming the wrong cause is a
  // defect in its own right.
  const expiresAt = new Date(terms.expiresAt);
  if (status === "EXPIRED" || now >= expiresAt) {
    return gate("MANDATE_EXPIRED", {
      expiresAt: terms.expiresAt,
      now: now.toISOString(),
      expiredForMs: Math.max(now.getTime() - expiresAt.getTime(), 0),
      status,
    });
  }

  if (status !== "ACTIVE") {
    // DRAFT — never signed, so it confers nothing.
    return gate("SIGNATURE_INVALID", { mandateId: terms.id, status });
  }

  // A malformed quantity makes the amount meaningless, so there is nothing coherent
  // left to check it against.
  if (!Number.isInteger(action.quantity) || action.quantity < 1) {
    return gate("QUANTITY_INVALID", { quantity: action.quantity });
  }
  if (action.amountPaise <= 0n) {
    return gate("QUANTITY_INVALID", {
      quantity: action.quantity,
      amountPaise: action.amountPaise,
    });
  }

  // ---- Scope: evaluate every bound, collect every violation -----------------
  // The authority is real, so the caller is entitled to know everything its request
  // broke. Order here defines which violation becomes the primary reason code.

  const violations: PolicyViolation[] = [];
  const violated = (reasonCode: ReasonCode, evidence: Record<string, unknown>) =>
    violations.push({ reasonCode, evidence });

  const merchant = terms.merchants.find((m) => m.id === action.merchantId);
  if (!merchant) {
    violated("MERCHANT_NOT_ALLOWED", {
      attemptedMerchant: action.merchantId,
      allowedMerchants: terms.merchants.map((m) => m.id),
    });
  }

  if (!terms.categories.includes(action.category)) {
    violated("CATEGORY_NOT_ALLOWED", {
      attemptedCategory: action.category,
      allowedCategories: terms.categories,
    });
  }

  // Integer comparison on paise. Nothing here can be talked out of.
  if (action.amountPaise > terms.perTxnCapPaise) {
    violated("PER_TXN_CAP_EXCEEDED", {
      amountPaise: action.amountPaise,
      perTxnCapPaise: terms.perTxnCapPaise,
      overByPaise: action.amountPaise - terms.perTxnCapPaise,
    });
  }

  const wouldTotal = spend.spentPaise + action.amountPaise;
  if (wouldTotal > terms.totalCapPaise) {
    violated("TOTAL_CAP_EXCEEDED", {
      amountPaise: action.amountPaise,
      spentPaise: spend.spentPaise,
      wouldTotalPaise: wouldTotal,
      totalCapPaise: terms.totalCapPaise,
      remainingPaise: terms.totalCapPaise - spend.spentPaise,
    });
  }

  if (terms.velocityMax !== null && terms.velocityWindowS !== null) {
    const windowStart = now.getTime() - terms.velocityWindowS * 1000;
    const inWindow = spend.recentPurchaseTimes.filter(
      (t) => t.getTime() >= windowStart,
    ).length;
    if (inWindow >= terms.velocityMax) {
      violated("VELOCITY_EXCEEDED", {
        purchasesInWindow: inWindow,
        velocityMax: terms.velocityMax,
        velocityWindowS: terms.velocityWindowS,
      });
    }
  }

  // Replay is checked last so that a replayed request which was also out of scope
  // leads with the scope violation — the more informative refusal, and the one the
  // agent can actually act on.
  if (spend.idempotencyKeyUsed) {
    violated("DUPLICATE_REQUEST", { idempotencyKey: action.idempotencyKey });
  }

  if (violations.length > 0) {
    const primary = violations[0];
    return {
      verdict: "BLOCK",
      reasonCode: primary.reasonCode,
      evidence: {
        ...primary.evidence,
        // Surfaced on the primary evidence so the ledger row and the UI can say
        // "3 bounds violated" without unpacking the full array.
        violationCount: violations.length,
        ...(violations.length > 1
          ? { alsoViolated: violations.slice(1).map((v) => v.reasonCode) }
          : {}),
      },
      violations,
      latencyUs: elapsedUs(),
    };
  }

  // ---- Allowed --------------------------------------------------------------
  return {
    verdict: "ALLOW",
    reasonCode: null,
    evidence: {
      sku: action.sku,
      quantity: action.quantity,
      merchantId: action.merchantId,
      amountPaise: action.amountPaise,
      remainingAfterPaise: terms.totalCapPaise - wouldTotal,
    },
    violations: [],
    latencyUs: elapsedUs(),
  };
}

import { formatPaise } from "./money";
import { REASON_LABELS, type ReasonCode, type Verdict } from "./policy";

/**
 * Explaining a decision.
 *
 * Track 1's bar asks that every money action be **explainable**. This is that, and the
 * interesting choice here is that it does not use a language model.
 *
 * The reason is not cost or latency. It is that the explanation and the enforcement
 * have to be the same fact. Every verdict this system reaches already carries its
 * arithmetic — the amount, the cap, the overage, the allowlist it missed — because the
 * policy engine records evidence rather than prose. Turning that into a sentence is
 * rendering, not reasoning. A model asked to do it can only introduce the possibility
 * of saying something the numbers do not support.
 *
 * So the sentence is generated from the evidence, and the UI shows the reason code
 * beside it. Anyone can check the two against each other, which is exactly the property
 * the bar is asking for.
 *
 * When `ANTHROPIC_API_KEY` is configured, a model may rephrase this into something more
 * fluent. It is explicitly toothless: it receives the rendered facts, it cannot change
 * a verdict, and `source` on the result says which version you are reading. The numbers
 * below are the ones that count either way.
 */

export interface ExplanationFact {
  label: string;
  value: string;
}

export interface Explanation {
  verdict: Verdict;
  reasonCode: ReasonCode | string | null;
  /** The human-facing label for the code, straight from the engine's closed enum. */
  reasonLabel: string | null;
  /** One or two sentences, built from the arithmetic below. */
  text: string;
  /** The machine facts the sentence was rendered from, so it can be checked against it. */
  facts: ExplanationFact[];
  /** Other bounds the same action broke, when it broke more than one. */
  alsoViolated: string[];
  source: "deterministic" | "model";
}

/** Evidence arrives from JSON, where bigints have already become numbers. */
function paise(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.round(value));
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function money(value: unknown): string {
  const p = paise(value);
  return p === null ? "an unrecorded amount" : formatPaise(p);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function duration(ms: unknown): string {
  const n = count(ms);
  if (n === null) return "some time";
  if (n < 60_000) return `${Math.round(n / 1000)} seconds`;
  if (n < 3_600_000) return `${Math.round(n / 60_000)} minutes`;
  if (n < 86_400_000) return `${Math.round(n / 3_600_000)} hours`;
  return `${Math.round(n / 86_400_000)} days`;
}

export interface ExplainInput {
  verdict: Verdict;
  reasonCode: ReasonCode | string | null;
  evidence: Record<string, unknown>;
  /** Every bound broken, when the caller has them. */
  violations?: Array<{ reasonCode: string }>;
  productName?: string | null;
  merchantName?: string | null;
  latencyUs?: number | null;
}

/**
 * Render one decision into a sentence and the facts behind it.
 *
 * Every branch pulls its numbers from the evidence the engine recorded. Nothing here
 * recomputes a verdict or reaches for the database, so an explanation cannot disagree
 * with the decision it is explaining.
 */
export function explainDecision(input: ExplainInput): Explanation {
  const { evidence: e } = input;
  const subject = input.productName ? `“${input.productName}”` : "This purchase";

  const facts: ExplanationFact[] = [];
  const fact = (label: string, value: string) => facts.push({ label, value });

  let text: string;

  switch (input.reasonCode) {
    case null: {
      const amount = money(e.amountPaise);
      const left = paise(e.remainingAfterPaise);
      fact("Amount", amount);
      if (left !== null) fact("Left on the mandate", formatPaise(left));
      text =
        `${subject} was permitted. It is at a merchant on the mandate's allowlist, in a ` +
        `permitted category, and ${amount} fits inside both the per-transaction and the ` +
        `total cap` +
        (left !== null ? `, leaving ${formatPaise(left)}.` : ".");
      break;
    }

    case "MERCHANT_NOT_ALLOWED": {
      const attempted = String(e.attemptedMerchant ?? input.merchantName ?? "that merchant");
      const allowed = list(e.allowedMerchants);
      fact("Merchant asked for", attempted || "(empty)");
      fact("Merchant allowlist", allowed.length ? allowed.join(", ") : "(empty)");
      text =
        `${subject} was refused because it is sold by ${attempted || "an unnamed merchant"}, ` +
        `which is not on this mandate's allowlist. The mandate permits ` +
        (allowed.length
          ? `${allowed.length} merchant${allowed.length === 1 ? "" : "s"}: ${allowed.join(", ")}.`
          : "no merchants at all.");
      break;
    }

    case "CATEGORY_NOT_ALLOWED": {
      const attempted = String(e.attemptedCategory ?? "that category");
      const allowed = list(e.allowedCategories);
      fact("Category asked for", attempted || "(empty)");
      fact("Categories permitted", allowed.length ? allowed.join(", ") : "(none)");
      text =
        `${subject} was refused because it is a ${attempted || "blank"} item, and this ` +
        `mandate only covers ${allowed.length ? allowed.join(" and ") : "nothing"}.`;
      break;
    }

    case "PER_TXN_CAP_EXCEEDED": {
      const amount = money(e.amountPaise);
      const cap = money(e.perTxnCapPaise);
      const over = money(e.overByPaise);
      fact("Amount", amount);
      fact("Per-transaction cap", cap);
      fact("Over by", over);
      text =
        `${subject} was refused because it costs ${amount}, and this mandate allows at ` +
        `most ${cap} in a single transaction. It is ${over} over the line.`;
      break;
    }

    case "TOTAL_CAP_EXCEEDED": {
      const amount = money(e.amountPaise);
      const spent = money(e.spentPaise);
      const cap = money(e.totalCapPaise);
      const remaining = paise(e.remainingPaise);
      fact("Amount", amount);
      fact("Already spent", spent);
      fact("Total cap", cap);
      if (remaining !== null) fact("Left before this", formatPaise(remaining));
      text =
        `${subject} was refused because ${spent} of this mandate's ${cap} is already ` +
        `committed. Adding ${amount} would take it past the total cap` +
        (remaining !== null && remaining > 0n
          ? `, and only ${formatPaise(remaining)} remains.`
          : ", which is fully spent.");
      break;
    }

    case "VELOCITY_EXCEEDED": {
      const inWindow = count(e.purchasesInWindow);
      const max = count(e.velocityMax);
      const windowS = count(e.velocityWindowS);
      fact("Purchases in the window", String(inWindow ?? "?"));
      fact("Rate limit", max !== null && windowS !== null ? `${max} per ${windowS}s` : "?");
      text =
        `${subject} was refused because this mandate allows ${max ?? "a limited number of"} ` +
        `purchases every ${windowS ?? "?"} seconds, and ${inWindow ?? "too many"} have ` +
        `already gone through inside that window. It is a rate limit, not a spending ` +
        `limit — the money is still available, but not this quickly.`;
      break;
    }

    case "MANDATE_EXPIRED": {
      const expiresAt = typeof e.expiresAt === "string" ? e.expiresAt : null;
      fact("Expired at", expiresAt ?? "(unrecorded)");
      fact("Lapsed", `${duration(e.expiredForMs)} ago`);
      text =
        `${subject} was refused because this mandate expired ${duration(e.expiredForMs)} ` +
        `ago. Expiry is judged against the clock every time the mandate is used, not ` +
        `recorded once and trusted, so a mandate that lapses while nobody is watching ` +
        `stops working on its own.`;
      break;
    }

    case "MANDATE_REVOKED": {
      fact("Mandate", String(e.mandateId ?? "(unrecorded)"));
      fact("Status", "REVOKED");
      text =
        `${subject} was refused because this mandate was revoked. Nothing was sent to ` +
        `the agent and no run was interrupted — the gateway re-reads the mandate on ` +
        `every attempt and never caches it, so revoking takes effect on the very next call.`;
      break;
    }

    case "MANDATE_EXHAUSTED": {
      const spent = money(e.spentPaise);
      const cap = money(e.totalCapPaise);
      fact("Spent", spent);
      fact("Total cap", cap);
      text =
        `${subject} was refused because this mandate's entire ${cap} has been spent. ` +
        `An exhausted mandate confers no further authority, whatever else the request ` +
        `looked like.`;
      break;
    }

    case "SIGNATURE_INVALID": {
      const status = typeof e.status === "string" ? e.status : null;
      fact("Mandate", String(e.mandateId ?? "(unrecorded)"));
      if (status) fact("Status", status);
      text =
        status && status !== "ACTIVE"
          ? `${subject} was refused because this mandate is in ${status} state and was ` +
            `never signed, so it grants nothing.`
          : `${subject} was refused because the mandate's stored terms no longer match ` +
            `its signature. Someone changed a cap, an allowlist or an expiry after it was ` +
            `signed. The gateway refuses such a mandate outright rather than enforcing ` +
            `terms nobody agreed to.`;
      break;
    }

    case "DUPLICATE_REQUEST": {
      fact("Idempotency key", String(e.idempotencyKey ?? "(unrecorded)"));
      text =
        `${subject} was refused because this idempotency key has already produced a ` +
        `purchase. The key is a unique index in the database, so a replayed request ` +
        `cannot become a second charge even if it arrives at the same instant as the ` +
        `original. Razorpay was never called.`;
      break;
    }

    case "UNKNOWN_SKU": {
      fact("SKU asked for", String(e.sku ?? "(unrecorded)"));
      text =
        `This purchase was refused because no such product exists in the catalog. The ` +
        `gateway prices every purchase itself, so a SKU it cannot find is a purchase it ` +
        `cannot price, and it will not guess.`;
      break;
    }

    case "QUANTITY_INVALID": {
      const qty = e.quantity;
      fact("Quantity", String(qty));
      if (e.amountPaise !== undefined) fact("Amount", money(e.amountPaise));
      text =
        `${subject} was refused because the quantity was ${String(qty)}, which is not a ` +
        `positive whole number. A malformed quantity makes the amount meaningless, so ` +
        `there is nothing coherent left to check against the caps.`;
      break;
    }

    case "MANDATE_NOT_FOUND": {
      fact("Mandate", String(e.mandateId ?? "(unrecorded)"));
      text = `This purchase was refused because no mandate with that id exists.`;
      break;
    }

    default: {
      // A code the renderer does not know. Say so plainly rather than inventing prose.
      text =
        `This action was recorded as ${input.verdict}` +
        (input.reasonCode ? ` with reason ${input.reasonCode}.` : ".") +
        ` No prose renderer is defined for that code, so the evidence is shown as-is.`;
      for (const [k, v] of Object.entries(e).slice(0, 6)) {
        fact(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
    }
  }

  // Every bound the action broke, not only the one that got reported.
  const alsoViolated = (input.violations ?? [])
    .map((v) => v.reasonCode)
    .filter((code) => code !== input.reasonCode);

  const alsoFromEvidence = list(e.alsoViolated).filter(
    (code) => !alsoViolated.includes(code),
  );
  alsoViolated.push(...alsoFromEvidence);

  if (alsoViolated.length > 0) {
    text +=
      ` It also broke ${alsoViolated.length} other bound` +
      `${alsoViolated.length === 1 ? "" : "s"}: ${alsoViolated.join(", ")}.`;
  }

  if (input.latencyUs !== null && input.latencyUs !== undefined) {
    fact("Decided in", `${(input.latencyUs / 1000).toFixed(2)}ms`);
  }

  return {
    verdict: input.verdict,
    reasonCode: input.reasonCode,
    reasonLabel: REASON_LABELS[input.reasonCode as ReasonCode] ?? null,
    text,
    facts,
    alsoViolated,
    source: "deterministic",
  };
}

import { formatPaise } from "./money";
import { REASON_LABELS, type ReasonCode, type Verdict } from "./policy";

/**
 * Explaining a decision.
 *
 * Track 1's bar asks that every money action be **explainable**, and getting this right
 * meant first answering a question the code cannot: explainable *to whom*.
 *
 * The audit trail has three readers and they want different things.
 *
 *   1. **The person who signed the mandate.** They want to know why their agent did not
 *      buy the thing they asked for. They do not care that a check is an integer
 *      comparison or that an index is unique. It is their money, and the answer they
 *      need is in rupees and shop names.
 *   2. **The merchant, in a dispute.** They want to show a purchase was authorised, and
 *      by what.
 *   3. **An engineer or an auditor.** They want the reason code, the arithmetic and the
 *      mechanism, because they are checking whether to believe any of it.
 *
 * Writing one paragraph for all three produces something that serves none of them. So
 * every explanation here comes in two registers. `text` is for the first two readers:
 * plain, second person, no implementation words at all. `mechanism` is for the third,
 * and it is where the idempotency keys and the signature checks live. The interface
 * leads with `text` and keeps `mechanism` one line below it.
 *
 * Neither is written by a model. Every decision already carries its own arithmetic,
 * because the engine records evidence rather than prose, so this is rendering rather
 * than reasoning. A model asked to do it could only introduce the possibility of saying
 * something the numbers do not support. When `ANTHROPIC_API_KEY` is set a model may
 * rephrase `text`; it never touches the facts, and `source` says which you are reading.
 */

export interface ExplanationFact {
  label: string;
  value: string;
}

export interface Explanation {
  verdict: Verdict;
  reasonCode: ReasonCode | string | null;
  /** The engine's own label for the code, from its closed enum. */
  reasonLabel: string | null;
  /** Plain language, for whoever's money this is. No jargon, no implementation. */
  text: string;
  /** How it was enforced. For an engineer or an auditor, not for the mandate holder. */
  mechanism: string | null;
  /** The numbers behind the sentence, so the two can be checked against each other. */
  facts: ExplanationFact[];
  alsoViolated: string[];
  /** Plain-language names for the other bounds, when there were any. */
  alsoViolatedPlain: string[];
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

/** "FreshCart and DailyBasket" rather than "FreshCart, DailyBasket". */
function join(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function duration(ms: unknown): string {
  const n = count(ms);
  if (n === null) return "a while";
  if (n < 60_000) return `${Math.max(Math.round(n / 1000), 1)} seconds`;
  if (n < 3_600_000) {
    const m = Math.round(n / 60_000);
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (n < 86_400_000) {
    const h = Math.round(n / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(n / 86_400_000);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * What each bound is called when you are not an engineer.
 *
 * Used for the "it also broke" tail, so a multi-violation refusal reads as a list of
 * reasons rather than a list of constants.
 */
export const PLAIN_BOUND: Record<string, string> = {
  MERCHANT_NOT_ALLOWED: "the shop was not approved",
  CATEGORY_NOT_ALLOWED: "the kind of item was not approved",
  PER_TXN_CAP_EXCEEDED: "it was over the single-purchase limit",
  TOTAL_CAP_EXCEEDED: "it was over the total budget",
  MANDATE_EXPIRED: "the permission had run out",
  MANDATE_REVOKED: "the permission had been withdrawn",
  MANDATE_EXHAUSTED: "the budget was already spent",
  SIGNATURE_INVALID: "the permission could not be trusted",
  DUPLICATE_REQUEST: "it was a repeat of a purchase already made",
  VELOCITY_EXCEEDED: "it was too many purchases too quickly",
  UNKNOWN_SKU: "the product does not exist",
  QUANTITY_INVALID: "the quantity was not a real number of items",
};

/**
 * A refusal in the words of whoever's money it is. Falls back to the machine code,
 * which is at least honest about being one.
 */
export function plainReason(code: string | null): string {
  if (!code) return "Stopped";
  const plain = PLAIN_BOUND[code];
  if (!plain) return code;
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

export interface ExplainInput {
  verdict: Verdict;
  reasonCode: ReasonCode | string | null;
  evidence: Record<string, unknown>;
  violations?: Array<{ reasonCode: string }>;
  productName?: string | null;
  merchantName?: string | null;
  latencyUs?: number | null;
}

export function explainDecision(input: ExplainInput): Explanation {
  const { evidence: e } = input;
  const item = input.productName ? `“${input.productName}”` : "this purchase";
  const Item = input.productName ? `“${input.productName}”` : "This purchase";

  const facts: ExplanationFact[] = [];
  const fact = (label: string, value: string) => facts.push({ label, value });

  let text: string;
  let mechanism: string | null = null;

  switch (input.reasonCode) {
    case null: {
      const amount = money(e.amountPaise);
      const left = paise(e.remainingAfterPaise);
      fact("Amount", amount);
      if (left !== null) fact("Budget left", formatPaise(left));
      text =
        `Allowed. ${amount} for ${item}, from a shop you approved and inside both your ` +
        `limits.` + (left !== null ? ` ${formatPaise(left)} left to spend.` : "");
      mechanism =
        "Priced from the catalog rather than from the agent's request, then checked " +
        "against the signed terms before any payment call was made.";
      break;
    }

    case "MERCHANT_NOT_ALLOWED": {
      const shop = input.merchantName ?? String(e.attemptedMerchant ?? "an unknown shop");
      const names = list(e.allowedMerchantNames);
      const ids = list(e.allowedMerchants);
      const approved = names.length ? names : ids;

      fact("Shop", shop || "(none given)");
      fact("Shops you approved", approved.length ? approved.join(", ") : "(none)");

      text =
        `Stopped. ${Item} is sold by ${shop || "a shop with no name"}, which is not one ` +
        `of the shops you approved. ` +
        (approved.length
          ? `This permission covers ${join(approved)}.`
          : `This permission covers no shops at all.`);
      mechanism =
        "The list of shops is inside the signed terms and is matched on exact merchant " +
        "id, so a lookalike name cannot pass for an approved one.";
      break;
    }

    case "CATEGORY_NOT_ALLOWED": {
      const kind = String(e.attemptedCategory ?? "that kind of thing");
      const approved = list(e.allowedCategories);
      fact("Kind of item", kind || "(none given)");
      fact("Kinds you approved", approved.length ? approved.join(", ") : "(none)");
      text =
        `Stopped. ${Item} is ${kind || "an unlabelled"} item, and you only approved ` +
        `${approved.length ? join(approved) : "nothing"}.`;
      mechanism =
        "The category comes from the catalog record, not from anything the agent said " +
        "about the product.";
      break;
    }

    case "PER_TXN_CAP_EXCEEDED": {
      const amount = money(e.amountPaise);
      const cap = money(e.perTxnCapPaise);
      const over = money(e.overByPaise);
      fact("Price", amount);
      fact("Your limit per purchase", cap);
      fact("Over by", over);
      text =
        `Stopped. ${Item} costs ${amount}, and you set a limit of ${cap} on any single ` +
        `purchase. It is ${over} too much.`;
      mechanism =
        "Compared as whole paise against the signed cap, so no rounding is involved and " +
        "the result is the same every time.";
      break;
    }

    case "TOTAL_CAP_EXCEEDED": {
      const amount = money(e.amountPaise);
      const spent = money(e.spentPaise);
      const cap = money(e.totalCapPaise);
      const remaining = paise(e.remainingPaise);
      fact("Price", amount);
      fact("Already spent", spent);
      fact("Your total budget", cap);
      if (remaining !== null) fact("Left before this", formatPaise(remaining));
      text =
        `Stopped. ${spent} of your ${cap} budget is already committed, and ${amount} ` +
        `for ${item} would take you over it.` +
        (remaining !== null && remaining > 0n
          ? ` Only ${formatPaise(remaining)} was left.`
          : "");
      mechanism =
        "Spend counts orders that have been placed as well as ones that have settled, " +
        "so an agent cannot outrun its own budget while payments are still in flight.";
      break;
    }

    case "VELOCITY_EXCEEDED": {
      const inWindow = count(e.purchasesInWindow);
      const max = count(e.velocityMax);
      const windowS = count(e.velocityWindowS);
      const window = windowS === 3600 ? "an hour" : `${windowS ?? "?"} seconds`;
      fact("Purchases just now", String(inWindow ?? "?"));
      fact("Your rate limit", max !== null ? `${max} per ${window}` : "?");
      text =
        `Stopped. You allowed ${max ?? "a set number of"} purchases per ${window}, and ` +
        `your agent has already made ${inWindow ?? "more than that"}. Your budget is ` +
        `untouched — this one was simply too soon.`;
      mechanism =
        "A sliding window over the timestamps of prior allowed purchases. Older ones " +
        "fall out of it and stop counting.";
      break;
    }

    case "MANDATE_EXPIRED": {
      const expiresAt = typeof e.expiresAt === "string" ? e.expiresAt : null;
      fact("Ran out", `${duration(e.expiredForMs)} ago`);
      if (expiresAt) fact("Expiry", expiresAt);
      text =
        `Stopped. This permission ran out ${duration(e.expiredForMs)} ago, so your agent ` +
        `can no longer spend against it.`;
      mechanism =
        "Expiry is compared against the clock every time the permission is used, rather " +
        "than recorded once and trusted, so one that lapses unattended stops working " +
        "on its own.";
      break;
    }

    case "MANDATE_REVOKED": {
      fact("Permission", String(e.mandateId ?? "(unrecorded)"));
      fact("State", "withdrawn");
      text =
        `Stopped. You withdrew this permission, so your agent cannot spend any more ` +
        `against it.`;
      mechanism =
        "Authority is read at the moment it is used and never cached, so withdrawing it " +
        "takes effect on the next attempt. Nothing had to be sent to the agent and no " +
        "request was cancelled.";
      break;
    }

    case "MANDATE_EXHAUSTED": {
      const spent = money(e.spentPaise);
      const cap = money(e.totalCapPaise);
      fact("Spent", spent);
      fact("Your total budget", cap);
      text =
        `Stopped. The whole ${cap} on this permission has been spent, so there is ` +
        `nothing left for ${item}.`;
      mechanism =
        "An exhausted permission is refused before any other check runs, whatever else " +
        "the request looked like.";
      break;
    }

    case "SIGNATURE_INVALID": {
      const status = typeof e.status === "string" ? e.status : null;
      fact("Permission", String(e.mandateId ?? "(unrecorded)"));
      if (status) fact("State", status.toLowerCase());
      if (status && status !== "ACTIVE") {
        text =
          `Stopped. This permission was never actually granted — it is still a draft — ` +
          `so it allows nothing.`;
        mechanism = "Only a signed mandate confers authority. A draft has no signature.";
      } else {
        text =
          `Stopped. This permission does not match what you signed. A limit, a shop or ` +
          `an expiry has been changed since then, so it cannot be trusted and nothing ` +
          `will be spent against it.`;
        mechanism =
          "The signature covers every term. Editing any of them in storage makes it " +
          "stop matching, and a mandate that fails that check is refused outright " +
          "rather than enforced as found.";
      }
      break;
    }

    case "DUPLICATE_REQUEST": {
      fact("Reference", String(e.idempotencyKey ?? "(unrecorded)"));
      text =
        `Stopped. Your agent already made this purchase and asked again. The repeat was ` +
        `ignored, so you have not been charged twice.`;
      mechanism =
        "Each purchase carries a one-time reference, held under a unique database " +
        "constraint. A repeat cannot create a second order even if it arrives at the " +
        "same instant as the original, and the payment provider was never called.";
      break;
    }

    case "UNKNOWN_SKU": {
      fact("Product asked for", String(e.sku ?? "(unrecorded)"));
      text =
        `Stopped. There is no such product in the catalog, so there was nothing to buy.`;
      mechanism =
        "Prices are always looked up rather than taken from the request, so a product " +
        "that cannot be found is one that cannot be priced.";
      break;
    }

    case "QUANTITY_INVALID": {
      fact("Quantity", String(e.quantity));
      if (e.amountPaise !== undefined) fact("Amount", money(e.amountPaise));
      text =
        `Stopped. The quantity asked for was ${String(e.quantity)}, which is not a real ` +
        `number of items, so there was no sensible total to check against your limits.`;
      mechanism =
        "Quantity must be a positive whole number. Anything else makes the amount " +
        "meaningless before the caps are even reached.";
      break;
    }

    case "MANDATE_NOT_FOUND": {
      fact("Permission", String(e.mandateId ?? "(unrecorded)"));
      text = `Stopped. There is no permission with that reference, so nothing was allowed.`;
      break;
    }

    default: {
      // A code with no renderer. Say so plainly rather than inventing prose.
      text =
        `This action was recorded as ${input.verdict}` +
        (input.reasonCode ? ` with reason ${input.reasonCode}.` : ".") +
        ` There is no plain-language version of that reason yet, so the recorded ` +
        `details are shown as they are.`;
      for (const [k, v] of Object.entries(e).slice(0, 6)) {
        fact(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
    }
  }

  // Every bound the action broke, not only the one that got reported.
  const alsoViolated = (input.violations ?? [])
    .map((v) => v.reasonCode)
    .filter((code) => code !== input.reasonCode);

  for (const code of list(e.alsoViolated)) {
    if (!alsoViolated.includes(code)) alsoViolated.push(code);
  }

  const alsoViolatedPlain = alsoViolated.map((code) => PLAIN_BOUND[code] ?? code);

  if (alsoViolatedPlain.length > 0) {
    text +=
      ` It would have been stopped anyway: ${join(alsoViolatedPlain)}.`;
  }

  if (input.latencyUs !== null && input.latencyUs !== undefined) {
    fact("Decided in", `${(input.latencyUs / 1000).toFixed(2)}ms`);
  }

  return {
    verdict: input.verdict,
    reasonCode: input.reasonCode,
    reasonLabel: REASON_LABELS[input.reasonCode as ReasonCode] ?? null,
    text,
    mechanism,
    facts,
    alsoViolated,
    alsoViolatedPlain,
    source: "deterministic",
  };
}

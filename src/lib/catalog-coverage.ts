import { evaluate, type MandateContext, type SpendState } from "./policy";
import { plainReason } from "./explain";
import type { CatalogProduct } from "./catalog";

/**
 * What each catalog item means for one person's mandates.
 *
 * This runs the real policy engine — the same `evaluate` the gateway calls before it
 * moves money — against every item, once per active mandate. It deliberately does not
 * re-check the caps by hand. A second, hand-rolled copy of the rules on a browsing
 * screen is a copy that drifts, and a catalog that says "covered" for something the
 * gateway would refuse is worse than a catalog that says nothing.
 *
 * It is still a preview rather than a verdict, for one honest reason: it is computed
 * when the page renders, and the answer can change before anyone acts on it. The
 * binding decision is the one taken at the moment of purchase.
 *
 * Pure, with no database import, so it is tested directly. The query that loads the
 * mandates lives in `mandate-service.ts` with every other query.
 */

export type Coverage =
  | { kind: "covered"; mandateId: string; mandateIntent: string }
  | { kind: "refused"; reasonCode: string; note: string }
  /** Signed out, or no active mandates. The screen says nothing rather than guessing. */
  | { kind: "none" };

export interface ActiveMandate {
  id: string;
  intentText: string;
  merchantIds: string[];
  context: MandateContext;
  spend: SpendState;
}

/** Short, present-tense refusals. The ledger's past-tense wording reads wrong on a shelf. */
const SHORT_NOTE: Record<string, string> = {
  MERCHANT_NOT_ALLOWED: "Shop is not on a mandate",
  CATEGORY_NOT_ALLOWED: "Kind of item is not allowed",
  PER_TXN_CAP_EXCEEDED: "Over the single-purchase limit",
  TOTAL_CAP_EXCEEDED: "More than the budget left",
  VELOCITY_EXCEEDED: "Too many purchases just now",
};

/**
 * How near a miss each refusal is.
 *
 * When several mandates all refuse an item, the useful one to report is the closest
 * call. "Over the single-purchase limit" tells someone their cap is too tight and can
 * be widened; "shop is not on a mandate" only tells them they are in the wrong aisle.
 */
const NEARNESS: Record<string, number> = {
  VELOCITY_EXCEEDED: 4,
  TOTAL_CAP_EXCEEDED: 3,
  PER_TXN_CAP_EXCEEDED: 2,
  CATEGORY_NOT_ALLOWED: 1,
  MERCHANT_NOT_ALLOWED: 0,
};

export function coverageFor(
  product: CatalogProduct,
  mandates: ActiveMandate[],
  now: Date = new Date(),
): Coverage {
  if (mandates.length === 0) return { kind: "none" };

  let best: { reasonCode: string; nearness: number } | null = null;

  for (const mandate of mandates) {
    const decision = evaluate(
      mandate.context,
      mandate.spend,
      {
        sku: product.sku,
        quantity: 1,
        merchantId: product.merchantId,
        category: product.category,
        amountPaise: product.pricePaise,
        idempotencyKey: `preview:${mandate.id}:${product.sku}`,
      },
      now,
    );

    if (decision.verdict === "ALLOW") {
      return { kind: "covered", mandateId: mandate.id, mandateIntent: mandate.intentText };
    }

    const reasonCode = decision.reasonCode ?? "UNKNOWN";
    const nearness = NEARNESS[reasonCode] ?? -1;
    if (!best || nearness > best.nearness) best = { reasonCode, nearness };
  }

  const reasonCode = best?.reasonCode ?? "UNKNOWN";
  return {
    kind: "refused",
    reasonCode,
    note: SHORT_NOTE[reasonCode] ?? plainReason(reasonCode),
  };
}

import { describe, expect, it } from "vitest";
import { coverageFor, type ActiveMandate } from "./catalog-coverage";
import type { CatalogProduct } from "./catalog";
import type { MandateTerms } from "./mandate";

/**
 * The catalog marks each item against the viewer's mandates. It must never say
 * "covered" for something the gateway would refuse, because the whole reason the
 * screen exists is to make the bounds legible before anyone spends anything.
 *
 * `coverageFor` is pure — it takes the mandates already loaded and calls the same
 * `evaluate` the gateway calls. The tests below are therefore about the two decisions
 * this module actually makes on top of the engine: which mandate wins, and which
 * refusal is worth showing when they all say no.
 */

const NOW = new Date("2026-09-03T10:00:00.000Z");

function mandate(
  id: string,
  overrides: Partial<MandateTerms> = {},
  spentPaise = 0n,
  recentPurchaseTimes: Date[] = [],
): ActiveMandate {
  const terms: MandateTerms = {
    id,
    userId: "test",
    merchants: [{ id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" }],
    categories: ["grocery"],
    perTxnCapPaise: 700_00n,
    totalCapPaise: 2000_00n,
    velocityMax: null,
    velocityWindowS: null,
    expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    ...overrides,
  };

  return {
    id,
    intentText: `mandate ${id}`,
    merchantIds: terms.merchants.map((m) => m.id),
    context: { terms, status: "ACTIVE", signatureValid: true },
    spend: { spentPaise, recentPurchaseTimes, idempotencyKeyUsed: false },
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sku: "sku_milk_1l",
    merchantId: "mrc_freshcart",
    merchantName: "FreshCart",
    merchantVpa: "freshcart@razorpay",
    name: "Amul Toned Milk 1L",
    category: "grocery",
    pricePaise: 68_00n,
    description: "Pasteurised toned milk.",
    inStock: true,
    ...overrides,
  };
}

describe("coverageFor", () => {
  it("says nothing when there are no active mandates", () => {
    expect(coverageFor(product(), [], NOW)).toEqual({ kind: "none" });
  });

  it("marks an item the mandate permits, and names the mandate", () => {
    const result = coverageFor(product(), [mandate("mnd_a")], NOW);
    expect(result).toMatchObject({ kind: "covered", mandateId: "mnd_a" });
  });

  it("reports the cap when the item is too expensive for it", () => {
    const result = coverageFor(product({ pricePaise: 900_00n }), [mandate("mnd_a")], NOW);
    expect(result).toMatchObject({
      kind: "refused",
      reasonCode: "PER_TXN_CAP_EXCEEDED",
      note: "Over the single-purchase limit",
    });
  });

  it("reports a shop that no mandate lists", () => {
    const result = coverageFor(
      product({ merchantId: "mrc_homestack", category: "electronics" }),
      [mandate("mnd_a")],
      NOW,
    );
    expect(result).toMatchObject({ kind: "refused", reasonCode: "MERCHANT_NOT_ALLOWED" });
  });

  it("counts spend already made against the total cap", () => {
    const result = coverageFor(product({ pricePaise: 500_00n }), [
      mandate("mnd_a", {}, 1800_00n),
    ], NOW);
    expect(result).toMatchObject({ kind: "refused", reasonCode: "TOTAL_CAP_EXCEEDED" });
  });

  it("respects the rate limit, which a hand-rolled cap check would miss", () => {
    const recent = [NOW, NOW, NOW].map((d) => new Date(d.getTime() - 60_000));
    const result = coverageFor(product(), [
      mandate("mnd_a", { velocityMax: 3, velocityWindowS: 3600 }, 0n, recent),
    ], NOW);
    expect(result).toMatchObject({ kind: "refused", reasonCode: "VELOCITY_EXCEEDED" });
  });

  it("takes the first mandate that permits the item, whatever the others say", () => {
    const strict = mandate("mnd_strict", { perTxnCapPaise: 10_00n });
    const generous = mandate("mnd_generous");
    expect(coverageFor(product(), [strict, generous], NOW)).toMatchObject({
      kind: "covered",
      mandateId: "mnd_generous",
    });
  });

  it("reports the nearest miss when every mandate refuses", () => {
    // One mandate does not sell this at all; the other would, but for the cap. The
    // second is the one worth telling someone about — it is the one they can widen.
    const wrongShop = mandate("mnd_other", {
      merchants: [{ id: "mrc_dailybasket", name: "DailyBasket", vpa: "db@razorpay" }],
    });
    const tooTight = mandate("mnd_tight", { perTxnCapPaise: 10_00n });

    expect(coverageFor(product(), [wrongShop, tooTight], NOW)).toMatchObject({
      kind: "refused",
      reasonCode: "PER_TXN_CAP_EXCEEDED",
    });
  });
});

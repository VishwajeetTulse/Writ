import { describe, expect, it } from "vitest";
import { toAutopayToken, unmappedBounds } from "./autopay";
import type { MandateTerms } from "../mandate";

/**
 * The mapping from a signed mandate to a UPI Autopay token.
 *
 * Two things are worth locking down. The token has to carry the caps exactly, because a
 * `max_amount` that drifted from `perTxnCapPaise` would be a mandate on the rail that
 * permits more than the one a person signed. And `unmappedBounds` has to keep naming
 * everything the rail cannot hold, because that list is the argument for why the policy
 * engine exists at all — a mapping that quietly stopped mentioning the total cap would
 * make Writ look like a thin wrapper over UPI.
 */

function terms(overrides: Partial<MandateTerms> = {}): MandateTerms {
  return {
    id: "mnd_autopay",
    userId: "test",
    merchants: [
      { id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" },
      { id: "mrc_dailybasket", name: "DailyBasket", vpa: "dailybasket@razorpay" },
    ],
    categories: ["grocery", "household"],
    perTxnCapPaise: 700_00n,
    totalCapPaise: 2000_00n,
    velocityMax: 5,
    velocityWindowS: 3600,
    expiresAt: "2026-09-10T18:33:46.000Z",
    ...overrides,
  };
}

describe("toAutopayToken", () => {
  it("carries the per-purchase cap across as max_amount, in paise", () => {
    expect(toAutopayToken(terms()).max_amount).toBe(70000);
  });

  it("converts the expiry to unix seconds", () => {
    expect(toAutopayToken(terms()).expire_at).toBe(1789065226);
  });

  it("floors a sub-second expiry rather than rounding up", () => {
    // Rounding up would hand the rail slightly more authority than was signed.
    const token = toAutopayToken(terms({ expiresAt: "2026-09-10T18:33:46.999Z" }));
    expect(token.expire_at).toBe(1789065226);
  });

  it("uses as_presented, because an agent does not buy on a calendar", () => {
    expect(toAutopayToken(terms()).frequency).toBe("as_presented");
  });

  it("is pure: the same terms always compile to the same token", () => {
    expect(toAutopayToken(terms())).toEqual(toAutopayToken(terms()));
  });
});

describe("unmappedBounds", () => {
  it("names every bound UPI cannot express", () => {
    const named = unmappedBounds(terms()).map((b) => b.bound);
    expect(named).toContain("Total budget");
    expect(named).toContain("Shops");
    expect(named).toContain("Kinds of item");
    expect(named).toContain("Rate limit");
  });

  it("omits the rate limit when the mandate sets none", () => {
    const named = unmappedBounds(
      terms({ velocityMax: null, velocityWindowS: null }),
    ).map((b) => b.bound);
    expect(named).not.toContain("Rate limit");
  });

  it("lists every allowed shop, since the rail holds a mandate against one payee", () => {
    const shops = unmappedBounds(terms()).find((b) => b.bound === "Shops");
    expect(shops?.value).toBe("FreshCart, DailyBasket");
  });
});

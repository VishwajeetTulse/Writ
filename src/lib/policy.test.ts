import { describe, expect, it } from "vitest";
import {
  evaluate,
  REASON_CODES,
  type MandateContext,
  type ProposedAction,
  type ReasonCode,
  type SpendState,
} from "./policy";
import type { MandateTerms } from "./mandate";

/**
 * Tests for the policy engine.
 *
 * Every reason code gets at least one case, and every numeric boundary gets three:
 * one paise under, exactly at, and one paise over. Off-by-one errors in a spending
 * limit are the whole ballgame — "exactly at the cap" must be allowed and
 * "one paise over" must not, and neither is a judgement call.
 */

const NOW = new Date("2026-09-02T12:00:00.000Z");

const baseTerms: MandateTerms = {
  id: "mnd_test01",
  userId: "demo-user",
  merchants: [
    { id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" },
    { id: "mrc_dailybasket", name: "DailyBasket", vpa: "dailybasket@razorpay" },
  ],
  categories: ["grocery", "household"],
  perTxnCapPaise: 700_00n,
  totalCapPaise: 2000_00n,
  velocityMax: null,
  velocityWindowS: null,
  expiresAt: "2026-09-03T00:00:00.000Z",
};

function mandate(over: Partial<MandateContext> = {}): MandateContext {
  return {
    terms: baseTerms,
    status: "ACTIVE",
    signatureValid: true,
    ...over,
  };
}

function spend(over: Partial<SpendState> = {}): SpendState {
  return {
    spentPaise: 0n,
    recentPurchaseTimes: [],
    idempotencyKeyUsed: false,
    ...over,
  };
}

function action(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    sku: "sku_milk_1l",
    quantity: 1,
    merchantId: "mrc_freshcart",
    category: "grocery",
    amountPaise: 68_00n,
    idempotencyKey: "idem_001",
    ...over,
  };
}

describe("evaluate — the happy path", () => {
  it("allows a purchase that is inside every bound", () => {
    const d = evaluate(mandate(), spend(), action(), NOW);
    expect(d.verdict).toBe("ALLOW");
    expect(d.reasonCode).toBeNull();
  });

  it("reports the remaining authority so the agent can plan", () => {
    const d = evaluate(mandate(), spend({ spentPaise: 500_00n }), action(), NOW);
    expect(d.verdict).toBe("ALLOW");
    expect(d.evidence.remainingAfterPaise).toBe(2000_00n - 500_00n - 68_00n);
  });

  it("measures its own latency", () => {
    const d = evaluate(mandate(), spend(), action(), NOW);
    expect(d.latencyUs).toBeGreaterThanOrEqual(0);
    // The whole point is that this is fast enough to sit in the money path.
    expect(d.latencyUs).toBeLessThan(50_000);
  });
});

describe("SIGNATURE_INVALID", () => {
  it("blocks when the signature does not match the terms", () => {
    const d = evaluate(mandate({ signatureValid: false }), spend(), action(), NOW);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("SIGNATURE_INVALID");
  });

  it("blocks an unsigned draft even if every other bound is satisfied", () => {
    const d = evaluate(mandate({ status: "DRAFT" }), spend(), action(), NOW);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("SIGNATURE_INVALID");
  });

  it("is checked before anything else — a forged mandate reveals nothing about its caps", () => {
    const d = evaluate(
      mandate({ signatureValid: false, status: "REVOKED" }),
      spend(),
      action({ merchantId: "mrc_nope", amountPaise: 99999_00n }),
      NOW,
    );
    expect(d.reasonCode).toBe("SIGNATURE_INVALID");
  });
});

describe("MANDATE_REVOKED", () => {
  it("blocks a revoked mandate", () => {
    const d = evaluate(mandate({ status: "REVOKED" }), spend(), action(), NOW);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("MANDATE_REVOKED");
  });

  it("blocks revoked before evaluating caps — revocation is unconditional", () => {
    const d = evaluate(
      mandate({ status: "REVOKED" }),
      spend(),
      action({ amountPaise: 1_00n }),
      NOW,
    );
    expect(d.reasonCode).toBe("MANDATE_REVOKED");
  });
});

describe("MANDATE_EXHAUSTED", () => {
  it("blocks when the mandate is marked exhausted", () => {
    const d = evaluate(
      mandate({ status: "EXHAUSTED" }),
      spend({ spentPaise: 2000_00n }),
      action(),
      NOW,
    );
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("MANDATE_EXHAUSTED");
  });
});

describe("MANDATE_EXPIRED", () => {
  it("allows one millisecond before expiry", () => {
    const justBefore = new Date("2026-09-02T23:59:59.999Z");
    const d = evaluate(mandate(), spend(), action(), justBefore);
    expect(d.verdict).toBe("ALLOW");
  });

  it("blocks exactly at the expiry instant", () => {
    const atExpiry = new Date("2026-09-03T00:00:00.000Z");
    const d = evaluate(mandate(), spend(), action(), atExpiry);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("MANDATE_EXPIRED");
  });

  it("blocks after expiry and reports how long ago", () => {
    const after = new Date("2026-09-03T01:00:00.000Z");
    const d = evaluate(mandate(), spend(), action(), after);
    expect(d.reasonCode).toBe("MANDATE_EXPIRED");
    expect(d.evidence.expiredForMs).toBe(60 * 60 * 1000);
  });
});

describe("MERCHANT_NOT_ALLOWED", () => {
  it("blocks a merchant that is not on the allowlist", () => {
    const d = evaluate(
      mandate(),
      spend(),
      action({ merchantId: "mrc_homestack", category: "grocery" }),
      NOW,
    );
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("MERCHANT_NOT_ALLOWED");
    expect(d.evidence.attemptedMerchant).toBe("mrc_homestack");
  });

  it("allows every merchant that is on the allowlist", () => {
    for (const m of baseTerms.merchants) {
      const d = evaluate(mandate(), spend(), action({ merchantId: m.id }), NOW);
      expect(d.verdict).toBe("ALLOW");
    }
  });
});

describe("CATEGORY_NOT_ALLOWED", () => {
  it("blocks a category outside the mandate, even at an allowed merchant", () => {
    const d = evaluate(
      mandate(),
      spend(),
      action({ category: "electronics", amountPaise: 100_00n }),
      NOW,
    );
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("CATEGORY_NOT_ALLOWED");
  });

  it("allows every category on the list", () => {
    for (const c of baseTerms.categories) {
      const d = evaluate(mandate(), spend(), action({ category: c }), NOW);
      expect(d.verdict).toBe("ALLOW");
    }
  });
});

describe("PER_TXN_CAP_EXCEEDED — boundary", () => {
  it("allows one paise under the cap", () => {
    const d = evaluate(mandate(), spend(), action({ amountPaise: 699_99n }), NOW);
    expect(d.verdict).toBe("ALLOW");
  });

  it("allows exactly at the cap", () => {
    const d = evaluate(mandate(), spend(), action({ amountPaise: 700_00n }), NOW);
    expect(d.verdict).toBe("ALLOW");
  });

  it("blocks one paise over the cap", () => {
    const d = evaluate(mandate(), spend(), action({ amountPaise: 700_01n }), NOW);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("PER_TXN_CAP_EXCEEDED");
    expect(d.evidence.overByPaise).toBe(1n);
  });

  it("blocks the demo's air fryer and shows the arithmetic", () => {
    const d = evaluate(mandate(), spend(), action({ amountPaise: 1899_00n }), NOW);
    expect(d.reasonCode).toBe("PER_TXN_CAP_EXCEEDED");
    expect(d.evidence.amountPaise).toBe(1899_00n);
    expect(d.evidence.perTxnCapPaise).toBe(700_00n);
  });
});

describe("TOTAL_CAP_EXCEEDED — boundary", () => {
  it("allows a purchase that lands exactly on the total cap", () => {
    const d = evaluate(
      mandate(),
      spend({ spentPaise: 1300_00n }),
      action({ amountPaise: 700_00n }),
      NOW,
    );
    expect(d.verdict).toBe("ALLOW");
    expect(d.evidence.remainingAfterPaise).toBe(0n);
  });

  it("blocks a purchase that would exceed the total cap by one paise", () => {
    const d = evaluate(
      mandate(),
      spend({ spentPaise: 1300_01n }),
      action({ amountPaise: 700_00n }),
      NOW,
    );
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("TOTAL_CAP_EXCEEDED");
    expect(d.evidence.remainingPaise).toBe(2000_00n - 1300_01n);
  });

  it("blocks when the mandate is already fully spent", () => {
    const d = evaluate(mandate(), spend({ spentPaise: 2000_00n }), action(), NOW);
    expect(d.reasonCode).toBe("TOTAL_CAP_EXCEEDED");
  });
});

describe("VELOCITY_EXCEEDED", () => {
  const withVelocity = (): MandateContext =>
    mandate({
      terms: { ...baseTerms, velocityMax: 3, velocityWindowS: 600 },
    });

  const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

  it("allows while under the velocity limit", () => {
    const d = evaluate(
      withVelocity(),
      spend({ recentPurchaseTimes: [minsAgo(1), minsAgo(2)] }),
      action(),
      NOW,
    );
    expect(d.verdict).toBe("ALLOW");
  });

  it("blocks at the velocity limit", () => {
    const d = evaluate(
      withVelocity(),
      spend({ recentPurchaseTimes: [minsAgo(1), minsAgo(2), minsAgo(3)] }),
      action(),
      NOW,
    );
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("VELOCITY_EXCEEDED");
  });

  it("ignores purchases that fall outside the window", () => {
    const d = evaluate(
      withVelocity(),
      spend({ recentPurchaseTimes: [minsAgo(11), minsAgo(12), minsAgo(13)] }),
      action(),
      NOW,
    );
    expect(d.verdict).toBe("ALLOW");
  });

  it("does not apply a velocity limit when the mandate sets none", () => {
    const d = evaluate(
      mandate(),
      spend({ recentPurchaseTimes: [minsAgo(1), minsAgo(1), minsAgo(1), minsAgo(1)] }),
      action(),
      NOW,
    );
    expect(d.verdict).toBe("ALLOW");
  });
});

describe("DUPLICATE_REQUEST", () => {
  it("blocks a replayed idempotency key", () => {
    const d = evaluate(mandate(), spend({ idempotencyKeyUsed: true }), action(), NOW);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("DUPLICATE_REQUEST");
  });

  it("reports the scope violation ahead of the replay — it is the more useful refusal", () => {
    const d = evaluate(
      mandate(),
      spend({ idempotencyKeyUsed: true }),
      action({ amountPaise: 5000_00n }),
      NOW,
    );
    expect(d.reasonCode).toBe("PER_TXN_CAP_EXCEEDED");
  });
});

describe("QUANTITY_INVALID", () => {
  it.each([0, -1, 1.5, Number.NaN])("blocks quantity %s", (q) => {
    const d = evaluate(mandate(), spend(), action({ quantity: q }), NOW);
    expect(d.verdict).toBe("BLOCK");
    expect(d.reasonCode).toBe("QUANTITY_INVALID");
  });

  it("blocks a zero or negative amount", () => {
    const d = evaluate(mandate(), spend(), action({ amountPaise: 0n }), NOW);
    expect(d.reasonCode).toBe("QUANTITY_INVALID");
  });
});

describe("multiple violations — every broken bound is reported, not just the first", () => {
  it("reports all three bounds the injected television purchase breaks", () => {
    // The injection payload's target: unlisted merchant, forbidden category, and
    // 41x the per-transaction cap. Reporting only the merchant would understate it.
    const d = evaluate(
      mandate(),
      spend(),
      action({
        sku: "sku_tv_43",
        merchantId: "mrc_homestack",
        category: "electronics",
        amountPaise: 28999_00n,
      }),
      NOW,
    );

    expect(d.verdict).toBe("BLOCK");
    expect(d.violations.map((v) => v.reasonCode)).toEqual([
      "MERCHANT_NOT_ALLOWED",
      "CATEGORY_NOT_ALLOWED",
      "PER_TXN_CAP_EXCEEDED",
      "TOTAL_CAP_EXCEEDED",
    ]);
  });

  it("keeps the first violation as the primary reason code", () => {
    const d = evaluate(
      mandate(),
      spend(),
      action({ merchantId: "mrc_homestack", category: "electronics" }),
      NOW,
    );
    expect(d.reasonCode).toBe("MERCHANT_NOT_ALLOWED");
    expect(d.violations[0].reasonCode).toBe(d.reasonCode);
  });

  it("summarises the extra violations on the primary evidence", () => {
    const d = evaluate(
      mandate(),
      spend(),
      action({ merchantId: "mrc_homestack", category: "electronics", amountPaise: 900_00n }),
      NOW,
    );
    expect(d.evidence.violationCount).toBe(3);
    expect(d.evidence.alsoViolated).toEqual([
      "CATEGORY_NOT_ALLOWED",
      "PER_TXN_CAP_EXCEEDED",
    ]);
  });

  it("carries the arithmetic for each violation, not just the primary", () => {
    const d = evaluate(
      mandate(),
      spend(),
      action({ merchantId: "mrc_homestack", category: "electronics", amountPaise: 900_00n }),
      NOW,
    );
    const cap = d.violations.find((v) => v.reasonCode === "PER_TXN_CAP_EXCEEDED");
    expect(cap?.evidence.overByPaise).toBe(900_00n - 700_00n);
  });

  it("omits the summary fields when only one bound is broken", () => {
    const d = evaluate(mandate(), spend(), action({ amountPaise: 900_00n }), NOW);
    expect(d.violations).toHaveLength(1);
    expect(d.evidence.alsoViolated).toBeUndefined();
    expect(d.evidence.violationCount).toBe(1);
  });

  it("returns no violations on ALLOW", () => {
    const d = evaluate(mandate(), spend(), action(), NOW);
    expect(d.verdict).toBe("ALLOW");
    expect(d.violations).toEqual([]);
  });

  it("does not enumerate scope for a mandate that confers nothing", () => {
    // A revoked mandate is a gate, not a scope check. Listing which caps the request
    // would also have broken would leak the terms of a mandate the caller cannot use.
    const d = evaluate(
      mandate({ status: "REVOKED" }),
      spend(),
      action({ merchantId: "mrc_homestack", category: "electronics", amountPaise: 99999_00n }),
      NOW,
    );
    expect(d.violations).toHaveLength(1);
    expect(d.reasonCode).toBe("MANDATE_REVOKED");
  });
});

describe("engine invariants", () => {
  it("never returns a reason code outside the closed enum", () => {
    const cases: Array<[MandateContext, SpendState, ProposedAction]> = [
      [mandate(), spend(), action()],
      [mandate({ signatureValid: false }), spend(), action()],
      [mandate({ status: "REVOKED" }), spend(), action()],
      [mandate({ status: "EXHAUSTED" }), spend(), action()],
      [mandate(), spend(), action({ merchantId: "nope" })],
      [mandate(), spend(), action({ category: "nope" })],
      [mandate(), spend(), action({ amountPaise: 99999_00n })],
      [mandate(), spend({ spentPaise: 1999_00n }), action({ amountPaise: 500_00n })],
      [mandate(), spend({ idempotencyKeyUsed: true }), action()],
      [mandate(), spend(), action({ quantity: 0 })],
    ];

    for (const [m, s, a] of cases) {
      const d = evaluate(m, s, a, NOW);
      if (d.reasonCode !== null) {
        expect(REASON_CODES).toContain(d.reasonCode as ReasonCode);
      }
    }
  });

  it("is deterministic — the same inputs always produce the same verdict", () => {
    const m = mandate();
    const s = spend({ spentPaise: 1234_00n });
    const a = action({ amountPaise: 699_00n });

    const verdicts = Array.from({ length: 50 }, () =>
      JSON.stringify(evaluate(m, s, a, NOW), (_k, v) =>
        typeof v === "bigint" ? v.toString() : v === undefined ? null : v,
      ),
    );
    // latencyUs varies, so compare only verdict + reason + evidence.
    const shapes = verdicts.map((v) => {
      const o = JSON.parse(v);
      delete o.latencyUs;
      return JSON.stringify(o);
    });
    expect(new Set(shapes).size).toBe(1);
  });

  it("does not mutate its inputs", () => {
    const m = mandate();
    const s = spend({ recentPurchaseTimes: [NOW] });
    const a = action();
    const before = JSON.stringify([m, s, a], (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    evaluate(m, s, a, NOW);
    const after = JSON.stringify([m, s, a], (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(after).toBe(before);
  });
});

import { describe, expect, it } from "vitest";
import {
  canonicalize,
  clampDraft,
  MANDATE_CEILINGS,
  newMandateId,
  signMandate,
  verifySignature,
  type MandateDraft,
  type MandateTerms,
} from "./mandate";

/**
 * The security claim under test: you cannot change a mandate's terms without
 * invalidating its signature.
 *
 * Every test below is one way someone might try to widen their own authority — raise a
 * cap, slip a merchant onto the allowlist, push out the expiry — and each must be caught.
 */

// MANDATE_SIGNING_KEY is set by src/test/setup.ts before any module loads.

const terms: MandateTerms = {
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

describe("signing and verification", () => {
  it("verifies a signature over untouched terms", () => {
    expect(verifySignature(terms, signMandate(terms))).toBe(true);
  });

  it("rejects an empty signature", () => {
    expect(verifySignature(terms, "")).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifySignature(terms, "not-hex")).toBe(false);
    expect(verifySignature(terms, "ab".repeat(32))).toBe(false);
  });

  it("rejects a signature made with a different key", () => {
    const sig = signMandate(terms);
    process.env.MANDATE_SIGNING_KEY = "a-completely-different-key-98765432100000";
    expect(verifySignature(terms, sig)).toBe(false);
    process.env.MANDATE_SIGNING_KEY = "test-key-do-not-use-in-production-0123456789";
  });
});

describe("tamper detection — each of these is someone widening their own authority", () => {
  const sig = signMandate(terms);

  it("catches a raised per-transaction cap", () => {
    expect(verifySignature({ ...terms, perTxnCapPaise: 5000_00n }, sig)).toBe(false);
  });

  it("catches a raised total cap", () => {
    expect(verifySignature({ ...terms, totalCapPaise: 99999_00n }, sig)).toBe(false);
  });

  it("catches a merchant added to the allowlist", () => {
    const widened = {
      ...terms,
      merchants: [
        ...terms.merchants,
        { id: "mrc_homestack", name: "HomeStack", vpa: "homestack@razorpay" },
      ],
    };
    expect(verifySignature(widened, sig)).toBe(false);
  });

  it("catches a category added to the allowlist", () => {
    expect(
      verifySignature({ ...terms, categories: [...terms.categories, "electronics"] }, sig),
    ).toBe(false);
  });

  it("catches an extended expiry", () => {
    expect(verifySignature({ ...terms, expiresAt: "2027-01-01T00:00:00.000Z" }, sig)).toBe(
      false,
    );
  });

  it("catches a swapped mandate id — a signature cannot be moved to another mandate", () => {
    expect(verifySignature({ ...terms, id: "mnd_other1" }, sig)).toBe(false);
  });

  it("catches a changed VPA while the merchant id stays the same", () => {
    const swapped = {
      ...terms,
      merchants: [
        { id: "mrc_freshcart", name: "FreshCart", vpa: "attacker@razorpay" },
        terms.merchants[1],
      ],
    };
    expect(verifySignature(swapped, sig)).toBe(false);
  });

  it("catches a loosened velocity limit", () => {
    expect(verifySignature({ ...terms, velocityMax: 999, velocityWindowS: 1 }, sig)).toBe(
      false,
    );
  });
});

describe("canonicalization", () => {
  it("is stable regardless of merchant order", () => {
    const reordered = { ...terms, merchants: [...terms.merchants].reverse() };
    expect(canonicalize(reordered)).toBe(canonicalize(terms));
    expect(verifySignature(reordered, signMandate(terms))).toBe(true);
  });

  it("is stable regardless of category order", () => {
    const reordered = { ...terms, categories: [...terms.categories].reverse() };
    expect(canonicalize(reordered)).toBe(canonicalize(terms));
  });

  it("serializes money as decimal strings, never as floats", () => {
    const json = canonicalize(terms);
    expect(json).toContain('"perTxnCapPaise":"70000"');
    expect(json).toContain('"totalCapPaise":"200000"');
  });

  it("emits a version marker so the format can change without silent breakage", () => {
    expect(canonicalize(terms)).toContain('"v":1');
  });
});

describe("mandate ids", () => {
  it("are prefixed and unique", () => {
    const ids = new Set(Array.from({ length: 500 }, newMandateId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^mnd_[0-9a-f]{12}$/);
  });
});

describe("clampDraft — the LLM's output is bounded by code it cannot reach", () => {
  const draft = (over: Partial<MandateDraft> = {}): MandateDraft => ({
    merchants: [{ id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" }],
    categories: ["grocery"],
    perTxnCapPaise: 700_00n,
    totalCapPaise: 2000_00n,
    velocityMax: null,
    velocityWindowS: null,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: {},
    ...over,
  });

  it("leaves a reasonable draft untouched", () => {
    const { clamped } = clampDraft(draft());
    expect(clamped).toEqual([]);
  });

  it("clamps a hallucinated per-transaction cap", () => {
    const { draft: out, clamped } = clampDraft(
      draft({ perTxnCapPaise: 900_000_00n, totalCapPaise: 900_000_00n }),
    );
    expect(out.perTxnCapPaise).toBe(MANDATE_CEILINGS.maxPerTxnPaise);
    expect(clamped).toContain("perTxnCapPaise");
  });

  it("clamps a hallucinated total cap", () => {
    const { draft: out, clamped } = clampDraft(draft({ totalCapPaise: 10_000_000_00n }));
    expect(out.totalCapPaise).toBe(MANDATE_CEILINGS.maxTotalPaise);
    expect(clamped).toContain("totalCapPaise");
  });

  it("normalises a per-transaction cap above the total cap", () => {
    const { draft: out } = clampDraft(
      draft({ perTxnCapPaise: 1500_00n, totalCapPaise: 1000_00n }),
    );
    expect(out.perTxnCapPaise).toBe(1000_00n);
  });

  it("clamps an expiry beyond the maximum duration", () => {
    const { draft: out, clamped } = clampDraft(
      draft({ expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString() }),
    );
    expect(clamped).toContain("expiresAt");
    expect(new Date(out.expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + MANDATE_CEILINGS.maxDurationMs + 1000,
    );
  });
});

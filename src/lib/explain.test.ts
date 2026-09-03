import { describe, expect, it } from "vitest";
import { explainDecision } from "./explain";
import { evaluate, REASON_CODES, type ReasonCode } from "./policy";
import type { MandateContext, ProposedAction, SpendState } from "./policy";
import type { MandateTerms } from "./mandate";

/**
 * The explainer's one job is not to be eloquent. It is to never say anything the
 * arithmetic does not support.
 *
 * The most valuable test here is the round-trip: take a real decision from the policy
 * engine, render it, and assert the sentence carries the same numbers the engine used.
 * A sentence built from a different source could drift; one built from the recorded
 * evidence cannot.
 */

const NOW = new Date("2026-09-03T10:00:00.000Z");

function terms(overrides: Partial<MandateTerms> = {}): MandateTerms {
  return {
    id: "mnd_explain",
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
}

function ctx(overrides: Partial<MandateTerms> = {}): MandateContext {
  return { terms: terms(overrides), status: "ACTIVE", signatureValid: true };
}

function spend(overrides: Partial<SpendState> = {}): SpendState {
  return {
    spentPaise: 0n,
    recentPurchaseTimes: [],
    idempotencyKeyUsed: false,
    ...overrides,
  };
}

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    sku: "sku_milk_1l",
    quantity: 1,
    merchantId: "mrc_freshcart",
    category: "grocery",
    amountPaise: 68_00n,
    idempotencyKey: "idem_explain",
    ...overrides,
  };
}

/** Render whatever the engine actually decided, the way the API route does. */
function explainReal(
  mandate: MandateContext,
  s: SpendState,
  a: ProposedAction,
  now = NOW,
) {
  const decision = evaluate(mandate, s, a, now);
  return {
    decision,
    explanation: explainDecision({
      verdict: decision.verdict,
      reasonCode: decision.reasonCode,
      evidence: decision.evidence,
      violations: decision.violations,
      productName: "Test Item",
      latencyUs: decision.latencyUs,
    }),
  };
}

describe("explainDecision", () => {
  it("carries the engine's own numbers into the sentence", () => {
    const { explanation } = explainReal(
      ctx(),
      spend(),
      action({ amountPaise: 1298_00n }),
    );

    expect(explanation.text).toContain("₹1,298.00");
    expect(explanation.text).toContain("₹700.00");
    // The overage, stated rather than left for the reader to subtract.
    expect(explanation.text).toContain("₹598.00");
  });

  it("names every other bound the same action broke", () => {
    const { decision, explanation } = explainReal(
      ctx(),
      spend(),
      action({
        merchantId: "mrc_homestack",
        category: "electronics",
        amountPaise: 28999_00n,
      }),
    );

    expect(decision.violations.length).toBe(4);
    expect(explanation.alsoViolated).toEqual([
      "CATEGORY_NOT_ALLOWED",
      "PER_TXN_CAP_EXCEEDED",
      "TOTAL_CAP_EXCEEDED",
    ]);
    expect(explanation.text).toContain("3 other bounds");
  });

  it("explains a permitted purchase and what it left behind", () => {
    const { explanation } = explainReal(ctx(), spend({ spentPaise: 100_00n }), action());

    expect(explanation.verdict).toBe("ALLOW");
    expect(explanation.text).toContain("permitted");
    // 2000 - 100 - 68
    expect(explanation.text).toContain("₹1,832.00");
  });

  it("never leaks an unrendered value into the prose", () => {
    // Every code the engine can reach, rendered from a decision the engine produced.
    const scenarios: Array<[ReasonCode, () => ReturnType<typeof explainReal>]> = [
      ["MERCHANT_NOT_ALLOWED", () => explainReal(ctx(), spend(), action({ merchantId: "x" }))],
      ["CATEGORY_NOT_ALLOWED", () => explainReal(ctx(), spend(), action({ category: "x" }))],
      ["PER_TXN_CAP_EXCEEDED", () => explainReal(ctx(), spend(), action({ amountPaise: 900_00n }))],
      [
        "TOTAL_CAP_EXCEEDED",
        () => explainReal(ctx(), spend({ spentPaise: 1900_00n }), action({ amountPaise: 500_00n })),
      ],
      [
        "VELOCITY_EXCEEDED",
        () =>
          explainReal(
            ctx({ velocityMax: 1, velocityWindowS: 3600 }),
            spend({ recentPurchaseTimes: [new Date(NOW.getTime() - 60_000)] }),
            action(),
          ),
      ],
      [
        "MANDATE_EXPIRED",
        () =>
          explainReal(
            ctx({ expiresAt: new Date(NOW.getTime() - 7_200_000).toISOString() }),
            spend(),
            action(),
          ),
      ],
      [
        "MANDATE_REVOKED",
        () => explainReal({ ...ctx(), status: "REVOKED" }, spend(), action()),
      ],
      [
        "MANDATE_EXHAUSTED",
        () =>
          explainReal(
            { ...ctx(), status: "EXHAUSTED" },
            spend({ spentPaise: 2000_00n }),
            action(),
          ),
      ],
      [
        "SIGNATURE_INVALID",
        () => explainReal({ ...ctx(), signatureValid: false }, spend(), action()),
      ],
      [
        "DUPLICATE_REQUEST",
        () => explainReal(ctx(), spend({ idempotencyKeyUsed: true }), action()),
      ],
      ["QUANTITY_INVALID", () => explainReal(ctx(), spend(), action({ quantity: 0 }))],
    ];

    for (const [expectedCode, run] of scenarios) {
      const { decision, explanation } = run();

      expect(decision.reasonCode, `${expectedCode} scenario`).toBe(expectedCode);
      expect(explanation.text.length).toBeGreaterThan(40);

      for (const leak of ["undefined", "NaN", "[object Object]", "null"]) {
        expect(explanation.text, `${expectedCode} leaked ${leak}`).not.toContain(leak);
      }
      for (const f of explanation.facts) {
        expect(f.value, `${expectedCode} fact ${f.label}`).not.toContain("undefined");
      }
    }
  });

  it("covers every reason code the engine can emit, except the gateway's own", () => {
    // A new reason code added to the engine without a renderer here would fall through
    // to the default branch, which is honest but not an explanation. This test is the
    // reminder to write one.
    const rendered = new Set<string>([
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
    ]);

    for (const code of REASON_CODES) {
      expect(rendered.has(code), `no explanation renderer for ${code}`).toBe(true);
    }
  });

  it("degrades honestly on a code it does not know", () => {
    const explanation = explainDecision({
      verdict: "BLOCK",
      reasonCode: "SOME_FUTURE_CODE",
      evidence: { somethingNew: 42 },
    });

    expect(explanation.text).toContain("SOME_FUTURE_CODE");
    expect(explanation.facts).toContainEqual({ label: "somethingNew", value: "42" });
  });

  it("reads evidence that has been through JSON, where bigints became numbers", () => {
    // This is the shape the ledger stores and the API route reads back.
    const explanation = explainDecision({
      verdict: "BLOCK",
      reasonCode: "PER_TXN_CAP_EXCEEDED",
      evidence: JSON.parse(
        JSON.stringify({
          amountPaise: 189900,
          perTxnCapPaise: 70000,
          overByPaise: 119900,
        }),
      ) as Record<string, unknown>,
    });

    expect(explanation.text).toContain("₹1,899.00");
    expect(explanation.text).toContain("₹700.00");
    expect(explanation.text).toContain("₹1,199.00");
  });
});

/**
 * Discovery descriptor for AI buyers.
 *
 * The story this file tells: an agent arrives cold, knowing only the domain, and can
 * work out what this merchant sells, in what currency, and — crucially — what it must
 * present in order to be allowed to buy anything.
 *
 * That last part is the interesting half. Most agent-commerce work describes how to
 * discover products. This also declares that execution requires a signed mandate, which
 * is the piece that lets a merchant accept agent traffic at all.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  return Response.json(
    {
      spec_version: "writ/0.1",
      merchant_platform: "Razorpay",
      currency: "INR",
      amount_unit: "paise",

      catalog: {
        url: `${origin}/api/catalog`,
        method: "GET",
        auth: "none",
        query_params: {
          q: "free-text product search",
          category: "filter by category",
          merchant: "filter by merchant id",
          max_price_paise: "upper bound on unit price, in paise",
        },
      },

      /**
       * Execution is gated. An agent cannot buy by calling the catalog; it presents a
       * mandate id and the gateway decides, using a policy engine that never reads
       * agent-supplied text.
       */
      purchase: {
        url: `${origin}/api/gateway/purchase`,
        method: "POST",
        auth: "signed mandate",
        body: {
          mandateId: "string — a mandate issued to this agent and signed by the human",
          sku: "string — from the catalog",
          quantity: "integer >= 1",
          idempotencyKey: "string — unique per intended purchase; replays are refused",
        },
        notes:
          "The gateway prices the SKU server-side from the catalog. An amount supplied " +
          "by the caller is ignored. Every attempt is recorded in an append-only, " +
          "hash-chained audit ledger whether it is allowed or refused.",
      },

      mandate: {
        description:
          "A signed, bounded, revocable grant of spending authority. Bounds are a " +
          "merchant allowlist, a category allowlist, a per-transaction cap, a total " +
          "cap, an optional velocity limit, and an expiry.",
        issue_url: `${origin}/api/mandates`,
        semantics:
          "Modelled on UPI Reserve Pay and UPI Circle: one-time consent, per-merchant " +
          "limits, repeated debits without re-authentication, immediate revocation.",
      },

      audit: {
        url: `${origin}/api/ledger`,
        description:
          "Append-only hash-chained record of every decision, allowed or refused.",
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}

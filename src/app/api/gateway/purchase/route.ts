import { attemptPurchase } from "@/lib/gateway";
import { arm, isChaosMode } from "@/lib/razorpay/chaos";

/**
 * The money path, over HTTP.
 *
 * The buyer agent reaches this endpoint and nothing else. It holds no Razorpay
 * credentials and cannot import the Razorpay client — in the prototype they share a
 * process, but the boundary is drawn here, so moving the gateway to its own service is
 * a deployment change rather than a rewrite. That limitation is stated in the README.
 *
 * A refusal returns HTTP 200 with `verdict: "BLOCK"`. That is deliberate: a blocked
 * purchase is a normal, expected outcome that the agent should reason about, not a
 * transport error it should retry.
 */

export const dynamic = "force-dynamic";

interface Body {
  mandateId?: string;
  sku?: string;
  quantity?: number;
  idempotencyKey?: string;
  runId?: string | null;
  withPaymentLink?: boolean;
  /** Ignored. Present only so we can record that a caller tried to set the price. */
  amountPaise?: unknown;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { mandateId, sku, quantity, idempotencyKey } = body;

  if (!mandateId || !sku || !idempotencyKey) {
    return Response.json(
      { error: "mandateId, sku and idempotencyKey are required." },
      { status: 400 },
    );
  }

  const qty = quantity ?? 1;

  // Chaos is armed per run, from the query string, so a failure can be demonstrated
  // on demand rather than waiting for a real Razorpay outage.
  const chaos = new URL(request.url).searchParams.get("chaos");
  if (isChaosMode(chaos) && body.runId) {
    arm(body.runId, chaos);
  }

  const result = await attemptPurchase({
    mandateId,
    sku,
    quantity: qty,
    idempotencyKey,
    runId: body.runId ?? null,
    withPaymentLink: body.withPaymentLink ?? false,
  });

  return Response.json({
    ...result,
    // Surfaced so it is visible in the response, not just in the code: if the caller
    // supplied an amount, it played no part in the decision.
    pricedBy: "server",
    callerSuppliedAmountIgnored: body.amountPaise !== undefined,
  });
}

import { append } from "@/lib/ledger";
import { handleWebhookEvent, verifyWebhookSignature } from "@/lib/razorpay/webhook";
import type { WebhookEvent } from "@/lib/razorpay/webhook";

/**
 * Razorpay webhook receiver.
 *
 * Three things happen here in a fixed order, and the order is the security property:
 *
 *   1. Read the RAW bytes. Not `request.json()` — re-serializing the parsed object
 *      would change key order and spacing, and the HMAC would never match.
 *   2. Verify the signature against those bytes. A body that does not verify is
 *      rejected before it is parsed, because an unverified webhook is an
 *      unauthenticated write to the spend ledger.
 *   3. Only then parse and apply it.
 *
 * Response codes matter to Razorpay's retry behaviour: anything non-2xx is retried.
 * So a bad signature returns 401 (retrying will not help, but it should be loud and
 * it must not be treated as accepted), while an event we do not model returns 200 —
 * it arrived fine, we simply had nothing to do with it.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Recorded deliberately. A stream of these means someone is posting to the
    // endpoint without the secret, and that is worth being able to see.
    await append({
      actor: "system",
      type: "WEBHOOK_RECEIVED",
      payload: {
        handled: false,
        rejected: "signature",
        signaturePresent: signature.length > 0,
        secretConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
        bodyBytes: rawBody.length,
        note: "Signature did not verify. Body was not parsed and nothing was updated.",
      },
    });

    return Response.json(
      { ok: false, error: "Signature verification failed." },
      { status: 401 },
    );
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return Response.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }

  const outcome = await handleWebhookEvent(event);

  return Response.json({ ok: true, ...outcome });
}

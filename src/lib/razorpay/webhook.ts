import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import { append } from "../ledger";

/**
 * Webhook processing.
 *
 * The ledger is settled by Razorpay's own event, not by an optimistic local write.
 * When the gateway creates an order it records `CREATED`, which means "Razorpay
 * accepted this"; only a signature-verified `order.paid` moves it to `PAID`. That
 * distinction is the difference between believing money moved and knowing it did.
 *
 * Signature verification runs on the raw request bytes before any of this. An
 * unverified webhook is an unauthenticated write to the spend ledger, so nothing
 * below is reachable without a valid signature.
 */

/**
 * Verify a webhook's HMAC signature against the raw request body.
 *
 * Must be given the exact bytes Razorpay sent. Re-serializing the parsed JSON would
 * change key order or spacing and the digest would never match, which is why the
 * route reads `request.text()` and parses only afterwards.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Sign a body the way Razorpay would. Used by the local webhook test harness. */
export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export interface WebhookEvent {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    order?: { entity?: RazorpayOrderEntity };
    payment_link?: { entity?: RazorpayPaymentLinkEntity };
  };
  created_at?: number;
}

interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  status?: string;
  method?: string;
}

interface RazorpayOrderEntity {
  id?: string;
  amount?: number;
  amount_paid?: number;
  status?: string;
  receipt?: string;
}

interface RazorpayPaymentLinkEntity {
  id?: string;
  reference_id?: string;
  amount?: number;
  status?: string;
}

export interface WebhookOutcome {
  handled: boolean;
  event: string;
  /** Why nothing was updated, when nothing was. */
  note?: string;
  purchaseId?: string;
}

/**
 * Apply one verified webhook.
 *
 * Deliberately idempotent. Razorpay retries delivery on any non-2xx and can deliver
 * the same event more than once even on success, so a repeat of `order.paid` for a
 * purchase that is already `PAID` must be a no-op rather than a second ledger entry
 * claiming the money arrived twice.
 */
export async function handleWebhookEvent(evt: WebhookEvent): Promise<WebhookOutcome> {
  const event = evt.event ?? "unknown";

  switch (event) {
    case "order.paid":
      return handleOrderPaid(evt, event);
    case "payment_link.paid":
      return handlePaymentLinkPaid(evt, event);
    default:
      // Recorded but not acted on. Razorpay lets you subscribe broadly, and an event
      // we do not model is not an error — returning non-2xx would make it retry forever.
      await append({
        actor: "razorpay",
        type: "WEBHOOK_RECEIVED",
        payload: { event, handled: false, note: "event type not modelled by Writ" },
      });
      return { handled: false, event, note: "event type not modelled" };
  }
}

async function handleOrderPaid(evt: WebhookEvent, event: string): Promise<WebhookOutcome> {
  const order = evt.payload?.order?.entity;
  const payment = evt.payload?.payment?.entity;
  const orderId = order?.id ?? payment?.order_id;

  if (!orderId) {
    await append({
      actor: "razorpay",
      type: "WEBHOOK_RECEIVED",
      payload: { event, handled: false, note: "no order id in payload" },
    });
    return { handled: false, event, note: "no order id in payload" };
  }

  const purchase = await prisma.purchase.findFirst({
    where: { razorpayOrderId: orderId },
  });

  if (!purchase) {
    // An order Writ did not create. Worth recording rather than dropping: if this
    // ever fires it means something outside the gateway is creating orders on this
    // account, which is exactly the thing the gateway exists to prevent.
    await append({
      actor: "razorpay",
      type: "WEBHOOK_RECEIVED",
      payload: {
        event,
        handled: false,
        razorpayOrderId: orderId,
        note: "no matching purchase — this order was not created by the gateway",
      },
    });
    return { handled: false, event, note: "no matching purchase" };
  }

  if (purchase.status === "PAID") {
    return { handled: true, event, purchaseId: purchase.id, note: "already settled" };
  }

  await prisma.purchase.update({
    where: { id: purchase.id },
    data: {
      status: "PAID",
      razorpayPaymentId: payment?.id ?? purchase.razorpayPaymentId,
    },
  });

  await append({
    actor: "razorpay",
    type: "WEBHOOK_RECEIVED",
    mandateId: purchase.mandateId,
    runId: purchase.runId,
    amountPaise: purchase.amountPaise,
    payload: {
      event,
      handled: true,
      purchaseId: purchase.id,
      razorpayOrderId: orderId,
      razorpayPaymentId: payment?.id ?? null,
      method: payment?.method ?? null,
      amountPaise: purchase.amountPaise,
      note: "settled by Razorpay event, not by an optimistic local write",
    },
  });

  return { handled: true, event, purchaseId: purchase.id };
}

async function handlePaymentLinkPaid(
  evt: WebhookEvent,
  event: string,
): Promise<WebhookOutcome> {
  const link = evt.payload?.payment_link?.entity;
  const payment = evt.payload?.payment?.entity;

  // The gateway sets `reference_id` to the idempotency key, so the link maps back to
  // exactly one purchase without a second lookup table.
  const referenceId = link?.reference_id;

  const purchase = referenceId
    ? await prisma.purchase.findUnique({ where: { idempotencyKey: referenceId } })
    : null;

  if (!purchase) {
    await append({
      actor: "razorpay",
      type: "WEBHOOK_RECEIVED",
      payload: {
        event,
        handled: false,
        referenceId: referenceId ?? null,
        paymentLinkId: link?.id ?? null,
        note: "no matching purchase for reference_id",
      },
    });
    return { handled: false, event, note: "no matching purchase" };
  }

  if (purchase.status === "PAID") {
    return { handled: true, event, purchaseId: purchase.id, note: "already settled" };
  }

  await prisma.purchase.update({
    where: { id: purchase.id },
    data: {
      status: "PAID",
      razorpayPaymentId: payment?.id ?? purchase.razorpayPaymentId,
    },
  });

  await append({
    actor: "razorpay",
    type: "WEBHOOK_RECEIVED",
    mandateId: purchase.mandateId,
    runId: purchase.runId,
    amountPaise: purchase.amountPaise,
    payload: {
      event,
      handled: true,
      purchaseId: purchase.id,
      paymentLinkId: link?.id ?? null,
      razorpayPaymentId: payment?.id ?? null,
      amountPaise: purchase.amountPaise,
    },
  });

  return { handled: true, event, purchaseId: purchase.id };
}

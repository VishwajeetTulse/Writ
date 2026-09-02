import { prisma } from "../db";
import { append } from "../ledger";
import { fetchOrder } from "./client";

/**
 * Pull-based settlement, as a fallback to webhooks.
 *
 * Webhooks are push: they can be late, they can be dropped, and during a demo they
 * depend on a tunnel staying up. This asks Razorpay directly instead — "what is the
 * real status of the orders I think are outstanding?" — and settles from the answer.
 *
 * It is also the honest check on the whole ledger. Webhook settlement trusts an event;
 * this trusts nothing and goes to the source. If the two ever disagreed, this is what
 * would tell you.
 */

export interface ReconcileResult {
  checked: number;
  settled: number;
  stillPending: number;
  mismatches: Array<{ purchaseId: string; expectedPaise: bigint; razorpayPaise: number }>;
  errors: Array<{ purchaseId: string; error: string }>;
}

export async function reconcileOutstanding(opts?: {
  mandateId?: string;
  limit?: number;
}): Promise<ReconcileResult> {
  const outstanding = await prisma.purchase.findMany({
    where: {
      status: "CREATED",
      razorpayOrderId: { not: null },
      ...(opts?.mandateId ? { mandateId: opts.mandateId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
  });

  const result: ReconcileResult = {
    checked: outstanding.length,
    settled: 0,
    stillPending: 0,
    mismatches: [],
    errors: [],
  };

  for (const purchase of outstanding) {
    if (!purchase.razorpayOrderId) continue;

    try {
      const order = await fetchOrder(purchase.razorpayOrderId);

      // The amount Razorpay holds must match what we recorded. A mismatch would mean
      // the order was created with terms other than the ones the policy engine judged,
      // which is a far more serious problem than an unsettled payment.
      if (BigInt(order.amount) !== purchase.amountPaise) {
        result.mismatches.push({
          purchaseId: purchase.id,
          expectedPaise: purchase.amountPaise,
          razorpayPaise: order.amount,
        });
        await append({
          actor: "system",
          type: "RAZORPAY_ERROR",
          mandateId: purchase.mandateId,
          runId: purchase.runId,
          amountPaise: purchase.amountPaise,
          payload: {
            purchaseId: purchase.id,
            razorpayOrderId: order.id,
            expectedPaise: purchase.amountPaise,
            razorpayPaise: order.amount,
            note: "amount mismatch between ledger and Razorpay",
          },
        });
        continue;
      }

      if (order.status === "paid") {
        await prisma.purchase.update({
          where: { id: purchase.id },
          data: { status: "PAID" },
        });
        result.settled++;

        await append({
          actor: "razorpay",
          type: "WEBHOOK_RECEIVED",
          mandateId: purchase.mandateId,
          runId: purchase.runId,
          amountPaise: purchase.amountPaise,
          payload: {
            event: "reconcile",
            handled: true,
            purchaseId: purchase.id,
            razorpayOrderId: order.id,
            status: order.status,
            note: "settled by pull-based reconciliation, not by a webhook",
          },
        });
      } else {
        result.stillPending++;
      }
    } catch (err) {
      result.errors.push({
        purchaseId: purchase.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

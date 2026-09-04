import { prisma } from "../db";
import { append } from "../ledger";
import { fetchOrder } from "./client";

/**
 * Pull-based reconciliation against Razorpay.
 *
 * Webhooks are push: they can be late, they can be dropped, and during a demo they
 * depend on a tunnel staying up. This asks Razorpay directly instead — "what is the real
 * status of these orders?" — and settles from the answer.
 *
 * It runs **two passes**, and the second one exists because the first is not enough.
 *
 *   1. Purchases we believe are outstanding. Did any of them actually settle?
 *   2. Purchases we believe are settled. Does Razorpay agree that they were?
 *
 * The second pass was missing until it was noticed that this file claimed to be "the
 * honest check on the whole ledger" while only ever querying `status: "CREATED"`. It
 * could catch a settlement we had missed, and was structurally incapable of catching a
 * settlement we had invented — which is the more dangerous direction by a wide margin.
 * A purchase wrongly marked paid is a claim that money moved when it did not.
 *
 * Nothing here rewrites a status backwards. A discrepancy is recorded in the audit trail
 * and reported; deciding what it means is a human's job. Silently flipping rows to match
 * whichever source was consulted most recently would defeat the point of keeping a
 * ledger at all.
 */

export interface AmountMismatch {
  purchaseId: string;
  expectedPaise: bigint;
  razorpayPaise: number;
}

export interface FalseSettlement {
  purchaseId: string;
  razorpayOrderId: string;
  amountPaise: bigint;
  razorpayStatus: string;
  amountPaidPaise: number;
  attempts: number;
}

export interface ReconcileResult {
  /** Pass one: purchases we thought were outstanding. */
  checked: number;
  settled: number;
  stillPending: number;
  /** Pass two: purchases we thought were settled. */
  settledChecked: number;
  falseSettlements: FalseSettlement[];
  mismatches: AmountMismatch[];
  errors: Array<{ purchaseId: string; error: string }>;
}

export async function reconcileLedger(opts?: {
  mandateId?: string;
  limit?: number;
}): Promise<ReconcileResult> {
  const limit = opts?.limit ?? 50;
  const scope = opts?.mandateId ? { mandateId: opts.mandateId } : {};

  const [outstanding, believedSettled] = await Promise.all([
    prisma.purchase.findMany({
      where: { status: "CREATED", razorpayOrderId: { not: null }, ...scope },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.purchase.findMany({
      where: { status: "PAID", razorpayOrderId: { not: null }, ...scope },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const result: ReconcileResult = {
    checked: outstanding.length,
    settled: 0,
    stillPending: 0,
    settledChecked: believedSettled.length,
    falseSettlements: [],
    mismatches: [],
    errors: [],
  };

  // ---- Pass one: did anything settle without us hearing about it? ------------------
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

  // ---- Pass two: does Razorpay agree with everything we call settled? --------------
  for (const purchase of believedSettled) {
    if (!purchase.razorpayOrderId) continue;

    try {
      const order = await fetchOrder(purchase.razorpayOrderId);
      if (order.status === "paid") continue;

      result.falseSettlements.push({
        purchaseId: purchase.id,
        razorpayOrderId: order.id,
        amountPaise: purchase.amountPaise,
        razorpayStatus: order.status,
        amountPaidPaise: order.amount_paid,
        attempts: order.attempts,
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
          localStatus: "PAID",
          razorpayStatus: order.status,
          amountPaidPaise: order.amount_paid,
          attempts: order.attempts,
          note:
            "the ledger records this purchase as settled and Razorpay does not. " +
            "The status was not changed — this is a finding, not a repair.",
        },
      });
    } catch (err) {
      result.errors.push({
        purchaseId: purchase.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

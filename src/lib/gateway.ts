import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { getProduct, priceFor } from "./catalog";
import { getSpendState, loadMandate } from "./mandate-service";
import { append } from "./ledger";
import { evaluate, type PolicyDecision, type ReasonCode } from "./policy";
import { createOrder, createPaymentLink, RazorpayError } from "./razorpay/client";
import { InjectedFailure } from "./razorpay/chaos";

/**
 * THE GUARDED GATEWAY — the only code path in Writ that can reach money.
 *
 * The buyer agent has no Razorpay credentials. It cannot import the Razorpay client.
 * The single thing it can do that costs anything is call `attemptPurchase`, and this
 * function decides whether that call reaches an API or dies with a reason code.
 *
 * The order of checks below is the contract, and it is deliberate:
 *
 *   1. load mandate             -> MANDATE_NOT_FOUND
 *   2. verify signature         -> SIGNATURE_INVALID
 *   3. status / expiry          -> MANDATE_REVOKED | MANDATE_EXPIRED | MANDATE_EXHAUSTED
 *   4. price the SKU here       -> UNKNOWN_SKU        (the model's claim is discarded)
 *   5. policy.evaluate(...)     -> ALLOW | BLOCK(code)
 *   6. idempotency key unused   -> DUPLICATE_REQUEST
 *   7. call Razorpay            -> only reachable on ALLOW
 *   8. append an audit event    -> on EVERY branch, including the early refusals
 *
 * Step 8 is what makes the ledger evidence rather than decoration. A ledger that only
 * records successes proves nothing about what was stopped.
 */

export interface PurchaseRequest {
  mandateId: string;
  sku: string;
  quantity: number;
  idempotencyKey: string;
  runId?: string | null;
  /** Create a Payment Link as well as an Order. Used for the demo's flagship purchase. */
  withPaymentLink?: boolean;
}

export interface PurchaseResult {
  verdict: "ALLOW" | "BLOCK" | "ESCALATE";
  reasonCode: ReasonCode | "MANDATE_NOT_FOUND" | null;
  evidence: Record<string, unknown>;
  latencyUs: number;
  /** Present only on ALLOW. */
  purchaseId?: string;
  razorpayOrderId?: string;
  paymentLinkUrl?: string;
  amountPaise?: bigint;
  productName?: string;
  /** Present when Razorpay failed and we recovered. */
  recovered?: { attempts: number; failure: string };
}

export function newIdempotencyKey(): string {
  return `idem_${randomBytes(8).toString("hex")}`;
}

/**
 * Judge and, if permitted, execute one purchase.
 *
 * Never throws for a refusal — a blocked purchase is a normal outcome, and the agent
 * receives it as a structured result it can reason about. Only genuine infrastructure
 * failure produces an exception, and even that is caught and recorded below.
 */
export async function attemptPurchase(req: PurchaseRequest): Promise<PurchaseResult> {
  await append({
    actor: "agent",
    type: "PURCHASE_ATTEMPTED",
    mandateId: req.mandateId,
    runId: req.runId,
    payload: {
      sku: req.sku,
      quantity: req.quantity,
      idempotencyKey: req.idempotencyKey,
    },
  });

  // --- 1. Load ---------------------------------------------------------------
  const loaded = await loadMandate(req.mandateId);
  if (!loaded) {
    return refuse(req, "MANDATE_NOT_FOUND", { mandateId: req.mandateId }, 0);
  }

  // --- 4. Price it ourselves, before the policy engine sees the action --------
  // Done ahead of evaluation because the engine must judge the real amount. Whatever
  // the model believed this costs is irrelevant; the catalog is the authority.
  const product = await getProduct(req.sku);
  if (!product) {
    const decision = evaluate(
      { terms: loaded.terms, status: loaded.status, signatureValid: loaded.signatureValid },
      { spentPaise: 0n, recentPurchaseTimes: [], idempotencyKeyUsed: false },
      {
        sku: req.sku,
        quantity: req.quantity,
        merchantId: "",
        category: "",
        amountPaise: 0n,
        idempotencyKey: req.idempotencyKey,
      },
    );
    // Signature and status problems outrank an unknown SKU: a caller with no valid
    // authority should not learn whether a SKU exists.
    const code = decision.reasonCode ?? "UNKNOWN_SKU";
    return refuse(req, code, { sku: req.sku }, decision.latencyUs);
  }

  const amountPaise = priceFor(product, req.quantity);

  // --- 5 & 6. The policy engine (which also handles replay) ------------------
  const spend = await getSpendState(req.mandateId, req.idempotencyKey);

  const decision: PolicyDecision = evaluate(
    { terms: loaded.terms, status: loaded.status, signatureValid: loaded.signatureValid },
    spend,
    {
      sku: req.sku,
      quantity: req.quantity,
      merchantId: product.merchantId,
      category: product.category,
      amountPaise,
      idempotencyKey: req.idempotencyKey,
    },
  );

  await append({
    actor: "policy",
    type: "POLICY_DECISION",
    mandateId: req.mandateId,
    runId: req.runId,
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    amountPaise,
    latencyUs: decision.latencyUs,
    payload: {
      sku: req.sku,
      productName: product.name,
      quantity: req.quantity,
      merchantId: product.merchantId,
      merchantName: product.merchantName,
      category: product.category,
      amountPaise,
      idempotencyKey: req.idempotencyKey,
      ...decision.evidence,
    },
  });

  if (decision.verdict !== "ALLOW") {
    return {
      verdict: decision.verdict,
      reasonCode: decision.reasonCode,
      evidence: decision.evidence,
      latencyUs: decision.latencyUs,
      amountPaise,
      productName: product.name,
    };
  }

  // --- 7. Execute. Reachable only on ALLOW. ---------------------------------
  return execute({ req, product, amountPaise, decision });
}

async function refuse(
  req: PurchaseRequest,
  reasonCode: ReasonCode | "MANDATE_NOT_FOUND",
  evidence: Record<string, unknown>,
  latencyUs: number,
): Promise<PurchaseResult> {
  await append({
    actor: "policy",
    type: "POLICY_DECISION",
    mandateId: req.mandateId,
    runId: req.runId,
    verdict: "BLOCK",
    reasonCode: reasonCode === "MANDATE_NOT_FOUND" ? null : reasonCode,
    latencyUs,
    payload: { reasonCode, ...evidence },
  });

  return { verdict: "BLOCK", reasonCode, evidence, latencyUs };
}

/**
 * Create the Razorpay order, with one idempotent retry.
 *
 * This is the "one failure handled gracefully" path. When Razorpay times out we do not
 * know whether the order was created, so the retry reuses the same idempotency key in the
 * receipt and the same `Purchase` row is claimed under a unique index. A duplicate can
 * therefore never become a second charge, and if the retry also fails the mandate's spend
 * state is left exactly as it was.
 */
async function execute(args: {
  req: PurchaseRequest;
  product: NonNullable<Awaited<ReturnType<typeof getProduct>>>;
  amountPaise: bigint;
  decision: PolicyDecision;
}): Promise<PurchaseResult> {
  const { req, product, amountPaise, decision } = args;

  // Claim the idempotency key first. If two concurrent calls race, the unique index
  // means exactly one proceeds to Razorpay and the other is refused as a duplicate.
  const purchaseId = `pur_${randomBytes(6).toString("hex")}`;
  try {
    await prisma.purchase.create({
      data: {
        id: purchaseId,
        mandateId: req.mandateId,
        runId: req.runId ?? null,
        merchantId: product.merchantId,
        sku: product.sku,
        quantity: req.quantity,
        amountPaise,
        idempotencyKey: req.idempotencyKey,
        status: "CREATED",
      },
    });
  } catch {
    return refuse(req, "DUPLICATE_REQUEST", { idempotencyKey: req.idempotencyKey }, 0);
  }

  let lastFailure: string | null = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const order = await createOrder({
        amountPaise,
        receipt: req.idempotencyKey,
        notes: {
          mandate_id: req.mandateId,
          sku: product.sku,
          merchant: product.merchantName,
        },
        runId: req.runId,
      });

      let paymentLinkUrl: string | undefined;
      if (req.withPaymentLink) {
        try {
          const link = await createPaymentLink({
            amountPaise,
            description: `${product.name} — ${product.merchantName}`,
            referenceId: req.idempotencyKey,
            notes: { mandate_id: req.mandateId, order_id: order.id },
            runId: req.runId,
          });
          paymentLinkUrl = link.short_url;
        } catch {
          // A missing payment link is cosmetic — the order is the money action, and it
          // succeeded. Recorded below rather than failing the purchase.
          lastFailure = "payment_link_failed";
        }
      }

      await prisma.purchase.update({
        where: { id: purchaseId },
        data: { razorpayOrderId: order.id, paymentLinkUrl },
      });

      await append({
        actor: "razorpay",
        type: "ORDER_CREATED",
        mandateId: req.mandateId,
        runId: req.runId,
        amountPaise,
        payload: {
          purchaseId,
          razorpayOrderId: order.id,
          amountPaise,
          currency: order.currency,
          status: order.status,
          receipt: req.idempotencyKey,
          paymentLinkUrl: paymentLinkUrl ?? null,
          attempts: attempt,
        },
      });

      return {
        verdict: "ALLOW",
        reasonCode: null,
        evidence: decision.evidence,
        latencyUs: decision.latencyUs,
        purchaseId,
        razorpayOrderId: order.id,
        paymentLinkUrl,
        amountPaise,
        productName: product.name,
        ...(attempt > 1 ? { recovered: { attempts: attempt, failure: lastFailure ?? "" } } : {}),
      };
    } catch (err) {
      const injected = err instanceof InjectedFailure;
      const retryable = injected || (err instanceof RazorpayError && err.retryable);
      lastFailure = err instanceof Error ? err.message : String(err);

      await append({
        actor: "razorpay",
        type: attempt < maxAttempts && retryable ? "RAZORPAY_RETRY" : "RAZORPAY_ERROR",
        mandateId: req.mandateId,
        runId: req.runId,
        amountPaise,
        payload: {
          purchaseId,
          attempt,
          error: lastFailure,
          injected,
          retryable,
          idempotencyKey: req.idempotencyKey,
          note: retryable
            ? "Retrying with the same idempotency key. No money moved on this attempt."
            : "Not retryable. Purchase marked FAILED; mandate spend is unchanged.",
        },
      });

      if (!retryable || attempt === maxAttempts) {
        // Release the authority this purchase was holding. FAILED rows are excluded
        // from the spend calculation, so the mandate is left exactly as it was.
        await prisma.purchase.update({
          where: { id: purchaseId },
          data: { status: "FAILED" },
        });

        return {
          verdict: "BLOCK",
          reasonCode: null,
          evidence: {
            infrastructureFailure: true,
            error: lastFailure,
            attempts: attempt,
            moneyMoved: false,
            mandateUnchanged: true,
          },
          latencyUs: decision.latencyUs,
          amountPaise,
          productName: product.name,
        };
      }
    }
  }

  // Unreachable: the loop either returns a success or returns from the failure branch.
  throw new Error("gateway: unreachable");
}

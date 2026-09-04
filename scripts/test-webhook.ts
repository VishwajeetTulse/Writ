import "dotenv/config";
import { signWebhookBody } from "../src/lib/razorpay/webhook";
import { prisma } from "../src/lib/db";
import { formatPaise } from "../src/lib/money";
import { append } from "../src/lib/ledger";

/**
 * Local webhook harness.
 *
 * Posts Razorpay-shaped events at the running dev server, signed with the same secret
 * and the same algorithm Razorpay uses. This exists so the webhook path can be proven
 * correct without waiting on a tunnel, and so the demo has a fallback if ngrok drops.
 *
 * It signs a body; it does not fake a payment. The purchase and the order it settles
 * are real, created by the gateway against Razorpay's test API. What is simulated is
 * only the delivery of the notification.
 *
 * **It puts the purchase back afterwards.** Razorpay never collected anything for these
 * events, so a purchase left marked PAID is a claim that money moved when it did not —
 * exactly the drift `npm run reconcile` exists to catch, and it did catch three of them
 * that earlier runs of this script left behind. The audit events stay, because they
 * record something that genuinely happened; only the purchase status is restored, and
 * the restore is itself written to the ledger.
 *
 * Pass --keep to leave the purchase settled, for inspecting the reconciler's second pass.
 *
 * Usage:
 *   npx tsx scripts/test-webhook.ts                 # settle the newest unpaid purchase
 *   npx tsx scripts/test-webhook.ts <razorpayOrderId>
 *   npx tsx scripts/test-webhook.ts --keep
 */

const BASE = process.env.WRIT_BASE_URL ?? "http://localhost:3000";
const ENDPOINT = `${BASE}/api/webhooks/razorpay`;

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(20)}${value}`);
}

async function post(body: unknown, signature: string) {
  const raw = JSON.stringify(body);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": signature,
    },
    body: raw,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function orderPaidEvent(orderId: string, amountPaise: bigint, receipt: string) {
  return {
    entity: "event",
    account_id: "acc_test",
    event: "order.paid",
    contains: ["payment", "order"],
    payload: {
      payment: {
        entity: {
          id: `pay_test${Date.now().toString(36)}`,
          order_id: orderId,
          amount: Number(amountPaise),
          currency: "INR",
          status: "captured",
          method: "upi",
        },
      },
      order: {
        entity: {
          id: orderId,
          amount: Number(amountPaise),
          amount_paid: Number(amountPaise),
          currency: "INR",
          status: "paid",
          receipt,
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };
}

async function main() {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not set in .env.");
    console.error("Pick any string, put it in .env, and use the same value when you");
    console.error("create the webhook in the Razorpay dashboard.");
    process.exit(1);
  }

  console.log("\nWebhook harness\n");
  line("endpoint", ENDPOINT);

  const targetOrderId = process.argv[2];

  const purchase = targetOrderId
    ? await prisma.purchase.findFirst({ where: { razorpayOrderId: targetOrderId } })
    : await prisma.purchase.findFirst({
        where: { status: "CREATED", razorpayOrderId: { not: null } },
        orderBy: { createdAt: "desc" },
      });

  if (!purchase?.razorpayOrderId) {
    console.error("\nNo unsettled purchase with a Razorpay order id was found.");
    console.error("Run `npx tsx scripts/gate2.ts` first to create some.");
    process.exit(1);
  }

  line("purchase", purchase.id);
  line("order", purchase.razorpayOrderId);
  line("amount", formatPaise(purchase.amountPaise));
  line("status before", purchase.status);

  // --- 1. A tampered body must be rejected ---------------------------------
  console.log("\n  --- signature checks ---\n");

  const good = orderPaidEvent(
    purchase.razorpayOrderId,
    purchase.amountPaise,
    purchase.idempotencyKey,
  );
  const goodRaw = JSON.stringify(good);
  const goodSig = signWebhookBody(goodRaw, secret);

  const unsigned = await post(good, "");
  line("no signature", `HTTP ${unsigned.status} ${unsigned.status === 401 ? "rejected" : "ACCEPTED — BUG"}`);

  const wrongSig = await post(good, "0".repeat(64));
  line("wrong signature", `HTTP ${wrongSig.status} ${wrongSig.status === 401 ? "rejected" : "ACCEPTED — BUG"}`);

  // Same signature, body changed: this is the attack the HMAC exists to stop —
  // an attacker replaying a real event with the amount edited.
  const tampered = orderPaidEvent(purchase.razorpayOrderId, 1n, purchase.idempotencyKey);
  const tamperedRes = await post(tampered, goodSig);
  line(
    "tampered body",
    `HTTP ${tamperedRes.status} ${tamperedRes.status === 401 ? "rejected" : "ACCEPTED — BUG"}`,
  );

  // --- 2. The real thing ----------------------------------------------------
  console.log("\n  --- valid event ---\n");

  const valid = await post(good, goodSig);
  line("valid signature", `HTTP ${valid.status}`);
  line("handled", String(valid.json.handled));

  const after = await prisma.purchase.findUnique({ where: { id: purchase.id } });
  line("status after", after?.status ?? "?");
  line("payment id", after?.razorpayPaymentId ?? "—");

  // --- 3. Redelivery --------------------------------------------------------
  // Razorpay retries on any non-2xx and can deliver the same event twice even on
  // success, so a repeat must not settle the purchase a second time.
  console.log("\n  --- redelivery ---\n");

  const replay = await post(good, goodSig);
  line("same event again", `HTTP ${replay.status}`);
  line("note", String(replay.json.note ?? "—"));

  const paidEvents = await prisma.auditEvent.count({
    where: { type: "WEBHOOK_RECEIVED", runId: purchase.runId, verdict: null },
  });

  // --- assertions -----------------------------------------------------------
  const checks: Array<[string, boolean]> = [
    ["unsigned webhook rejected", unsigned.status === 401],
    ["wrong signature rejected", wrongSig.status === 401],
    ["tampered body rejected", tamperedRes.status === 401],
    ["valid webhook accepted", valid.status === 200 && valid.json.handled === true],
    ["purchase settled to PAID", after?.status === "PAID"],
    ["payment id recorded", Boolean(after?.razorpayPaymentId)],
    ["redelivery is a no-op", replay.json.note === "already settled"],
  ];

  // --- 4. Put it back -------------------------------------------------------
  const keep = process.argv.includes("--keep");
  if (!keep && after?.status === "PAID") {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { status: "CREATED", razorpayPaymentId: null },
    });
    await append({
      actor: "system",
      type: "RAZORPAY_ERROR",
      mandateId: purchase.mandateId,
      runId: purchase.runId,
      amountPaise: purchase.amountPaise,
      payload: {
        purchaseId: purchase.id,
        razorpayOrderId: purchase.razorpayOrderId,
        note:
          "test-webhook settled this purchase with a locally-signed event and then " +
          "restored it. Razorpay never collected anything for it.",
      },
    });
    console.log("\n  restored to CREATED — Razorpay never took this payment");
  }

  console.log("");
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n  ledger webhook events: ${paidEvents}`);

  if (failed > 0) {
    console.log(`\nWebhook harness FAILED — ${failed} check(s).\n`);
    process.exit(1);
  }
  console.log("\nWebhook path verified.\n");
}

main()
  .catch((err) => {
    console.error("\nHarness errored:");
    console.error(err instanceof Error ? err.message : err);
    console.error("\nIs the dev server running? `npm run dev`");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

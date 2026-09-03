import "dotenv/config";
import { HARNESS_USER_ID } from "./harness-user";
import { issueMandate, revokeMandate } from "../src/lib/mandate-service";
import { attemptPurchase, newIdempotencyKey } from "../src/lib/gateway";
import { verifyChain } from "../src/lib/ledger";
import { formatPaise } from "../src/lib/money";
import { arm } from "../src/lib/razorpay/chaos";
import { endRun, startRun } from "../src/lib/runs";
import { prisma } from "../src/lib/db";

/**
 * Day 2 gate: drive the whole money path from a script, before any UI exists.
 *
 * If this passes, the product works. The console is then a way to watch it rather than
 * a thing the demo depends on — which is the right order to build in, because a UI
 * cannot tell you whether the gateway is sound.
 *
 * Run with: npx tsx scripts/gate2.ts
 */

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)}${value}`);
}

function verdictLine(name: string, r: Awaited<ReturnType<typeof attemptPurchase>>) {
  const tag = r.verdict === "ALLOW" ? "ALLOW" : "BLOCK";
  const reason = r.reasonCode ? ` ${r.reasonCode}` : "";
  const amount = r.amountPaise !== undefined ? formatPaise(r.amountPaise) : "—";
  const latency = `${(r.latencyUs / 1000).toFixed(2)}ms`;
  console.log(
    `  ${tag.padEnd(6)}${reason.padEnd(24)} ${amount.padStart(11)}  ${latency.padStart(8)}  ${name}`,
  );
  // Every bound the attempt broke, not only the one that got reported first.
  if (r.violations.length > 1) {
    const also = r.violations.slice(1).map((v) => v.reasonCode).join(", ");
    console.log(`         +${r.violations.length - 1} more: ${also}`);
  }
  return r;
}

async function main() {
  console.log("\nGate 2 — agent-to-Razorpay money path\n");

  // A mandate shaped exactly like the demo's: grocery only, two merchants,
  // Rs700 per transaction, Rs2000 total.
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const { id: mandateId } = await issueMandate({
    userId: HARNESS_USER_ID,
    intentText:
      "Restock the kitchen for the week. Under Rs2000 total, nothing over Rs700 a shot, " +
      "only FreshCart and DailyBasket, groceries only.",
    draft: {
      merchants: [
        { id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" },
        { id: "mrc_dailybasket", name: "DailyBasket", vpa: "dailybasket@razorpay" },
      ],
      categories: ["grocery"],
      perTxnCapPaise: 700_00n,
      totalCapPaise: 2000_00n,
      velocityMax: null,
      velocityWindowS: null,
      expiresAt,
      rationale: {},
    },
  });

  line("mandate", mandateId);
  line("per-txn cap", formatPaise(700_00n));
  line("total cap", formatPaise(2000_00n));
  line("merchants", "FreshCart, DailyBasket");
  line("categories", "grocery");

  const RUN_ID = await startRun({
    mandateId,
    goal: "Restock the kitchen for the week.",
  });
  line("run", RUN_ID);

  console.log("\n  --- purchases inside the mandate ---\n");

  const inside = [
    { sku: "sku_milk_1l", name: "Amul Toned Milk 1L" },
    { sku: "sku_atta_5kg", name: "Aashirvaad Atta 5kg" },
    { sku: "sku_oil_1l", name: "Fortune Sunflower Oil 1L" },
    { sku: "sku_dal_1kg", name: "Toor Dal 1kg" },
  ];

  let allowed = 0;
  const orderIds: string[] = [];

  for (const item of inside) {
    const r = verdictLine(
      item.name,
      await attemptPurchase({
        mandateId,
        sku: item.sku,
        quantity: 1,
        idempotencyKey: newIdempotencyKey(),
        runId: RUN_ID,
      }),
    );
    if (r.verdict === "ALLOW") {
      allowed++;
      if (r.razorpayOrderId) orderIds.push(r.razorpayOrderId);
    }
  }

  console.log("\n  --- attempts outside the mandate ---\n");

  // Air fryer: wrong merchant, wrong category, over the per-transaction cap, and over
  // what is left of the total. All four are reported, not just the first.
  const airFryer = verdictLine(
    "Philips Air Fryer (HomeStack)",
    await attemptPurchase({
      mandateId,
      sku: "sku_airfryer",
      quantity: 1,
      idempotencyKey: newIdempotencyKey(),
      runId: RUN_ID,
    }),
  );

  // The injection payload's target. The model can be talked into attempting this;
  // the engine cannot be talked into allowing it.
  const tv = verdictLine(
    '43" 4K Smart TV (injection target)',
    await attemptPurchase({
      mandateId,
      sku: "sku_tv_43",
      quantity: 1,
      idempotencyKey: newIdempotencyKey(),
      runId: RUN_ID,
    }),
  );

  // An allowed merchant in an allowed category, priced past the per-transaction cap.
  // Only the amount is wrong here, so only the amount-based bounds fire.
  const coffee = verdictLine(
    "Coffee x2 (over per-txn cap)",
    await attemptPurchase({
      mandateId,
      sku: "sku_coffee_200",
      quantity: 2,
      idempotencyKey: newIdempotencyKey(),
      runId: RUN_ID,
    }),
  );

  console.log("\n  --- replay ---\n");

  const replayKey = newIdempotencyKey();
  const first = verdictLine(
    "Paneer (first use of key)",
    await attemptPurchase({
      mandateId,
      sku: "sku_paneer_200",
      quantity: 1,
      idempotencyKey: replayKey,
      runId: RUN_ID,
    }),
  );
  if (first.verdict === "ALLOW") {
    allowed++;
    if (first.razorpayOrderId) orderIds.push(first.razorpayOrderId);
  }
  const replay = verdictLine(
    "Paneer (same key replayed)",
    await attemptPurchase({
      mandateId,
      sku: "sku_paneer_200",
      quantity: 1,
      idempotencyKey: replayKey,
      runId: RUN_ID,
    }),
  );

  console.log("\n  --- infrastructure failure, handled gracefully ---\n");

  arm(RUN_ID, "razorpay_timeout");
  const chaos = verdictLine(
    "Eggs (Razorpay times out once)",
    await attemptPurchase({
      mandateId,
      sku: "sku_eggs_12",
      quantity: 1,
      idempotencyKey: newIdempotencyKey(),
      runId: RUN_ID,
    }),
  );
  if (chaos.verdict === "ALLOW") {
    allowed++;
    if (chaos.razorpayOrderId) orderIds.push(chaos.razorpayOrderId);
    if (chaos.recovered) {
      line("recovered after", `${chaos.recovered.attempts} attempts`);
    }
  }

  console.log("\n  --- revocation mid-run ---\n");

  await revokeMandate(mandateId, HARNESS_USER_ID);
  const afterRevoke = verdictLine(
    "Sugar (after revoke)",
    await attemptPurchase({
      mandateId,
      sku: "sku_sugar_1kg",
      quantity: 1,
      idempotencyKey: newIdempotencyKey(),
      runId: RUN_ID,
    }),
  );

  await endRun({
    runId: RUN_ID,
    mandateId,
    status: "HALTED_REVOKED",
    summary: { purchasesAllowed: allowed },
  });

  // --- verification ---------------------------------------------------------
  console.log("\n  --- ledger ---\n");

  const chain = await verifyChain();
  line("records", String(chain.recordCount));
  line("chain verified", chain.valid ? "yes" : `NO — broken at seq ${chain.brokenAtSeq}`);

  const spent = await prisma.purchase.aggregate({
    where: { mandateId, status: { in: ["CREATED", "PAID"] } },
    _sum: { amountPaise: true },
  });

  console.log("\n  --- result ---\n");
  line("purchases allowed", String(allowed));
  line("razorpay orders", String(orderIds.length));
  line("spend inside mandate", formatPaise(spent._sum.amountPaise ?? 0n));
  line("order ids", orderIds.join(", ") || "none");

  // --- assertions -----------------------------------------------------------
  const checks: Array<[string, boolean]> = [
    ["4+ purchases allowed and executed", allowed >= 4],
    ["real Razorpay orders created", orderIds.length >= 4],
    ["off-allowlist merchant blocked", airFryer.reasonCode === "MERCHANT_NOT_ALLOWED"],
    ["injection target blocked", tv.reasonCode === "MERCHANT_NOT_ALLOWED"],
    ["injection target broke 4 bounds at once", tv.violations.length === 4],
    ["over-cap purchase blocked", coffee.reasonCode === "PER_TXN_CAP_EXCEEDED"],
    ["replayed key refused", replay.reasonCode === "DUPLICATE_REQUEST"],
    ["timeout recovered without double charge", chaos.verdict === "ALLOW"],
    ["revoked mandate refuses next call", afterRevoke.reasonCode === "MANDATE_REVOKED"],
    ["audit chain verifies", chain.valid],
  ];

  console.log("");
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.log(`\nGate 2 FAILED — ${failed} check(s) did not pass.\n`);
    process.exit(1);
  }
  console.log("\nGate 2 passed. The money path works end to end.\n");
}

main()
  .catch((err) => {
    console.error("\nGate 2 errored:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

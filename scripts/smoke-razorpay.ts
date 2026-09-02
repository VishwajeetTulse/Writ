import "dotenv/config";
import { createOrder, fetchOrder, isTestMode } from "../src/lib/razorpay/client";
import { formatPaise } from "../src/lib/money";

/**
 * Day 1 gate: prove we can reach Razorpay and create a real test-mode order.
 *
 * Run with `npm run smoke:razorpay`. This deliberately does nothing clever — if it
 * prints an order id, the credentials, the network path, and the request shape are all
 * correct, and every later failure is our code rather than the integration.
 */

async function main() {
  console.log("Razorpay smoke test\n");

  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) {
    console.error("RAZORPAY_KEY_ID is not set.");
    console.error("Copy .env.example to .env and add your test-mode keys from");
    console.error("the Razorpay dashboard: Settings -> API Keys -> Generate Test Key.");
    process.exit(1);
  }

  console.log(`  key id     ${keyId}`);
  if (!isTestMode()) {
    console.error("\n  REFUSING TO RUN: this key is not a test-mode key.");
    console.error("  Test keys start with 'rzp_test_'. Writ never runs against live keys.");
    process.exit(1);
  }
  console.log("  mode       test (no real money can move)\n");

  const amountPaise = 68_00n;
  const receipt = `smoke_${Date.now()}`;

  console.log(`  creating order for ${formatPaise(amountPaise)}…`);
  const order = await createOrder({
    amountPaise,
    receipt,
    notes: { source: "writ-smoke-test" },
  });

  console.log(`  created    ${order.id}`);
  console.log(`  amount     ${order.amount} paise (${order.currency})`);
  console.log(`  status     ${order.status}`);

  console.log("\n  fetching it back…");
  const fetched = await fetchOrder(order.id);
  console.log(`  fetched    ${fetched.id} · ${fetched.status}`);

  if (fetched.amount !== Number(amountPaise)) {
    console.error(
      `\n  MISMATCH: sent ${amountPaise} paise, Razorpay returned ${fetched.amount}.`,
    );
    process.exit(1);
  }

  console.log("\nGate 1 passed. Razorpay test-mode integration is live.");
  console.log(`Check it in the dashboard: Transactions -> Orders -> ${order.id}`);
}

main().catch((err) => {
  console.error("\nSmoke test failed:");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  if (err && typeof err === "object" && "statusCode" in err) {
    console.error(`  status: ${(err as { statusCode: number }).statusCode}`);
  }
  process.exit(1);
});

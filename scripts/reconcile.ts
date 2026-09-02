import "dotenv/config";
import { reconcileOutstanding } from "../src/lib/razorpay/reconcile";
import { formatPaise } from "../src/lib/money";
import { prisma } from "../src/lib/db";

/**
 * Ask Razorpay what actually happened, rather than waiting to be told.
 *
 * Usage: npx tsx scripts/reconcile.ts
 */
async function main() {
  console.log("\nReconciling outstanding purchases against Razorpay\n");
  const r = await reconcileOutstanding();

  console.log(`  checked        ${r.checked}`);
  console.log(`  settled        ${r.settled}`);
  console.log(`  still pending  ${r.stillPending}`);
  console.log(`  mismatches     ${r.mismatches.length}`);
  console.log(`  errors         ${r.errors.length}`);

  for (const m of r.mismatches) {
    console.log(
      `\n  MISMATCH ${m.purchaseId}: ledger ${formatPaise(m.expectedPaise)} ` +
        `vs Razorpay ${formatPaise(BigInt(m.razorpayPaise))}`,
    );
  }
  for (const e of r.errors) {
    console.log(`\n  ERROR ${e.purchaseId}: ${e.error}`);
  }

  if (r.mismatches.length > 0) {
    console.log("\nAmount mismatch found. The ledger and Razorpay disagree.\n");
    process.exit(1);
  }
  console.log("\nLedger agrees with Razorpay.\n");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

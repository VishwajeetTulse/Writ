import "dotenv/config";
import { reconcileLedger } from "../src/lib/razorpay/reconcile";
import { formatPaise } from "../src/lib/money";
import { prisma } from "../src/lib/db";

/**
 * Ask Razorpay what actually happened, rather than waiting to be told.
 *
 * Usage: npm run reconcile
 *
 * The closing line only claims what was actually checked. An earlier version printed
 * "Ledger agrees with Razorpay" after querying nothing but the pending rows, which was
 * a statement about the whole ledger backed by a look at part of it.
 */
async function main() {
  console.log("\nReconciling against Razorpay\n");
  const r = await reconcileLedger();

  console.log("  outstanding purchases");
  console.log(`    checked        ${r.checked}`);
  console.log(`    settled now    ${r.settled}`);
  console.log(`    still pending  ${r.stillPending}`);
  console.log("  purchases the ledger calls settled");
  console.log(`    checked        ${r.settledChecked}`);
  console.log(`    unconfirmed    ${r.falseSettlements.length}`);
  console.log(`  amount mismatches  ${r.mismatches.length}`);
  console.log(`  errors             ${r.errors.length}`);

  for (const m of r.mismatches) {
    console.log(
      `\n  MISMATCH ${m.purchaseId}: ledger ${formatPaise(m.expectedPaise)} ` +
        `vs Razorpay ${formatPaise(BigInt(m.razorpayPaise))}`,
    );
  }

  for (const f of r.falseSettlements) {
    console.log(
      `\n  UNCONFIRMED ${f.razorpayOrderId}: the ledger says ${formatPaise(f.amountPaise)} ` +
        `settled, Razorpay says status=${f.razorpayStatus}, ` +
        `paid=${formatPaise(BigInt(f.amountPaidPaise))}, attempts=${f.attempts}.`,
    );
  }

  for (const e of r.errors) {
    console.log(`\n  ERROR ${e.purchaseId}: ${e.error}`);
  }

  if (r.mismatches.length > 0 || r.falseSettlements.length > 0) {
    console.log(
      "\nThe ledger and Razorpay disagree. Nothing was rewritten — each disagreement\n" +
        "is now an entry in the audit trail.\n",
    );
    process.exit(1);
  }

  console.log(
    `\nRazorpay agrees with all ${r.checked + r.settledChecked} purchases checked.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { rowToTerms } from "../src/lib/mandate-service";
import { toAutopayToken, unmappedBounds } from "../src/lib/razorpay/autopay";
import {
  createAutopayAuthorizationOrder,
  createCustomer,
  fetchCustomers,
  RazorpayError,
} from "../src/lib/razorpay/client";

/**
 * Take a real signed mandate to the real UPI Autopay endpoint and print what happens.
 *
 * This script exists to answer one question honestly: how far does a Writ mandate get
 * on the actual rail, today, with the keys in this .env? It does not simulate anything
 * and it does not swallow errors. If Razorpay says the account cannot do this yet, that
 * answer is the output.
 *
 *     npm run autopay:probe
 */

async function main() {
  const row = await prisma.mandate.findFirst({
    // Expiry derived rather than trusted from the stored status, the same way
    // `loadMandate` does it. A lapsed row still reads ACTIVE, and compiling one of those
    // sends Razorpay an expiry in the past — which comes back as "start time should be
    // less than end time" and looks like a rail limitation rather than a stale mandate.
    where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!row) {
    console.error("No active mandate. Sign in and issue one first.");
    process.exit(1);
  }

  const terms = rowToTerms(row);
  const token = toAutopayToken(terms);

  console.log(`Mandate ${row.id}`);
  console.log(`  "${row.intentText}"\n`);

  console.log("Compiles to a UPI Autopay token:");
  console.log(`  max_amount   ${token.max_amount} paise`);
  console.log(
    `  expire_at    ${token.expire_at}  (${new Date(token.expire_at * 1000).toISOString()})`,
  );
  console.log(`  frequency    ${token.frequency}\n`);

  console.log("Bounds the rail cannot carry, enforced by the policy engine instead:");
  for (const b of unmappedBounds(terms)) {
    console.log(`  ${b.bound.padEnd(14)} ${b.value}`);
    console.log(`  ${" ".repeat(14)} ${b.why}`);
  }
  console.log("");

  console.log("Calling Razorpay…\n");

  const EMAIL = "probe@example.com";
  let customerId: string;

  try {
    const customer = await createCustomer({
      name: "Writ Autopay Probe",
      contact: "9999999999",
      email: EMAIL,
      notes: { mandateId: row.id },
    });
    customerId = customer.id;
    console.log(`  POST /customers        -> ${customer.id}`);
  } catch (err) {
    // A second run of this script hits a customer it made the first time. That is a
    // normal condition, not a failure — find the existing id and carry on.
    const existing = (await fetchCustomers()).items.find((c) => c.email === EMAIL);
    if (!existing) {
      report("POST /customers", err);
      return;
    }
    customerId = existing.id;
    console.log(`  GET  /customers        -> ${existing.id} (reused)`);
  }

  try {
    const order = await createAutopayAuthorizationOrder({
      customerId,
      token,
      receipt: `autopay_${row.id}`,
      notes: { mandateId: row.id },
    });
    console.log(`  POST /orders (upi)     -> ${order.id}`);
    console.log(`\nAuthorisation order created. The next step is the one this`);
    console.log(`prototype does not do: the customer approves the mandate once in a`);
    console.log(`UPI app, which returns a token_id that can then be charged.`);
  } catch (err) {
    report("POST /orders (upi)", err);
  }
}

/** Print exactly what Razorpay said. No interpretation, no fallback, no pretending. */
function report(call: string, err: unknown) {
  if (err instanceof RazorpayError) {
    console.log(`  ${call.padEnd(22)} -> HTTP ${err.statusCode}`);
    console.log(`\nRazorpay said: ${err.message}`);
    if (err.body) console.log(JSON.stringify(err.body, null, 2));
    console.log(
      "\nPrinted verbatim rather than interpreted. The point of this script is " +
        "to find the real edge of the integration, not to describe one.",
    );
    return;
  }
  console.log(`  ${call.padEnd(22)} -> failed`);
  console.error(err);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

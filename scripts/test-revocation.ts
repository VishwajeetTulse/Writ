import "dotenv/config";
import { HARNESS_USER_ID } from "./harness-user";
import { prisma } from "../src/lib/db";
import { formatPaise } from "../src/lib/money";
import { issueMandate, revokeMandate } from "../src/lib/mandate-service";
import { runScripted } from "../src/lib/agent/scripted";
import type { RunEvent } from "../src/lib/agent/events";

/**
 * Revocation, mid-run.
 *
 * Issues a fresh mandate, starts a run, and revokes while the run is still going —
 * exactly what the Revoke button on the console does. Then it asserts the two things
 * that make revocation meaningful rather than cosmetic:
 *
 *   1. The very next purchase attempt is refused with MANDATE_REVOKED.
 *   2. The run is recorded as HALTED_REVOKED, not as having completed.
 *
 * Nothing coordinates this. Revoking flips one column; the gateway re-reads mandate
 * status on every attempt and never caches it, so the run finds out by being told no.
 * That is why there is no message to deliver and no in-flight request to cancel.
 *
 * It drives the run in-process rather than over HTTP. Starting a run from the console
 * is a signed-in action now, and a harness holding a browser session would be testing
 * the sign-in flow rather than the thing that matters. The revocation semantics are
 * identical either way: the gateway re-reads the mandate on every attempt and has no
 * idea who asked.
 *
 * Usage: npm run revoke:test   (no server required)
 */

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)}${value}`);
}

async function main() {
  console.log("\nRevocation harness\n");

  const { id: mandateId } = await issueMandate({
    userId: HARNESS_USER_ID,
    intentText: "Revocation harness — issued and revoked inside one run.",
    draft: {
      merchants: [
        { id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" },
      ],
      categories: ["grocery"],
      perTxnCapPaise: 700_00n,
      totalCapPaise: 2000_00n,
      velocityMax: null,
      velocityWindowS: null,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      rationale: {},
    },
  });

  line("mandate", mandateId);
  console.log("");

  let lastDecision: Extract<RunEvent, { type: "decision" }> | null = null;
  let endStatus: string | null = null;
  let revoked = false;
  let allowedBeforeRevoke = 0;

  // Events arrive synchronously from the driver, so the revocation is fired from
  // inside the handler — the same instant a human would reach for the button.
  const pending: Array<Promise<void>> = [];

  await runScripted({
    mandateId,
    goal: "Restock the weekly essentials.",
    pauseForRevocation: true,
    emit: (event) => {
      if (event.type === "decision") {
        lastDecision = event;
        if (event.verdict === "ALLOW" && !revoked) allowedBeforeRevoke++;
        console.log(
          `  ${event.verdict.padEnd(6)} ${(event.reasonCode ?? "").padEnd(22)} ${event.productName}`,
        );
      } else if (event.type === "note") {
        if (event.text.startsWith("Holding for")) {
          pending.push(
            revokeMandate(mandateId, HARNESS_USER_ID).then((ok) => {
              revoked = ok;
              console.log(`\n  >> revoked mid-run (${ok ? "accepted" : "REFUSED"})\n`);
            }),
          );
        }
      } else if (event.type === "run_ended") {
        endStatus = event.status;
        console.log("");
        line("attempted", String(event.summary.attempted));
        line("allowed", String(event.summary.allowed));
        line("refused", String(event.summary.blocked));
        line("spent", formatPaise(BigInt(event.summary.spentPaise)));
        line("run status", event.status);
      }
    },
  });

  await Promise.all(pending);

  const decision = lastDecision as Extract<RunEvent, { type: "decision" }> | null;

  const checks: Array<[string, boolean]> = [
    ["mandate spent inside its bounds first", allowedBeforeRevoke > 0],
    ["revocation accepted", revoked],
    ["next attempt refused as revoked", decision?.reasonCode === "MANDATE_REVOKED"],
    ["refusal took under 5ms", (decision?.latencyUs ?? Infinity) < 5000],
    ["run recorded as halted, not completed", endStatus === "HALTED_REVOKED"],
  ];

  console.log("");
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.log(`\nRevocation harness FAILED — ${failed} check(s).\n`);
    process.exit(1);
  }
  console.log("\nRevocation is effective on the next call.\n");
}

main()
  .catch((err) => {
    console.error("\nHarness errored:");
    console.error(err instanceof Error ? err.message : err);
    console.error("\nIs the dev server running? `npm run dev`");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

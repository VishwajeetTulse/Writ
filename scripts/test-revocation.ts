import "dotenv/config";
import { prisma } from "../src/lib/db";
import { formatPaise } from "../src/lib/money";
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
 * Usage: npm run revoke:test   (needs the dev server running)
 */

const BASE = process.env.WRIT_BASE_URL ?? "http://localhost:3000";

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)}${value}`);
}

async function main() {
  console.log("\nRevocation harness\n");

  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const issueRes = await fetch(`${BASE}/api/mandates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intentText: "Revocation harness — issued and revoked inside one run.",
      merchants: [{ id: "mrc_freshcart", name: "FreshCart", vpa: "freshcart@razorpay" }],
      categories: ["grocery"],
      perTxnCapRupees: 700,
      totalCapRupees: 2000,
      expiresAt,
    }),
  });

  const issued = (await issueRes.json()) as { id?: string; error?: string };
  if (!issued.id) {
    console.error("Could not issue a mandate:", issued.error ?? issueRes.status);
    process.exit(1);
  }

  line("mandate", issued.id);
  line("endpoint", `${BASE}/api/agent/run`);
  console.log("");

  const res = await fetch(`${BASE}/api/agent/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mandateId: issued.id,
      goal: "Restock the weekly essentials.",
      pauseForRevocation: true,
    }),
  });

  if (!res.body) {
    console.error("The run returned no stream.");
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let lastDecision: Extract<RunEvent, { type: "decision" }> | null = null;
  let endStatus: string | null = null;
  let revokeStatus = 0;
  let allowedBeforeRevoke = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const raw = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!raw) continue;

      const event = JSON.parse(raw.slice(6)) as RunEvent;

      if (event.type === "decision") {
        lastDecision = event;
        if (event.verdict === "ALLOW" && revokeStatus === 0) allowedBeforeRevoke++;
        console.log(
          `  ${event.verdict.padEnd(6)} ${(event.reasonCode ?? "").padEnd(22)} ${event.productName}`,
        );
      } else if (event.type === "note") {
        // Revoke the moment the run announces its hold — the same instant a human
        // would reach for the button.
        if (event.text.startsWith("Holding for")) {
          const revoke = await fetch(`${BASE}/api/mandates/${issued.id}/revoke`, {
            method: "POST",
          });
          revokeStatus = revoke.status;
          console.log(`\n  >> revoked mid-run (HTTP ${revoke.status})\n`);
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
    }
  }

  const checks: Array<[string, boolean]> = [
    ["mandate spent inside its bounds first", allowedBeforeRevoke > 0],
    ["revocation accepted", revokeStatus === 200],
    ["next attempt refused as revoked", lastDecision?.reasonCode === "MANDATE_REVOKED"],
    ["refusal took under 5ms", (lastDecision?.latencyUs ?? Infinity) < 5000],
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

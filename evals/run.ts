import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, REASON_CODES, type ReasonCode } from "../src/lib/policy";
import {
  EVAL_CASES,
  COVERED_REASON_CODES,
  UNCOVERED_REASON_CODES,
  type EvalCase,
} from "./cases";

/**
 * Score the policy engine.
 *
 * The headline number is not accuracy. Accuracy averages two failures that cost
 * completely different things, and averaging them hides the one that matters.
 *
 *   A **false negative** is a purchase that should have been refused and was not.
 *   That is money leaving an account without authority. There is no acceptable
 *   number of these other than zero, and this runner exits non-zero if there is one.
 *
 *   A **false positive** is a purchase that should have been permitted and was not.
 *   That is a sale the merchant did not make. It is a real cost and it is worth
 *   reporting honestly, but it is recoverable in a way the other is not.
 *
 * So the two are scored separately, printed separately, and only one of them fails
 * the build.
 *
 * The results are written to `evals/results.json` and committed, so the claim in the
 * README is checkable without running anything.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface CaseResult {
  id: string;
  group: string;
  label: string;
  expected: string;
  expectedReason: ReasonCode | null;
  actual: string;
  actualReason: ReasonCode | null;
  actualViolations: ReasonCode[];
  latencyUs: number;
  passed: boolean;
  /** Why it failed, when it did. */
  failure?: string;
}

function scoreOne(c: EvalCase): CaseResult {
  const decision = evaluate(c.mandate, c.spend, c.action, c.now);

  const actualViolations = decision.violations.map((v) => v.reasonCode);
  const base = {
    id: c.id,
    group: c.group,
    label: c.label,
    expected: c.expect,
    expectedReason: c.expectReason ?? null,
    actual: decision.verdict,
    actualReason: decision.reasonCode,
    actualViolations,
    latencyUs: decision.latencyUs,
  };

  if (decision.verdict !== c.expect) {
    return {
      ...base,
      passed: false,
      failure: `expected ${c.expect}, got ${decision.verdict}`,
    };
  }

  if (c.expectReason && decision.reasonCode !== c.expectReason) {
    return {
      ...base,
      passed: false,
      failure: `expected primary reason ${c.expectReason}, got ${decision.reasonCode}`,
    };
  }

  if (c.expectAllViolations) {
    const expected = c.expectAllViolations.join(",");
    const got = actualViolations.join(",");
    if (expected !== got) {
      return {
        ...base,
        passed: false,
        failure: `expected violations [${expected}], got [${got}]`,
      };
    }
  }

  return { ...base, passed: true };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(i, 0)];
}

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function main() {
  console.log("\nWrit — policy engine evaluation\n");

  const results = EVAL_CASES.map(scoreOne);

  const mustBlock = results.filter((r) => r.expected === "BLOCK");
  const mustAllow = results.filter((r) => r.expected === "ALLOW");

  // The two failures that are not the same failure.
  const falseNegatives = mustBlock.filter((r) => r.actual === "ALLOW");
  const falsePositives = mustAllow.filter((r) => r.actual !== "ALLOW");
  // Blocked correctly, but named the wrong primary cause. Not a safety failure —
  // the money did not move — but it breaks the ledger's ability to explain itself.
  const misattributed = results.filter(
    (r) => !r.passed && r.actual === r.expected && r.actual === "BLOCK",
  );

  const passed = results.filter((r) => r.passed);
  const latencies = results.map((r) => r.latencyUs).sort((a, b) => a - b);

  // ---- per reason code ----------------------------------------------------
  const byReason = COVERED_REASON_CODES.map((code) => {
    const expected = mustBlock.filter((r) => r.expectedReason === code);
    const caught = expected.filter(
      (r) => r.actual === "BLOCK" && r.actualReason === code,
    );
    return { reasonCode: code, cases: expected.length, caught: caught.length };
  }).filter((r) => r.cases > 0);

  const untested = COVERED_REASON_CODES.filter(
    (code) => !byReason.some((r) => r.reasonCode === code),
  );

  // ---- per group ----------------------------------------------------------
  const groups = Array.from(new Set(results.map((r) => r.group))).map((group) => {
    const inGroup = results.filter((r) => r.group === group);
    return {
      group,
      cases: inGroup.length,
      passed: inGroup.filter((r) => r.passed).length,
    };
  });

  // ---- print --------------------------------------------------------------
  console.log(`  ${EVAL_CASES.length} cases · ${mustBlock.length} must block · ${mustAllow.length} must allow\n`);

  for (const g of groups) {
    const ok = g.passed === g.cases;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${g.group.padEnd(22)} ${String(g.passed).padStart(3)}/${String(g.cases).padEnd(3)}`,
    );
  }

  console.log("\n  Refusals by cause\n");
  for (const r of byReason) {
    const ok = r.caught === r.cases;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${r.reasonCode.padEnd(22)} ${String(r.caught).padStart(3)}/${String(r.cases).padEnd(3)}  recall ${pct(r.caught, r.cases)}`,
    );
  }

  if (untested.length > 0) {
    console.log(`\n  Not exercised by any case: ${untested.join(", ")}`);
  }
  console.log(
    `  Out of scope for this suite: ${UNCOVERED_REASON_CODES.join(", ")} (raised by the gateway, not the engine)`,
  );

  console.log("\n  Headline\n");
  console.log(`    false negatives   ${falseNegatives.length}   (money that should not have moved)`);
  console.log(`    false positives   ${falsePositives.length}   (sales that should have gone through)`);
  console.log(`    misattributed     ${misattributed.length}   (blocked, but named the wrong cause)`);
  console.log(`    block recall      ${pct(mustBlock.length - falseNegatives.length, mustBlock.length)}`);
  console.log(`    allow accuracy    ${pct(mustAllow.length - falsePositives.length, mustAllow.length)}`);
  console.log(`    overall           ${passed.length}/${results.length}`);

  console.log("\n  Decision latency\n");
  console.log(`    p50 ${(percentile(latencies, 50) / 1000).toFixed(3)}ms`);
  console.log(`    p95 ${(percentile(latencies, 95) / 1000).toFixed(3)}ms`);
  console.log(`    max ${(latencies.at(-1) ?? 0) / 1000}ms`);

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  Failures\n`);
    for (const f of failures) {
      const critical = f.expected === "BLOCK" && f.actual === "ALLOW";
      console.log(`  ${critical ? "!!" : "  "}  ${f.id}  ${f.label}`);
      console.log(`        ${f.failure}`);
    }
  }

  // ---- write --------------------------------------------------------------
  const report = {
    generatedAt: new Date().toISOString(),
    engine: "src/lib/policy.ts :: evaluate",
    note:
      "Scored against the pure policy function, with no database, network or model in " +
      "the path. Every case fixes its own clock, so this is reproducible.",
    totals: {
      cases: results.length,
      passed: passed.length,
      failed: failures.length,
      mustBlock: mustBlock.length,
      mustAllow: mustAllow.length,
    },
    headline: {
      falseNegatives: falseNegatives.length,
      falsePositives: falsePositives.length,
      misattributed: misattributed.length,
      blockRecall: mustBlock.length
        ? (mustBlock.length - falseNegatives.length) / mustBlock.length
        : null,
      allowAccuracy: mustAllow.length
        ? (mustAllow.length - falsePositives.length) / mustAllow.length
        : null,
    },
    latencyUs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.at(-1) ?? 0,
    },
    byGroup: groups,
    byReasonCode: byReason,
    coverage: {
      reasonCodesInEngine: REASON_CODES.length,
      exercisedHere: byReason.length,
      outOfScope: UNCOVERED_REASON_CODES,
      untested,
    },
    failures: failures.map((f) => ({
      id: f.id,
      group: f.group,
      label: f.label,
      failure: f.failure,
    })),
    cases: results,
  };

  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n  Written to evals/results.json`);

  // Only a false negative fails the build. A false positive is printed loudly and
  // deliberately does not, because the honest response to over-blocking is to widen
  // a mandate, not to quietly loosen the engine.
  if (falseNegatives.length > 0) {
    console.log(
      `\nEVALUATION FAILED — ${falseNegatives.length} purchase(s) would have gone through unauthorised.\n`,
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.log(
      `\n${failures.length} case(s) failed without any unauthorised spend. Fix before demo.\n`,
    );
    process.exit(1);
  }

  console.log("\nEvery bound held.\n");
}

main();

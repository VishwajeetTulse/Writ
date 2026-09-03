import { prisma } from "./db";
import { verifyChain } from "./ledger";

/**
 * The numbers behind the pitch.
 *
 * Two halves, and they answer different questions.
 *
 * The merchant half asks what this is worth. The honest baseline is not "the merchant
 * was losing money to bad agent purchases" — it is that a merchant facing AI-buyer
 * traffic today has two options, refuse it or accept risk it cannot bound, and both of
 * those are zero rupees of agent revenue. So the number that matters is agent-originated
 * GMV: revenue from a channel that does not open at all without something like this.
 *
 * The safety half asks whether the bounds actually held. Refused value, refusals by
 * cause, decision latency, and whether the chain still verifies.
 *
 * Everything here is computed from the ledger and the purchase table. Nothing is
 * hardcoded and nothing is projected.
 */

export interface ImpactReport {
  merchant: {
    agentGmvPaise: bigint;
    settledGmvPaise: bigint;
    orderCount: number;
    settledCount: number;
    mandatesIssued: number;
    /** Purchases per human signature — the leverage one approval buys. */
    purchasesPerApproval: number;
    runCount: number;
  };
  safety: {
    decisionCount: number;
    allowedCount: number;
    refusedCount: number;
    /** What the refused attempts would have cost. Risk declined, not revenue lost. */
    refusedValuePaise: bigint;
    refusalsByReason: Array<{ reasonCode: string; count: number; valuePaise: bigint }>;
    latency: { p50Us: number; p95Us: number; maxUs: number; count: number };
    recoveredFailures: number;
  };
  chain: {
    valid: boolean;
    recordCount: number;
    brokenAtSeq?: number;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(index, 0)];
}

export async function buildImpactReport(): Promise<ImpactReport> {
  const [
    agentPurchases,
    settled,
    mandatesIssued,
    runCount,
    decisions,
    refusals,
    latencies,
    recoveries,
    chain,
  ] = await Promise.all([
    prisma.purchase.aggregate({
      where: { runId: { not: null }, status: { in: ["CREATED", "PAID"] } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.purchase.aggregate({
      where: { status: "PAID" },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.mandate.count({ where: { signature: { not: "" } } }),
    prisma.agentRun.count(),
    prisma.auditEvent.groupBy({
      by: ["verdict"],
      where: { type: "POLICY_DECISION" },
      _count: { _all: true },
    }),
    prisma.auditEvent.groupBy({
      by: ["reasonCode"],
      where: { verdict: "BLOCK", reasonCode: { not: null } },
      _count: { _all: true },
      _sum: { amountPaise: true },
    }),
    prisma.auditEvent.findMany({
      where: { latencyUs: { not: null }, type: "POLICY_DECISION" },
      select: { latencyUs: true },
    }),
    prisma.auditEvent.count({ where: { type: "RAZORPAY_RETRY" } }),
    verifyChain(),
  ]);

  const allowedCount =
    decisions.find((d) => d.verdict === "ALLOW")?._count._all ?? 0;
  const refusedCount = decisions
    .filter((d) => d.verdict !== "ALLOW")
    .reduce((sum, d) => sum + d._count._all, 0);

  const sortedLatencies = latencies
    .map((l) => l.latencyUs ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  const orderCount = agentPurchases._count._all;

  return {
    merchant: {
      agentGmvPaise: agentPurchases._sum.amountPaise ?? 0n,
      settledGmvPaise: settled._sum.amountPaise ?? 0n,
      orderCount,
      settledCount: settled._count._all,
      mandatesIssued,
      purchasesPerApproval: mandatesIssued === 0 ? 0 : orderCount / mandatesIssued,
      runCount,
    },
    safety: {
      decisionCount: allowedCount + refusedCount,
      allowedCount,
      refusedCount,
      refusedValuePaise: refusals.reduce(
        (sum, r) => sum + (r._sum.amountPaise ?? 0n),
        0n,
      ),
      refusalsByReason: refusals
        .map((r) => ({
          reasonCode: r.reasonCode as string,
          count: r._count._all,
          valuePaise: r._sum.amountPaise ?? 0n,
        }))
        .sort((a, b) => b.count - a.count),
      latency: {
        p50Us: percentile(sortedLatencies, 50),
        p95Us: percentile(sortedLatencies, 95),
        maxUs: sortedLatencies.at(-1) ?? 0,
        count: sortedLatencies.length,
      },
      recoveredFailures: recoveries,
    },
    chain: {
      valid: chain.valid,
      recordCount: chain.recordCount,
      brokenAtSeq: chain.brokenAtSeq,
    },
  };
}

import { prisma } from "./db";

/**
 * The spending summary.
 *
 * This started life as a scorecard — evaluation results, decision latency, chain
 * status, a paragraph arguing the product's value — and that was the wrong screen. Those
 * are facts about the project, aimed at someone deciding whether to believe it. They
 * belong in the README, and they are there.
 *
 * What belongs on a screen is what the person whose money this is actually wants to
 * know: where it went, what was stopped, and whether any of their limits are about to
 * get in the way. The last of those is the one that earns the page — a mandate that
 * keeps refusing legitimate purchases is a mandate to widen, and nothing else in the
 * console surfaces that.
 */

export interface SpendingSummary {
  spentPaise: bigint;
  purchaseCount: number;
  settledCount: number;
  stoppedCount: number;
  /** What the stopped attempts would have cost. Never authorised, so never at risk. */
  stoppedValuePaise: bigint;
  activeMandates: number;
  /** Why purchases were stopped, commonest first. */
  reasons: Array<{ reasonCode: string; count: number; valuePaise: bigint }>;
}

export async function buildSpendingSummary(): Promise<SpendingSummary> {
  const [agentSpend, settled, stopped, reasons, activeMandates] = await Promise.all([
    prisma.purchase.aggregate({
      where: { status: { in: ["CREATED", "PAID"] } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.purchase.count({ where: { status: "PAID" } }),
    prisma.auditEvent.aggregate({
      where: { verdict: "BLOCK" },
      _count: { _all: true },
      _sum: { amountPaise: true },
    }),
    prisma.auditEvent.groupBy({
      by: ["reasonCode"],
      where: { verdict: "BLOCK", reasonCode: { not: null } },
      _count: { _all: true },
      _sum: { amountPaise: true },
    }),
    prisma.mandate.count({ where: { status: "ACTIVE" } }),
  ]);

  return {
    spentPaise: agentSpend._sum.amountPaise ?? 0n,
    purchaseCount: agentSpend._count._all,
    settledCount: settled,
    stoppedCount: stopped._count._all,
    stoppedValuePaise: stopped._sum.amountPaise ?? 0n,
    activeMandates,
    reasons: reasons
      .map((r) => ({
        reasonCode: r.reasonCode as string,
        count: r._count._all,
        valuePaise: r._sum.amountPaise ?? 0n,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

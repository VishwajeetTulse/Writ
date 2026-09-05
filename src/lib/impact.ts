import { prisma } from "./db";
import { parsePayload } from "./format";

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
  /**
   * What the stopped attempts would have cost, counting each distinct item once.
   * The same television refused on five runs is one television of exposure, not five,
   * and summing every attempt turns one refusal into a five-figure headline.
   */
  stoppedValuePaise: bigint;
  activeMandates: number;
  /** Why purchases were stopped, commonest first. */
  reasons: Array<{ reasonCode: string; count: number; valuePaise: bigint }>;
}

export async function buildSpendingSummary(userId: string): Promise<SpendingSummary> {
  const [agentSpend, settled, stopped, activeMandates] = await Promise.all([
    prisma.purchase.aggregate({
      where: { status: { in: ["CREATED", "PAID"] }, mandate: { userId } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.purchase.count({ where: { status: "PAID", mandate: { userId } } }),
    // Read rather than aggregated, because the item is in the payload and the sums below
    // have to know which attempts were the same item twice.
    prisma.auditEvent.findMany({
      where: { verdict: "BLOCK", mandate: { userId } },
      select: { amountPaise: true, payload: true, reasonCode: true },
      orderBy: { seq: "asc" },
    }),
    // Expiry is derived here the same way `loadMandate` derives it, so this page and
    // the mandate list cannot disagree about how many mandates are live.
    prisma.mandate.count({
      where: { status: "ACTIVE", userId, expiresAt: { gt: new Date() } },
    }),
  ]);

  // Counts are per attempt; values are per distinct item. An item is charged to the
  // first reason that stopped it, so the reasons below always add up to the headline.
  const counted = new Set<string>();
  const byReason = new Map<string, { count: number; valuePaise: bigint }>();
  let stoppedValuePaise = 0n;

  for (const event of stopped) {
    const sku = parsePayload(event.payload).sku;
    const item = typeof sku === "string" ? sku : `amount:${event.amountPaise}`;
    const reasonCode = event.reasonCode;

    let bucket: { count: number; valuePaise: bigint } | undefined;
    if (reasonCode) {
      bucket = byReason.get(reasonCode) ?? { count: 0, valuePaise: 0n };
      bucket.count++;
      byReason.set(reasonCode, bucket);
    }

    if (counted.has(item)) continue;
    counted.add(item);

    const value = event.amountPaise ?? 0n;
    stoppedValuePaise += value;
    if (bucket) bucket.valuePaise += value;
  }

  return {
    spentPaise: agentSpend._sum.amountPaise ?? 0n,
    purchaseCount: agentSpend._count._all,
    settledCount: settled,
    stoppedCount: stopped.length,
    stoppedValuePaise,
    activeMandates,
    reasons: [...byReason.entries()]
      .map(([reasonCode, v]) => ({ reasonCode, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}

import { prisma } from "./db";
import {
  newMandateId,
  signMandate,
  verifySignature,
  type MandateDraft,
  type MandateMerchant,
  type MandateStatus,
  type MandateTerms,
} from "./mandate";
import { append } from "./ledger";
import type { SpendState } from "./policy";
import type { MandateModel } from "@/generated/prisma/models";

/**
 * Database access for mandates.
 *
 * `mandate.ts` is pure crypto with no I/O so it stays testable; this module is the
 * seam between it and Prisma. The important function here is `loadMandate`, which is
 * what the gateway calls on every single purchase attempt — never a cached copy, so a
 * revocation takes effect on the very next call rather than at the end of a run.
 */

/** Turn a database row into the exact shape that was signed. */
export function rowToTerms(row: MandateModel): MandateTerms {
  return {
    id: row.id,
    userId: row.userId,
    merchants: JSON.parse(row.merchants) as MandateMerchant[],
    categories: JSON.parse(row.categories) as string[],
    perTxnCapPaise: row.perTxnCapPaise,
    totalCapPaise: row.totalCapPaise,
    velocityMax: row.velocityMax,
    velocityWindowS: row.velocityWindowS,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export interface LoadedMandate {
  row: MandateModel;
  terms: MandateTerms;
  status: MandateStatus;
  signatureValid: boolean;
}

/**
 * Load a mandate and check its signature.
 *
 * Deliberately NOT scoped to a signed-in user. This is what the gateway calls, and the
 * gateway serves agents, not browsers — there is no session on that path. A mandate's
 * authority comes from its signature and its terms, not from who is looking at it.
 *
 * Every function below that serves the console does take a `userId` and does filter on
 * it. The difference is the point: two callers, two authentication mechanisms.
 *
 * Expiry is derived at read time rather than trusted from the stored status: a mandate
 * that lapsed while nobody was looking is expired, whether or not a background job ever
 * got round to updating the row.
 */
export async function loadMandate(id: string): Promise<LoadedMandate | null> {
  const row = await prisma.mandate.findUnique({ where: { id } });
  if (!row) return null;

  const terms = rowToTerms(row);
  let status = row.status as MandateStatus;

  if (status === "ACTIVE" && new Date() >= row.expiresAt) {
    status = "EXPIRED";
  }

  return {
    row,
    terms,
    status,
    signatureValid: verifySignature(terms, row.signature),
  };
}

/**
 * Spend recorded against a mandate.
 *
 * Only PAID and CREATED purchases count. A CREATED order is one Razorpay accepted but
 * that has not settled yet, and it must still consume authority — otherwise an agent
 * could outrun its own cap by firing purchases faster than webhooks arrive.
 */
export async function getSpendState(
  mandateId: string,
  idempotencyKey: string,
): Promise<SpendState> {
  const [purchases, duplicate] = await Promise.all([
    prisma.purchase.findMany({
      where: { mandateId, status: { in: ["CREATED", "PAID"] } },
      select: { amountPaise: true, createdAt: true },
    }),
    prisma.purchase.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    }),
  ]);

  return {
    spentPaise: purchases.reduce((sum, p) => sum + p.amountPaise, 0n),
    recentPurchaseTimes: purchases.map((p) => p.createdAt),
    idempotencyKeyUsed: duplicate !== null,
  };
}

/** Create and sign a mandate in one step, and write the genesis audit event. */
export async function issueMandate(params: {
  intentText: string;
  draft: MandateDraft;
  /** Required. A mandate with no owner is authority nobody is accountable for. */
  userId: string;
  /**
   * Fixed id, for seeded demo mandates only. Everything issued through the API gets a
   * random one — a predictable mandate id would be a guessable handle on someone's
   * spending authority.
   */
  id?: string;
}): Promise<{ id: string; terms: MandateTerms; signature: string }> {
  const id = params.id ?? newMandateId();
  const userId = params.userId;
  const d = params.draft;

  const terms: MandateTerms = {
    id,
    userId,
    merchants: d.merchants,
    categories: d.categories,
    perTxnCapPaise: d.perTxnCapPaise,
    totalCapPaise: d.totalCapPaise,
    velocityMax: d.velocityMax,
    velocityWindowS: d.velocityWindowS,
    expiresAt: d.expiresAt,
  };

  const signature = signMandate(terms);

  await prisma.mandate.create({
    data: {
      id,
      userId,
      intentText: params.intentText,
      merchants: JSON.stringify(d.merchants),
      categories: JSON.stringify(d.categories),
      perTxnCapPaise: d.perTxnCapPaise,
      totalCapPaise: d.totalCapPaise,
      velocityMax: d.velocityMax,
      velocityWindowS: d.velocityWindowS,
      expiresAt: new Date(d.expiresAt),
      status: "ACTIVE",
      signature,
      signedAt: new Date(),
    },
  });

  await append({
    actor: "human",
    type: "MANDATE_ISSUED",
    mandateId: id,
    amountPaise: d.totalCapPaise,
    payload: {
      intentText: params.intentText,
      merchants: d.merchants,
      categories: d.categories,
      perTxnCapPaise: d.perTxnCapPaise,
      totalCapPaise: d.totalCapPaise,
      velocityMax: d.velocityMax,
      velocityWindowS: d.velocityWindowS,
      expiresAt: d.expiresAt,
      signature,
    },
  });

  return { id, terms, signature };
}

/**
 * Revoke a mandate.
 *
 * There is no "pending revocation" state and nothing to propagate: the gateway reads
 * status fresh on every call, so flipping the row is the whole mechanism. An agent
 * mid-run loses its authority on its next tool call.
 */
export async function revokeMandate(id: string, userId: string): Promise<boolean> {
  const row = await prisma.mandate.findUnique({ where: { id } });
  if (!row || row.userId !== userId || row.status === "REVOKED") return false;

  await prisma.mandate.update({
    where: { id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  await append({
    actor: "human",
    type: "MANDATE_REVOKED",
    mandateId: id,
    payload: { revokedAt: new Date().toISOString(), previousStatus: row.status },
  });

  return true;
}

/** Aggregate spend for the dashboard and the mandate list. */
export async function getMandateSummary(mandateId: string, userId?: string) {
  const [row, purchases, blocks] = await Promise.all([
    prisma.mandate.findFirst({
      where: { id: mandateId, ...(userId ? { userId } : {}) },
    }),
    prisma.purchase.findMany({
      where: { mandateId, status: { in: ["CREATED", "PAID"] } },
      select: { amountPaise: true },
    }),
    prisma.auditEvent.count({ where: { mandateId, verdict: "BLOCK" } }),
  ]);

  if (!row) return null;

  const spentPaise = purchases.reduce((sum, p) => sum + p.amountPaise, 0n);

  return {
    spentPaise,
    remainingPaise: row.totalCapPaise - spentPaise,
    purchaseCount: purchases.length,
    blockCount: blocks,
  };
}

/** Status as it is *now*, not as the row last recorded it. */
export function effectiveStatus(row: {
  status: string;
  expiresAt: Date;
}): MandateStatus {
  const status = row.status as MandateStatus;
  if (status === "ACTIVE" && new Date() >= row.expiresAt) return "EXPIRED";
  return status;
}

export interface MandateListItem {
  id: string;
  intentText: string;
  status: MandateStatus;
  merchants: MandateMerchant[];
  categories: string[];
  perTxnCapPaise: bigint;
  totalCapPaise: bigint;
  spentPaise: bigint;
  remainingPaise: bigint;
  velocityMax: number | null;
  velocityWindowS: number | null;
  purchaseCount: number;
  blockCount: number;
  /** The largest single refused amount, for the runway's breach marker. */
  largestBlockedPaise: bigint;
  expiresAt: Date;
  createdAt: Date;
  signature: string;
}

/**
 * Every mandate with its spend rolled up.
 *
 * Three aggregate queries rather than one per mandate: the list screen is the first
 * thing a judge sees, and it should not get slower as the demo produces more data.
 */
export async function listMandates(userId: string): Promise<MandateListItem[]> {
  const [rows, spend, blocks] = await Promise.all([
    prisma.mandate.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.purchase.groupBy({
      by: ["mandateId"],
      where: { status: { in: ["CREATED", "PAID"] }, mandate: { userId } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    prisma.auditEvent.groupBy({
      by: ["mandateId"],
      where: { verdict: "BLOCK", mandate: { userId } },
      _count: { _all: true },
      _max: { amountPaise: true },
    }),
  ]);

  const spendBy = new Map(spend.map((s) => [s.mandateId, s]));
  const blockBy = new Map(blocks.map((b) => [b.mandateId, b]));

  return rows.map((row) => {
    const s = spendBy.get(row.id);
    const b = blockBy.get(row.id);
    const spentPaise = s?._sum.amountPaise ?? 0n;

    return {
      id: row.id,
      intentText: row.intentText,
      status: effectiveStatus(row),
      merchants: JSON.parse(row.merchants) as MandateMerchant[],
      categories: JSON.parse(row.categories) as string[],
      perTxnCapPaise: row.perTxnCapPaise,
      totalCapPaise: row.totalCapPaise,
      spentPaise,
      remainingPaise: row.totalCapPaise - spentPaise,
      velocityMax: row.velocityMax,
      velocityWindowS: row.velocityWindowS,
      purchaseCount: s?._count._all ?? 0,
      blockCount: b?._count._all ?? 0,
      largestBlockedPaise: b?._max.amountPaise ?? 0n,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      signature: row.signature,
    };
  });
}

/**
 * One mandate with everything the detail screen and the API both need.
 *
 * `signatureValid` is recomputed here rather than stored. A stored "yes, this was
 * valid once" is worth nothing — the check has to run against the row as it exists
 * right now, which is the only way editing a cap in the database shows up as tampering.
 */
export async function getMandateDetail(id: string, userId: string) {
  const loaded = await loadMandate(id);

  // Someone else's mandate reads as a mandate that does not exist. Returning a
  // "forbidden" here would confirm the id is real, which is a small leak but a free
  // one to avoid.
  if (!loaded || loaded.row.userId !== userId) return null;

  const [purchases, refusals, summary] = await Promise.all([
    prisma.purchase.findMany({
      where: { mandateId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.auditEvent.findMany({
      where: { mandateId: id, verdict: "BLOCK" },
      orderBy: { seq: "desc" },
      take: 20,
    }),
    getMandateSummary(id, userId),
  ]);

  return {
    row: loaded.row,
    terms: loaded.terms,
    status: loaded.status,
    signatureValid: loaded.signatureValid,
    purchases,
    refusals,
    spentPaise: summary?.spentPaise ?? 0n,
    remainingPaise: summary?.remainingPaise ?? loaded.row.totalCapPaise,
    purchaseCount: summary?.purchaseCount ?? 0,
    blockCount: summary?.blockCount ?? 0,
  };
}

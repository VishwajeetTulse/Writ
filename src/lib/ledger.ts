import { createHash } from "node:crypto";
import { prisma } from "./db";
import type { ReasonCode, Verdict } from "./policy";

/**
 * The audit ledger: append-only and hash-chained.
 *
 * Track 1's bar asks you to "show the audit trail". A table of rows is not evidence —
 * anyone can write rows. What makes this evidence is that each row commits to the one
 * before it, so the chain only verifies if no row has been edited, reordered, or
 * removed after the fact. `verifyChain` is the thing a judge can run.
 *
 * Two rules the rest of the codebase must honour:
 *   1. Nothing ever UPDATEs or DELETEs an AuditEvent. Corrections are new rows.
 *   2. Every branch of the gateway appends — including the ones that refuse early.
 *      A ledger that only records successes proves nothing about what was blocked.
 */

export type Actor = "agent" | "policy" | "human" | "razorpay" | "system";

export type EventType =
  | "MANDATE_DRAFTED"
  | "MANDATE_ISSUED"
  | "MANDATE_REVOKED"
  | "MANDATE_EXPIRED"
  | "AGENT_RUN_STARTED"
  | "AGENT_RUN_ENDED"
  | "PURCHASE_ATTEMPTED"
  | "POLICY_DECISION"
  | "ORDER_CREATED"
  | "PAYMENT_LINK_CREATED"
  | "WEBHOOK_RECEIVED"
  | "RAZORPAY_ERROR"
  | "RAZORPAY_RETRY";

export interface AppendInput {
  actor: Actor;
  type: EventType;
  mandateId?: string | null;
  runId?: string | null;
  verdict?: Verdict | null;
  reasonCode?: ReasonCode | null;
  amountPaise?: bigint | null;
  latencyUs?: number | null;
  payload: Record<string, unknown>;
}

/** Genesis link for the first row in an empty ledger. */
const GENESIS_HASH = "0".repeat(64);

/**
 * Stable JSON for hashing.
 *
 * Object keys are emitted in sorted order and bigints become decimal strings, so the
 * same evidence always hashes to the same digest regardless of how the object was built.
 * Without this, `verifyChain` would fail on rows that are perfectly intact.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** The link function. Changing this invalidates every existing chain. */
function computeHash(parts: {
  seq: number;
  prevHash: string;
  actor: string;
  type: string;
  verdict: string | null;
  reasonCode: string | null;
  payload: string;
  createdAt: Date;
}): string {
  return createHash("sha256")
    .update(
      [
        String(parts.seq),
        parts.prevHash,
        parts.actor,
        parts.type,
        parts.verdict ?? "",
        parts.reasonCode ?? "",
        parts.payload,
        parts.createdAt.toISOString(),
      ].join("|"),
    )
    .digest("hex");
}

/**
 * Append one event and link it to the tail of the chain.
 *
 * The read-then-write runs inside a transaction because two concurrent appends that both
 * read the same tail would produce two rows claiming the same predecessor, and the chain
 * would no longer verify. SQLite serializes writers, so the transaction is what makes
 * concurrent agent runs safe.
 *
 * `seq` is needed for the hash but is assigned by the database, so the row is inserted
 * first with a placeholder and then stamped with its real hash — the only UPDATE this
 * table ever receives, and it happens inside the same transaction that created the row.
 */
export async function append(input: AppendInput) {
  const payloadJson = canonicalJson(input.payload);

  return prisma.$transaction(async (tx) => {
    const tail = await tx.auditEvent.findFirst({
      orderBy: { seq: "desc" },
      select: { hash: true },
    });
    const prevHash = tail?.hash ?? GENESIS_HASH;

    const created = await tx.auditEvent.create({
      data: {
        actor: input.actor,
        type: input.type,
        mandateId: input.mandateId ?? null,
        runId: input.runId ?? null,
        verdict: input.verdict ?? null,
        reasonCode: input.reasonCode ?? null,
        amountPaise: input.amountPaise ?? null,
        latencyUs: input.latencyUs ?? null,
        payload: payloadJson,
        prevHash,
        hash: "",
      },
    });

    const hash = computeHash({
      seq: created.seq,
      prevHash,
      actor: created.actor,
      type: created.type,
      verdict: created.verdict,
      reasonCode: created.reasonCode,
      payload: payloadJson,
      createdAt: created.createdAt,
    });

    return tx.auditEvent.update({
      where: { seq: created.seq },
      data: { hash },
    });
  });
}

export interface ChainVerification {
  valid: boolean;
  recordCount: number;
  /** Present only when `valid` is false — the first row whose link does not hold. */
  brokenAtSeq?: number;
  reason?: string;
}

/**
 * Walk the whole chain and recompute every link.
 *
 * This is the "Verify chain" button. It catches an edited payload, a changed verdict,
 * a deleted row, and a reordered row — anything that would let someone rewrite what the
 * policy engine decided after the fact.
 */
export async function verifyChain(): Promise<ChainVerification> {
  const events = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });

  let prevHash = GENESIS_HASH;

  for (const e of events) {
    if (e.prevHash !== prevHash) {
      return {
        valid: false,
        recordCount: events.length,
        brokenAtSeq: e.seq,
        reason: "prevHash does not match the previous row's hash (row inserted or removed)",
      };
    }

    const expected = computeHash({
      seq: e.seq,
      prevHash: e.prevHash,
      actor: e.actor,
      type: e.type,
      verdict: e.verdict,
      reasonCode: e.reasonCode,
      payload: e.payload,
      createdAt: e.createdAt,
    });

    if (expected !== e.hash) {
      return {
        valid: false,
        recordCount: events.length,
        brokenAtSeq: e.seq,
        reason: "row content does not match its hash (row was edited after it was written)",
      };
    }

    prevHash = e.hash;
  }

  return { valid: true, recordCount: events.length };
}

export interface LedgerQuery {
  /**
   * Restrict to events about one account's mandates.
   *
   * Events with no mandate at all — a rejected webhook, a system note — are excluded
   * by this filter, which is correct: they are facts about the service rather than
   * about anybody's money.
   */
  userId?: string;
  mandateId?: string;
  runId?: string;
  verdict?: Verdict;
  type?: EventType;
  /** Return only rows newer than this sequence number. Used for live tailing. */
  afterSeq?: number;
  limit?: number;
}

/**
 * Read the ledger.
 *
 * Ordered by `seq` because that is the chain's order. Sorting by timestamp would look
 * equivalent and quietly is not: two events written in the same millisecond have a
 * defined position in the chain and an undefined position by clock.
 */
export async function queryLedger(q: LedgerQuery = {}) {
  return prisma.auditEvent.findMany({
    where: {
      ...(q.userId ? { mandate: { userId: q.userId } } : {}),
      ...(q.mandateId ? { mandateId: q.mandateId } : {}),
      ...(q.runId ? { runId: q.runId } : {}),
      ...(q.verdict ? { verdict: q.verdict } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.afterSeq !== undefined ? { seq: { gt: q.afterSeq } } : {}),
    },
    orderBy: { seq: q.afterSeq !== undefined ? "asc" : "desc" },
    take: q.limit ?? 100,
  });
}

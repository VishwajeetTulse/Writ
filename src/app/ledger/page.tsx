import Link from "next/link";
import { queryLedger, type EventType } from "@/lib/ledger";
import { prisma } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { parsePayload, timestamp, violationsFrom } from "@/lib/format";
import { LedgerRow, type LedgerRowData } from "@/components/ledger-row";
import { VerifyChain } from "@/components/verify-chain";
import { Card, Empty, Page } from "@/components/ui";
import { requireUser } from "@/lib/session";
import type { Verdict } from "@/lib/policy";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ label: string; params: Record<string, string> }> = [
  { label: "Everything", params: {} },
  { label: "Decisions", params: { type: "POLICY_DECISION" } },
  { label: "Refusals", params: { verdict: "BLOCK" } },
  { label: "Money moved", params: { type: "ORDER_CREATED" } },
];

/**
 * The audit trail.
 *
 * Track 1 asks you to show one. The distinction this screen has to carry is that a
 * table of rows is not evidence, because anyone can write rows. What makes it evidence
 * is the chain: every row commits to the hash of the row before it, so the trail only
 * verifies if nothing has been edited, reordered or removed since it was written.
 *
 * Hence the hash column, which is otherwise the least interesting thing on the page,
 * and the Verify button, which recomputes all of it live rather than showing a number
 * that was true once.
 */
export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const user = await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const mandateId = one(sp.mandate);
  const verdict = one(sp.verdict) as Verdict | undefined;
  const type = one(sp.type) as EventType | undefined;

  const [events, total] = await Promise.all([
    queryLedger({ userId: user.id, mandateId, verdict, type, limit: 200 }),
    prisma.auditEvent.count({ where: { mandate: { userId: user.id } } }),
  ]);

  const activeKey = `${verdict ?? ""}|${type ?? ""}`;

  // Shaped on the server so the client component receives plain data and no bigints.
  const rows: LedgerRowData[] = events.map((e) => {
    const payload = parsePayload(e.payload);
    const violations = violationsFrom(payload);
    const productName =
      typeof payload.productName === "string" ? payload.productName : null;
    const note = typeof payload.note === "string" ? payload.note : null;

    return {
      seq: e.seq,
      time: timestamp(e.createdAt),
      actor: e.actor,
      type: e.type,
      verdict: e.verdict,
      reasonCode: e.reasonCode,
      amount: e.amountPaise !== null ? formatPaise(e.amountPaise) : null,
      latency: e.latencyUs !== null ? `${(e.latencyUs / 1000).toFixed(2)}ms` : null,
      prevHash: e.prevHash,
      hash: e.hash,
      detail: productName ?? note,
      extraViolations: Math.max(violations.length - 1, 0),
    };
  });

  return (
    <Page
      wide
      title="Audit ledger"
      lede="Every decision made about your money, allowed and stopped alike. Nothing here can be edited after the fact."
      actions={<VerifyChain recordCount={total} />}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const params = new URLSearchParams(f.params);
          if (mandateId) params.set("mandate", mandateId);
          const key = `${f.params.verdict ?? ""}|${f.params.type ?? ""}`;
          const active = key === activeKey;

          return (
            <Link
              key={f.label}
              href={`/ledger${params.toString() ? `?${params}` : ""}`}
              className={`rounded-md border px-3 py-1.5 text-[13px] transition-colors ${
                active
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-ink-mute hover:border-line-strong"
              }`}
            >
              {f.label}
            </Link>
          );
        })}

        {mandateId && (
          <Link
            href="/ledger"
            className="ml-1 rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-[12px] text-ink-mute hover:border-line-strong"
          >
            mandate: {mandateId} ×
          </Link>
        )}

        <span className="ml-auto font-mono text-[11px] tnum text-ink-mute">
          {events.length} of {total} records
        </span>
      </div>

      {events.length === 0 ? (
        <Empty>Nothing recorded yet under this filter.</Empty>
      ) : (
        <Card pad={false} className="overflow-hidden">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                {[
                  "Seq",
                  "Time",
                  "Actor",
                  "Event",
                  "Verdict",
                  "Detail",
                  "Amount",
                  "Latency",
                  "",
                  "Hash",
                ].map(
                  (h) => (
                    <th
                      key={h}
                      className="eyebrow whitespace-nowrap px-3 py-2.5 font-normal first:pl-5 last:pr-5"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <LedgerRow key={row.seq} row={row} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

    </Page>
  );
}

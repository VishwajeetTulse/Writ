import Link from "next/link";
import { queryLedger, type EventType } from "@/lib/ledger";
import { prisma } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { parsePayload, timestamp, truncateHash, violationsFrom } from "@/lib/format";
import { VerdictPill } from "@/components/verdict";
import { VerifyChain } from "@/components/verify-chain";
import { Card, Empty, Page } from "@/components/ui";
import type { Verdict } from "@/lib/policy";

export const dynamic = "force-dynamic";

const ACTOR_TONE: Record<string, string> = {
  agent: "text-ink",
  policy: "text-ink",
  human: "text-ink",
  razorpay: "text-ink-mute",
  system: "text-ink-mute",
};

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
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const mandateId = one(sp.mandate);
  const verdict = one(sp.verdict) as Verdict | undefined;
  const type = one(sp.type) as EventType | undefined;

  const [events, total] = await Promise.all([
    queryLedger({ mandateId, verdict, type, limit: 200 }),
    prisma.auditEvent.count(),
  ]);

  const activeKey = `${verdict ?? ""}|${type ?? ""}`;

  return (
    <Page
      wide
      title="Audit ledger"
      lede="Append-only and hash-chained. Every row commits to the hash of the row before it, so the trail verifies only if nothing has been edited, reordered or deleted since it was written. Refusals are recorded exactly like purchases — a trail that only records successes proves nothing about what was stopped."
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
                {["Seq", "Time", "Actor", "Event", "Verdict", "Detail", "Amount", "Latency", "Hash"].map(
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
              {events.map((e) => {
                const payload = parsePayload(e.payload);
                const violations = violationsFrom(payload);
                const productName =
                  typeof payload.productName === "string" ? payload.productName : null;
                const note = typeof payload.note === "string" ? payload.note : null;

                return (
                  <tr
                    key={e.seq}
                    className="border-b border-line/70 align-top last:border-0 hover:bg-ground/60"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 pl-5 font-mono text-[11px] tnum text-ink-mute">
                      {e.seq}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tnum text-ink-mute">
                      {timestamp(e.createdAt)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2.5 font-mono text-[11px] ${
                        ACTOR_TONE[e.actor] ?? "text-ink-mute"
                      }`}
                    >
                      {e.actor}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">
                      {e.type}
                    </td>
                    <td className="px-3 py-2.5">
                      {e.verdict ? <VerdictPill verdict={e.verdict as Verdict} /> : null}
                    </td>
                    <td className="max-w-[300px] px-3 py-2.5">
                      {e.reasonCode && (
                        <div className="font-mono text-[11px] font-medium">
                          {e.reasonCode}
                        </div>
                      )}
                      {violations.length > 1 && (
                        <div className="font-mono text-[10px] text-deny">
                          + {violations.length - 1} more bound
                          {violations.length - 1 === 1 ? "" : "s"} broken
                        </div>
                      )}
                      {productName && (
                        <div className="truncate text-[12px] text-ink-mute">
                          {productName}
                        </div>
                      )}
                      {!productName && note && (
                        <div className="truncate text-[12px] text-ink-mute">{note}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] tnum">
                      {e.amountPaise !== null ? formatPaise(e.amountPaise) : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] tnum text-ink-mute">
                      {e.latencyUs !== null ? `${(e.latencyUs / 1000).toFixed(2)}ms` : ""}
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2.5 pr-5 font-mono text-[10px] text-ink-mute"
                      title={`prev ${e.prevHash}\nthis ${e.hash}`}
                    >
                      {truncateHash(e.prevHash, 4, 3)}
                      <span className="mx-1 text-line-strong">→</span>
                      <span className="text-ink">{truncateHash(e.hash, 4, 3)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-4 text-[13px] text-ink-mute">
        Latency is the policy engine&rsquo;s own decision time, measured around a pure
        function with no database and no model call in it.
      </p>
    </Page>
  );
}

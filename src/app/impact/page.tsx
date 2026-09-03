import Link from "next/link";
import { buildSpendingSummary } from "@/lib/impact";
import { listMandates } from "@/lib/mandate-service";
import { formatPaise, formatPaiseCompact } from "@/lib/money";
import { plainReason } from "@/lib/explain";
import { relativeTime } from "@/lib/format";
import { Runway } from "@/components/runway";
import { StatusPill } from "@/components/verdict";
import { Card, Empty, Page, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Where the money went.
 *
 * Three questions, in the order someone actually asks them: what have my agents spent,
 * what got stopped, and is one of my limits getting in the way. The last section is the
 * only one that asks anything of the reader, and it is the reason the page exists — a
 * mandate that keeps refusing things you wanted is a mandate to widen.
 */
export default async function SpendingPage() {
  const [summary, mandates] = await Promise.all([
    buildSpendingSummary(),
    listMandates(),
  ]);

  const active = mandates.filter((m) => m.status === "ACTIVE");
  const maxReason = Math.max(...summary.reasons.map((r) => r.count), 1);

  return (
    <Page
      wide
      title="Spending"
      lede="What your agents have spent, and what was stopped before it could be."
    >
      <div className="space-y-4">
        <Card>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Spent by agents"
              value={formatPaiseCompact(summary.spentPaise)}
              sub={`Across ${summary.purchaseCount} purchase${summary.purchaseCount === 1 ? "" : "s"}, none of which needed your approval.`}
            />
            <Stat
              label="Stopped"
              value={summary.stoppedCount}
              tone={summary.stoppedCount > 0 ? "deny" : "mute"}
              sub="Attempts that fell outside a mandate and never reached a payment."
            />
            <Stat
              label="Value stopped"
              value={formatPaiseCompact(summary.stoppedValuePaise)}
              tone={summary.stoppedValuePaise > 0n ? "deny" : "mute"}
              sub="What those attempts would have cost. None of it was ever authorised."
            />
            <Stat
              label="Active mandates"
              value={summary.activeMandates}
              tone="mute"
              sub={`${mandates.length} in total, including expired and withdrawn.`}
            />
          </div>
        </Card>

        <Card pad={false}>
          <h2 className="border-b border-line px-5 py-3.5 text-[13px] font-semibold">
            Budget left
          </h2>

          {active.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-mute">
              No active mandates.{" "}
              <Link
                href="/mandates/new"
                className="text-ink underline underline-offset-2"
              >
                Create one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {active.map((m) => (
                <li key={m.id} className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <Link
                      href={`/mandates/${m.id}`}
                      className="min-w-0 flex-1 truncate text-[14px] hover:underline"
                    >
                      {m.intentText}
                    </Link>
                    <span className="shrink-0 font-mono text-[13px] tnum">
                      {formatPaise(m.remainingPaise > 0n ? m.remainingPaise : 0n)} left
                    </span>
                  </div>

                  <div className="mt-2.5">
                    <Runway
                      compact
                      capPaise={Number(m.totalCapPaise)}
                      spentPaise={Number(m.spentPaise)}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-mute">
                    <span>
                      {m.purchaseCount} purchase{m.purchaseCount === 1 ? "" : "s"}
                    </span>
                    {m.blockCount > 0 && (
                      <span className="text-deny">
                        {m.blockCount} stopped
                      </span>
                    )}
                    <span>Expires {relativeTime(m.expiresAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-[13px] font-semibold">Why purchases were stopped</h2>
          <p className="mb-5 max-w-[70ch] text-[13px] text-ink-mute">
            If something here keeps stopping purchases you actually wanted, the limit is
            too tight rather than the agent being wrong. Widen the mandate.
          </p>

          {summary.reasons.length === 0 ? (
            <Empty>Nothing has been stopped yet.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {summary.reasons.map((r) => (
                <li key={r.reasonCode} className="flex items-center gap-4">
                  <span className="w-64 shrink-0 text-[13px]">
                    {plainReason(r.reasonCode)}
                  </span>
                  <span className="h-3 flex-1 overflow-hidden rounded-[2px] bg-line/60">
                    <span
                      className="block h-full bg-deny/70"
                      style={{ width: `${(r.count / maxReason) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[12px] tnum">
                    {r.count}
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-[12px] tnum text-ink-mute">
                    {formatPaiseCompact(r.valuePaise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {mandates.length > active.length && (
          <Card pad={false}>
            <h2 className="border-b border-line px-5 py-3.5 text-[13px] font-semibold">
              No longer active
            </h2>
            <ul className="divide-y divide-line">
              {mandates
                .filter((m) => m.status !== "ACTIVE")
                .map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <Link
                      href={`/mandates/${m.id}`}
                      className="min-w-0 flex-1 truncate text-[13px] hover:underline"
                    >
                      {m.intentText}
                    </Link>
                    <span className="shrink-0 font-mono text-[12px] tnum text-ink-mute">
                      {formatPaiseCompact(m.spentPaise)} spent
                    </span>
                    <StatusPill status={m.status} />
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}

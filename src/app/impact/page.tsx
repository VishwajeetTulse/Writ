import Link from "next/link";
import { buildSpendingSummary } from "@/lib/impact";
import { listMandates } from "@/lib/mandate-service";
import { formatPaise, formatPaiseCompact } from "@/lib/money";
import { plainReason } from "@/lib/explain";
import { relativeTime } from "@/lib/format";
import { Runway } from "@/components/runway";
import { StatusPill } from "@/components/verdict";
import { buttonClass, Empty, Page, Section, Stack, Stat } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Where the money went.
 *
 * One number leads: what the agents spent. Everything else on the screen is support for
 * it. A page that opens with four equally-sized figures makes the reader do the ranking;
 * a page that opens with one makes the claim itself.
 *
 * The last section is the only one that asks anything of the reader, and it is the
 * reason the page exists — a mandate that keeps refusing things you wanted is a mandate
 * to widen.
 */
export default async function SpendingPage() {
  const user = await requireUser();

  const [summary, mandates] = await Promise.all([
    buildSpendingSummary(user.id),
    listMandates(user.id),
  ]);

  const active = mandates.filter((m) => m.status === "ACTIVE");
  const closed = mandates.filter((m) => m.status !== "ACTIVE");
  const maxReason = Math.max(...summary.reasons.map((r) => r.count), 1);

  return (
    <Page
      wide
      kicker="Across every mandate"
      title="Spending"
      lede="What your agents have committed, and what was stopped before it could be."
    >
      <Stack>
        <section className="grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            lead
            label="Committed by agents"
            value={formatPaiseCompact(summary.spentPaise)}
            sub={`${summary.purchaseCount} purchase${
              summary.purchaseCount === 1 ? "" : "s"
            }`}
          />
          <Stat
            label="Stopped"
            value={summary.stoppedCount}
            tone={summary.stoppedCount > 0 ? "deny" : "mute"}
          />
          <Stat
            label="Value stopped"
            value={formatPaiseCompact(summary.stoppedValuePaise)}
            tone={summary.stoppedValuePaise > 0n ? "deny" : "mute"}
          />
          <Stat
            label="Live mandates"
            value={summary.activeMandates}
            tone="mute"
            sub={`${mandates.length} in total`}
          />
        </section>

        <Section title={`Budget left · ${active.length}`}>
          {active.length === 0 ? (
            <Empty
              title="No mandate can spend anything today."
              action={
                <Link href="/mandates/new" className={buttonClass("primary", "md")}>
                  Write a mandate
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-hairline border-b border-hairline">
              {active.map((m) => (
                <li key={m.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <Link
                      href={`/mandates/${m.id}`}
                      className="human min-w-0 flex-1 truncate text-lede hover:underline"
                    >
                      {m.intentText}
                    </Link>
                    <span className="shrink-0 font-mono text-ui tnum">
                      {formatPaise(m.remainingPaise > 0n ? m.remainingPaise : 0n)} left
                    </span>
                  </div>

                  <div className="mt-3">
                    <Runway
                      compact
                      capPaise={Number(m.totalCapPaise)}
                      spentPaise={Number(m.spentPaise)}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-nano tnum text-ink-soft">
                    <span>
                      {m.purchaseCount} bought
                    </span>
                    {m.blockCount > 0 && (
                      <>
                        <span aria-hidden className="text-line-strong">·</span>
                        <span className="text-deny">{m.blockCount} stopped</span>
                      </>
                    )}
                    <span aria-hidden className="text-line-strong">·</span>
                    <span>expires {relativeTime(m.expiresAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Why purchases were stopped">
          {summary.reasons.length === 0 ? (
            <p className="py-6 text-ui text-ink-soft">Nothing stopped yet.</p>
          ) : (
            <ul className="divide-y divide-hairline border-b border-hairline">
                {summary.reasons.map((r) => (
                  <li key={r.reasonCode} className="flex items-center gap-4 py-2.5">
                    <span className="w-52 shrink-0 truncate text-ui sm:w-64">
                      {plainReason(r.reasonCode)}
                    </span>
                    <span
                      aria-hidden
                      className="hidden h-1.5 flex-1 overflow-hidden rounded-xs bg-sunk sm:block"
                    >
                      <span
                        className="block h-full bg-deny/60"
                        style={{ width: `${(r.count / maxReason) * 100}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-small tnum">
                      {r.count}
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-small tnum text-ink-soft">
                      {formatPaiseCompact(r.valuePaise)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Section>

        {closed.length > 0 && (
          <Section title={`No longer active · ${closed.length}`}>
            <ul className="divide-y divide-hairline border-b border-hairline">
              {closed.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <Link
                    href={`/mandates/${m.id}`}
                    className="min-w-0 flex-1 truncate text-ui text-ink-mute hover:text-ink hover:underline"
                  >
                    {m.intentText}
                  </Link>
                  <span className="shrink-0 font-mono text-small tnum text-ink-soft">
                    {formatPaiseCompact(m.spentPaise)} spent
                  </span>
                  <StatusPill status={m.status} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Stack>
    </Page>
  );
}

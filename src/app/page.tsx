import Link from "next/link";
import { listMandates } from "@/lib/mandate-service";
import { requireUser } from "@/lib/session";
import { formatPaise, formatPaiseCompact } from "@/lib/money";
import { relativeTime, velocityLabel } from "@/lib/format";
import { Runway } from "@/components/runway";
import { StatusPill } from "@/components/verdict";
import { Card, Empty, Page } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The mandate list.
 *
 * This is the first screen anyone sees, so it has one job: make it obvious that
 * spending authority here is a bounded object with terms, not a switch that is on or
 * off. Each row shows what was granted, what has been spent against it, and what was
 * refused — the refusal count sitting next to the purchase count, because a mandate
 * that has blocked things is a mandate that is working.
 */
export default async function MandatesPage() {
  const user = await requireUser();
  const mandates = await listMandates(user.id);

  return (
    <Page
      title="Mandates"
      lede="What each of your agents is allowed to spend, where, and until when."
      actions={
        <Link
          href="/mandates/new"
          className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-medium text-surface transition-opacity hover:opacity-88"
        >
          New mandate
        </Link>
      }
    >
      {mandates.length === 0 ? (
        <Empty>
          No mandates yet. Run <span className="font-mono">npm run db:seed</span>, or
          issue one from the New mandate screen.
        </Empty>
      ) : (
        <div className="space-y-3">
          {mandates.map((m) => {
            const velocity = velocityLabel(m.velocityMax, m.velocityWindowS);

            return (
              <Link key={m.id} href={`/mandates/${m.id}`} className="block">
                <Card className="transition-colors hover:border-line-strong">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-medium">{m.id}</span>
                        <StatusPill status={m.status} />
                      </div>
                      <p className="mt-1.5 max-w-[64ch] truncate text-[14px] text-ink">
                        {m.intentText}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-6 text-right">
                      <div>
                        <div className="eyebrow mb-1">Purchases</div>
                        <div className="font-mono text-[15px] tnum">{m.purchaseCount}</div>
                      </div>
                      <div>
                        <div className="eyebrow mb-1">Blocked</div>
                        <div
                          className={`font-mono text-[15px] tnum ${
                            m.blockCount > 0 ? "text-deny" : "text-ink-mute"
                          }`}
                        >
                          {m.blockCount}
                        </div>
                      </div>
                      <div className="w-24">
                        <div className="eyebrow mb-1">Remaining</div>
                        <div className="font-mono text-[15px] tnum">
                          {formatPaiseCompact(
                            m.remainingPaise > 0n ? m.remainingPaise : 0n,
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Runway
                      compact
                      capPaise={Number(m.totalCapPaise)}
                      spentPaise={Number(m.spentPaise)}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tnum text-ink-mute">
                    <span>{formatPaise(m.perTxnCapPaise)} per txn</span>
                    <span>·</span>
                    <span>
                      {m.merchants.length} merchant{m.merchants.length === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span>{m.categories.join(", ")}</span>
                    {velocity && (
                      <>
                        <span>·</span>
                        <span>{velocity}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>
                      {m.status === "EXPIRED" ? "expired " : "expires "}
                      {relativeTime(m.expiresAt)}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}

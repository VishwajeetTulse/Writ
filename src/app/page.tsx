import Link from "next/link";
import { listMandates, type MandateListItem } from "@/lib/mandate-service";
import { requireUser } from "@/lib/session";
import { formatPaise, formatPaiseCompact } from "@/lib/money";
import { relativeTime, velocityLabel } from "@/lib/format";
import { Runway } from "@/components/runway";
import { StatusPill } from "@/components/verdict";
import { buttonClass, Empty, Page, Section, Stack } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The mandate list.
 *
 * This is the first screen anyone sees, so it has one job: make it obvious that
 * spending authority here is a bounded object with terms, not a switch that is on or
 * off.
 *
 * Each mandate is a row on the page rather than a card, and the rows are split into
 * what is live and what is finished. A stack of identical boxes says every item is
 * equally important; a ledger split under two rubrics says which ones can still spend
 * your money.
 */
export default async function MandatesPage() {
  const user = await requireUser();
  const mandates = await listMandates(user.id);

  const active = mandates.filter((m) => m.status === "ACTIVE");
  const closed = mandates.filter((m) => m.status !== "ACTIVE");

  const outstanding = active.reduce(
    (sum, m) => sum + (m.remainingPaise > 0n ? m.remainingPaise : 0n),
    0n,
  );

  return (
    <Page
      kicker="Your agents"
      title="Mandates"
      lede="What each agent may spend, where, and until when."
      actions={
        <Link href="/mandates/new" className={buttonClass("primary", "md")}>
          New mandate
        </Link>
      }
    >
      {mandates.length === 0 ? (
        <Empty
          title="No spending authority has been granted yet."
          action={
            <Link href="/mandates/new" className={buttonClass("primary", "md")}>
              Write the first mandate
            </Link>
          }
        />
      ) : (
        <Stack>
          <Section
            title={`Live · ${active.length}`}
            aside={
              <span className="font-mono text-micro tnum text-ink-mute">
                {formatPaise(outstanding)} of authority outstanding
              </span>
            }
          >
            {active.length === 0 ? (
              <Empty
                title="Nothing can be spent right now."
                action={
                  <Link href="/mandates/new" className={buttonClass("secondary", "md")}>
                    Write a mandate
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-hairline border-b border-hairline">
                {active.map((m) => (
                  <MandateRow key={m.id} mandate={m} />
                ))}
              </ul>
            )}
          </Section>

          {closed.length > 0 && (
            <Section title={`Closed · ${closed.length}`}>
              <ul className="divide-y divide-hairline border-b border-hairline">
                {closed.map((m) => (
                  <MandateRow key={m.id} mandate={m} muted />
                ))}
              </ul>
            </Section>
          )}
        </Stack>
      )}
    </Page>
  );
}

/**
 * One mandate.
 *
 * The intent text leads, in the serif, because it is the sentence a person wrote and it
 * is the only part of a mandate that says what it is *for*. The caps and the allowlist
 * are set in mono underneath, as the machine-readable consequence of that sentence.
 */
function MandateRow({
  mandate: m,
  muted = false,
}: {
  mandate: MandateListItem;
  muted?: boolean;
}) {
  const velocity = velocityLabel(m.velocityMax, m.velocityWindowS);

  return (
    <li>
      <Link
        href={`/mandates/${m.id}`}
        className="group -mx-3 block rounded-sm px-3 py-4 transition-colors hover:bg-surface"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p
              className={`human truncate text-lede leading-snug ${
                muted ? "text-ink-mute" : "text-ink"
              }`}
            >
              {m.intentText}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusPill status={m.status} />
              <span className="font-mono text-micro text-ink-soft">{m.id}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-start gap-6 text-right sm:gap-8">
            <div className="hidden sm:block">
              <div className="eyebrow mb-1.5">Bought</div>
              <div className="font-mono text-body tnum">{m.purchaseCount}</div>
            </div>
            <div className="hidden sm:block">
              <div className="eyebrow mb-1.5">Stopped</div>
              <div
                className={`font-mono text-body tnum ${
                  m.blockCount > 0 ? "text-deny" : "text-ink-soft"
                }`}
              >
                {m.blockCount}
              </div>
            </div>
            <div className="w-[92px]">
              <div className="eyebrow mb-1.5">Left</div>
              <div className="font-mono text-body tnum">
                {formatPaiseCompact(m.remainingPaise > 0n ? m.remainingPaise : 0n)}
              </div>
            </div>
          </div>
        </div>

        <div className={`mt-3.5 ${muted ? "opacity-55" : ""}`}>
          <Runway
            compact
            capPaise={Number(m.totalCapPaise)}
            spentPaise={Number(m.spentPaise)}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-nano tnum text-ink-soft">
          <span>{formatPaise(m.perTxnCapPaise)} a time</span>
          <Dot />
          <span>{m.merchants.map((x) => x.name).join(", ")}</span>
          <Dot />
          <span>{m.categories.join(", ")}</span>
          {velocity && (
            <>
              <Dot />
              <span>{velocity}</span>
            </>
          )}
          <Dot />
          <span>
            {m.status === "EXPIRED" ? "expired " : "expires "}
            {relativeTime(m.expiresAt)}
          </span>
        </div>
      </Link>
    </li>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-line-strong">
      ·
    </span>
  );
}

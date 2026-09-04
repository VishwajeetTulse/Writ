import Link from "next/link";
import { notFound } from "next/navigation";
import { getMandateDetail } from "@/lib/mandate-service";
import { formatPaise } from "@/lib/money";
import {
  parsePayload,
  relativeTime,
  timestamp,
  truncateHash,
  velocityLabel,
  violationsFrom,
} from "@/lib/format";
import { Runway } from "@/components/runway";
import { SignatureSeal, StatusPill } from "@/components/verdict";
import { plainReason } from "@/lib/explain";
import { toAutopayToken, unmappedBounds } from "@/lib/razorpay/autopay";
import { RevokeButton } from "@/components/revoke-button";
import { Field, linkClass, Page, Section, Stack, Stat } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One mandate, in full.
 *
 * The page is arranged around a claim and its evidence. The intent sentence is the
 * title, because it is what a person actually granted; the runway is what has been used
 * and what was stopped; the tables below are what happened, read from the ledger rather
 * than recomputed. The signature line is the load-bearing one: it says whether the
 * terms on this screen are the terms a human signed.
 */
export default async function MandateDetailPage({ params }: PageProps<"/mandates/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getMandateDetail(id, user.id);
  if (!detail) notFound();

  const { row, terms, status, signatureValid, purchases, refusals } = detail;
  const velocity = velocityLabel(terms.velocityMax, terms.velocityWindowS);

  // What this mandate looks like to the payment rail, and what the rail cannot hold.
  const token = toAutopayToken(terms);
  const unmapped = unmappedBounds(terms);

  // The most recent refusal drives the runway's breach marker: the bar then shows both
  // the spending that was permitted and the specific attempt that was not.
  const lastRefusal = refusals[0];
  const lastRefusalPayload = lastRefusal ? parsePayload(lastRefusal.payload) : null;
  const breachPaise = lastRefusal?.amountPaise ? Number(lastRefusal.amountPaise) : null;
  const breachLabel =
    lastRefusalPayload && typeof lastRefusalPayload.productName === "string"
      ? `${lastRefusalPayload.productName} refused`
      : "refused";

  return (
    <Page
      kicker={
        <span className="flex items-center gap-2">
          <span>Mandate</span>
          <span className="text-line-strong">·</span>
          <span className="normal-case tracking-normal">{row.id}</span>
        </span>
      }
      title={row.intentText}
      actions={
        <>
          <StatusPill status={status} />
          {status === "ACTIVE" && <RevokeButton mandateId={row.id} />}
        </>
      }
    >
      <Stack>
        {!signatureValid && (
          <div className="rounded-md border border-deny/30 bg-deny-wash px-4 py-3">
            <p className="human text-lede text-deny">
              These terms have been changed since they were signed. Nothing can be spent
              against this mandate.
            </p>
          </div>
        )}

        <Section title="Standing">
          <Runway
            capPaise={Number(row.totalCapPaise)}
            spentPaise={Number(detail.spentPaise)}
            blockedPaise={breachPaise}
            blockedLabel={breachLabel}
          />

          <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
            <Stat
              lead
              label="Left to spend"
              value={formatPaise(detail.remainingPaise > 0n ? detail.remainingPaise : 0n, {
                showPaise: false,
              })}
            />
            <Stat label="Spent" value={formatPaise(detail.spentPaise, { showPaise: false })} />
            <Stat label="Bought" value={detail.purchaseCount} />
            <Stat
              label="Stopped"
              value={detail.blockCount}
              tone={detail.blockCount > 0 ? "deny" : "mute"}
            />
          </div>
        </Section>

        <Section
          title="Signed terms"
          aside={
            <span className="flex items-center gap-2">
              <SignatureSeal valid={signatureValid} />
              <span
                className="hidden font-mono text-nano text-ink-soft sm:inline"
                title={row.signature}
              >
                {truncateHash(row.signature, 10, 6)}
              </span>
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <Field label="Per purchase">{formatPaise(terms.perTxnCapPaise)}</Field>
            <Field label="Total">{formatPaise(terms.totalCapPaise)}</Field>
            <Field label="Rate limit">{velocity ?? "none"}</Field>
            <Field label="Expires">
              {timestamp(row.expiresAt)}
              <span className="block text-ink-soft">{relativeTime(row.expiresAt)}</span>
            </Field>
          </div>

          <div className="mt-7 grid gap-6 border-t border-hairline pt-6 sm:grid-cols-2">
            <div>
              <div className="eyebrow mb-2.5">May buy from</div>
              <ul className="space-y-1.5">
                {terms.merchants.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-2 text-ui">
                    <span>{m.name}</span>
                    <span className="font-mono text-micro text-ink-soft">{m.vpa}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="eyebrow mb-2.5">May buy</div>
              <div className="flex flex-wrap gap-1.5">
                {terms.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono text-micro"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="On the rail"
          aside={
            <span className="font-mono text-nano uppercase tracking-[0.07em] text-ink-soft">
              upi autopay
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
            <Field label="Per debit">{token.max_amount} paise</Field>
            <Field label="Expires">{token.expire_at}</Field>
            <Field label="Frequency">{token.frequency}</Field>
          </div>

          <div className="mt-7 border-t border-hairline pt-6">
            <div className="eyebrow mb-3">Held by Writ, not by UPI</div>
            <ul className="divide-y divide-hairline border-b border-hairline">
              {unmapped.map((b) => (
                <li key={b.bound} className="flex items-baseline gap-3 py-2.5">
                  <span className="w-36 shrink-0 text-ui">{b.bound}</span>
                  <span className="font-mono text-micro tnum">{b.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <div className="grid gap-11 lg:grid-cols-2">
          <Section title={`Bought · ${purchases.length}`}>
            {purchases.length === 0 ? (
              <p className="py-6 text-ui text-ink-soft">Nothing bought yet.</p>
            ) : (
              <ul className="divide-y divide-hairline border-b border-hairline">
                {purchases.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-micro">{p.sku}</span>
                      <span className="shrink-0 font-mono text-ui tnum">
                        {formatPaise(p.amountPaise)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-nano text-ink-soft">
                      <span
                        className={
                          p.status === "PAID"
                            ? "uppercase tracking-[0.07em] text-permit"
                            : p.status === "FAILED"
                              ? "uppercase tracking-[0.07em] text-deny"
                              : "uppercase tracking-[0.07em]"
                        }
                      >
                        {p.status}
                      </span>
                      <span className="truncate">{p.razorpayOrderId ?? "no order"}</span>
                      {p.status === "CREATED" && p.razorpayOrderId && (
                        // An operator affordance, kept out of the agent's way. See
                        // /settle for why this is not on the run console.
                        <Link
                          href={`/settle/${p.id}`}
                          className={`shrink-0 text-ink ${linkClass}`}
                        >
                          settle
                        </Link>
                      )}
                      <span className="ml-auto shrink-0">{relativeTime(p.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Stopped · ${refusals.length}`}>
            {refusals.length === 0 ? (
              <p className="py-6 text-ui text-ink-soft">Nothing stopped yet.</p>
            ) : (
              <ul className="divide-y divide-hairline border-b border-hairline">
                {refusals.map((e) => {
                  const payload = parsePayload(e.payload);
                  const violations = violationsFrom(payload);
                  const name =
                    typeof payload.productName === "string" ? payload.productName : e.type;

                  return (
                    <li key={e.seq} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-ui">{name}</span>
                        {e.amountPaise !== null && (
                          <span className="shrink-0 font-mono text-ui tnum text-deny">
                            {formatPaise(e.amountPaise)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-small text-ink-mute">
                        {plainReason(e.reasonCode)}
                        {violations.length > 1 &&
                          `, and ${violations.length - 1} other reason${
                            violations.length === 2 ? "" : "s"
                          }`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <Link href={`/ledger?mandate=${row.id}`} className={`text-ui ${linkClass}`}>
          Everything this mandate has done, in order
        </Link>
      </Stack>
    </Page>
  );
}

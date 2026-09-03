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
import { StatusPill } from "@/components/verdict";
import { plainReason } from "@/lib/explain";
import { RevokeButton } from "@/components/revoke-button";
import { Card, Field, Page } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * One mandate, in full.
 *
 * The page is arranged around a claim and its evidence. The terms panel is what was
 * granted; the runway is what has been used and what was stopped; the two tables below
 * are what actually happened, taken from the ledger rather than recomputed. The
 * signature line at the bottom of the terms is the load-bearing one: it says whether
 * the terms on this screen are the terms a human signed.
 */
export default async function MandateDetailPage({ params }: PageProps<"/mandates/[id]">) {
  const { id } = await params;
  const detail = await getMandateDetail(id);
  if (!detail) notFound();

  const { row, terms, status, signatureValid, purchases, refusals } = detail;
  const velocity = velocityLabel(terms.velocityMax, terms.velocityWindowS);

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
      title={row.id}
      lede={row.intentText}
      actions={
        <>
          <StatusPill status={status} />
          {status === "ACTIVE" && <RevokeButton mandateId={row.id} />}
        </>
      }
    >
      <div className="space-y-4">
        <Card>
          <Runway
            capPaise={Number(row.totalCapPaise)}
            spentPaise={Number(detail.spentPaise)}
            blockedPaise={breachPaise}
            blockedLabel={breachLabel}
          />

          <div className="mt-5 grid grid-cols-2 gap-5 border-t border-line pt-5 sm:grid-cols-4">
            <Field label="Spent">{formatPaise(detail.spentPaise)}</Field>
            <Field label="Remaining">
              {formatPaise(detail.remainingPaise > 0n ? detail.remainingPaise : 0n)}
            </Field>
            <Field label="Purchases">{detail.purchaseCount}</Field>
            <Field label="Refused">
              <span className={detail.blockCount > 0 ? "text-deny" : ""}>
                {detail.blockCount}
              </span>
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-[13px] font-semibold">Signed terms</h2>

          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Field label="Per transaction">{formatPaise(terms.perTxnCapPaise)}</Field>
            <Field label="Total cap">{formatPaise(terms.totalCapPaise)}</Field>
            <Field label="Velocity">{velocity ?? "—"}</Field>
            <Field label="Expires">
              {timestamp(row.expiresAt)}{" "}
              <span className="text-ink-mute">({relativeTime(row.expiresAt)})</span>
            </Field>
          </div>

          <div className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
            <div>
              <div className="eyebrow mb-1.5">Merchant allowlist</div>
              <ul className="space-y-1">
                {terms.merchants.map((m) => (
                  <li key={m.id} className="font-mono text-[12px]">
                    {m.name} <span className="text-ink-mute">{m.vpa}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="eyebrow mb-1.5">Categories</div>
              <div className="flex flex-wrap gap-1.5">
                {terms.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-line bg-ground px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* The load-bearing line. If this ever says otherwise, every verdict above
              was reached against terms nobody agreed to. */}
          <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] ${
                signatureValid
                  ? "border-permit/25 bg-permit-wash text-permit"
                  : "border-deny/25 bg-deny-wash text-deny"
              }`}
            >
              {signatureValid ? "signature valid" : "signature invalid"}
            </span>
            <span className="font-mono text-[11px] text-ink-mute">
              {truncateHash(row.signature, 12, 8)}
            </span>
            {!signatureValid && (
              <span className="ml-auto text-[12px] text-deny">
                These terms have been changed since they were signed. Nothing can be
                spent against this mandate.
              </span>
            )}
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card pad={false}>
            <h2 className="border-b border-line px-5 py-3.5 text-[13px] font-semibold">
              Purchases
            </h2>
            {purchases.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink-mute">
                Nothing bought against this mandate yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {purchases.map((p) => (
                  <li key={p.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-[12px]">{p.sku}</span>
                      <span className="shrink-0 font-mono text-[12px] tnum">
                        {formatPaise(p.amountPaise)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-mute">
                      <span
                        className={
                          p.status === "PAID"
                            ? "text-permit"
                            : p.status === "FAILED"
                              ? "text-deny"
                              : ""
                        }
                      >
                        {p.status}
                      </span>
                      <span>·</span>
                      <span className="truncate normal-case tracking-normal">
                        {p.razorpayOrderId ?? "no order"}
                      </span>
                      <span className="ml-auto shrink-0 normal-case tracking-normal">
                        {relativeTime(p.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad={false}>
            <h2 className="border-b border-line px-5 py-3.5 text-[13px] font-semibold">
              Refused
            </h2>
            {refusals.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink-mute">
                Nothing has been refused against this mandate.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {refusals.map((e) => {
                  const payload = parsePayload(e.payload);
                  const violations = violationsFrom(payload);
                  const name =
                    typeof payload.productName === "string" ? payload.productName : e.type;

                  return (
                    <li key={e.seq} className="px-5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px]">{name}</span>
                        {e.amountPaise !== null && (
                          <span className="shrink-0 font-mono text-[12px] tnum text-deny">
                            {formatPaise(e.amountPaise)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[12px] text-ink-mute">
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
          </Card>
        </div>

        <Link
          href={`/ledger?mandate=${row.id}`}
          className="inline-block pt-1 text-[13px] text-ink underline underline-offset-2"
        >
          See everything this mandate has done
        </Link>
      </div>
    </Page>
  );
}

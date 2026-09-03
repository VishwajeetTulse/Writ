import Link from "next/link";
import { buildImpactReport } from "@/lib/impact";
import { formatPaiseCompact } from "@/lib/money";
import { REASON_LABELS, type ReasonCode } from "@/lib/policy";
import { Card, Page, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Impact and safety.
 *
 * Track 1 is a growth track, so this page has to answer "what is this worth to the
 * merchant" before it answers "is it safe". The baseline it argues from is stated on
 * the page rather than hidden in a deck: a merchant facing AI-buyer traffic today can
 * refuse it or accept risk it cannot bound, and both of those are zero rupees. The
 * revenue below comes from a channel that does not open without something like this.
 *
 * Every number is computed from the ledger at request time. Nothing is projected and
 * nothing is hardcoded, which also means the page reads honestly low before a demo run
 * and that is fine.
 */
export default async function ImpactPage() {
  const report = await buildImpactReport();
  const { merchant, safety, chain } = report;

  const maxRefusals = Math.max(...safety.refusalsByReason.map((r) => r.count), 1);

  return (
    <Page
      wide
      title="Impact and safety"
      lede="Computed from the ledger at request time. Nothing here is projected."
    >
      <div className="space-y-4">
        <Card>
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Merchant</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-mute">
              Razorpay test mode
            </span>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Agent-originated GMV"
              value={formatPaiseCompact(merchant.agentGmvPaise)}
              tone="permit"
              sub="Revenue from purchases an agent made under a mandate. Without bounded authority this channel is not open at all, so the honest baseline is zero."
            />
            <Stat
              label="Orders"
              value={merchant.orderCount}
              sub={`${merchant.settledCount} settled by a signature-verified webhook, worth ${formatPaiseCompact(merchant.settledGmvPaise)}.`}
            />
            <Stat
              label="Purchases per approval"
              value={merchant.purchasesPerApproval.toFixed(1)}
              sub={`${merchant.mandatesIssued} human signature${merchant.mandatesIssued === 1 ? "" : "s"} authorised every purchase above. That ratio is the leverage one approval buys.`}
            />
            <Stat
              label="Runs"
              value={merchant.runCount}
              tone="mute"
              sub="Complete agent sessions, each one grouped in the audit trail."
            />
          </div>

          <p className="mt-6 max-w-[78ch] border-t border-line pt-4 text-[13px] leading-relaxed text-ink-mute">
            A merchant that wants AI-buyer traffic today has two options. Refuse it, and
            earn nothing from it. Accept it, and take on chargeback and dispute exposure
            no one can bound, because there is no way to prove after the fact what the
            buyer was authorised to spend. Writ is the third option: the merchant gets a
            signed, capped, revocable grant it can point at, and every decision against
            it is recorded in a trail that verifies.
          </p>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <Card>
            <h2 className="mb-5 text-[13px] font-semibold">Safety</h2>

            <div className="grid gap-6 sm:grid-cols-3">
              <Stat
                label="Decisions"
                value={safety.decisionCount}
                sub={`${safety.allowedCount} permitted, ${safety.refusedCount} refused.`}
              />
              <Stat
                label="Value refused"
                value={formatPaiseCompact(safety.refusedValuePaise)}
                tone="deny"
                sub="What the blocked attempts would have cost. Risk declined, not revenue lost — none of it was ever authorised."
              />
              <Stat
                label="Decision latency"
                value={`${(safety.latency.p50Us / 1000).toFixed(2)}ms`}
                sub={`p95 ${(safety.latency.p95Us / 1000).toFixed(2)}ms, worst ${(safety.latency.maxUs / 1000).toFixed(2)}ms, across ${safety.latency.count} decisions. No model in this path.`}
              />
            </div>

            <div className="mt-7 border-t border-line pt-5">
              <div className="eyebrow mb-3">Refusals by cause</div>

              {safety.refusalsByReason.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-mute">
                  Nothing has been refused yet.{" "}
                  <Link href="/run" className="text-ink underline underline-offset-2">
                    Run the buyer
                  </Link>{" "}
                  and this fills in.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {safety.refusalsByReason.map((r) => (
                    <li key={r.reasonCode} className="flex items-center gap-3">
                      <span
                        className="w-52 shrink-0 font-mono text-[11px] font-medium"
                        title={REASON_LABELS[r.reasonCode as ReasonCode] ?? r.reasonCode}
                      >
                        {r.reasonCode}
                      </span>
                      <span className="h-3 flex-1 overflow-hidden rounded-[2px] bg-line/60">
                        <span
                          className="block h-full bg-deny/75"
                          style={{ width: `${(r.count / maxRefusals) * 100}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] tnum">
                        {r.count}
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-[11px] tnum text-ink-mute">
                        {formatPaiseCompact(r.valuePaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-4 text-[12px] leading-relaxed text-ink-mute">
                Every cause above is a value from a closed enum in the policy engine, not
                free text. That is what lets the evaluation suite score recall per class
                and the ledger filter by cause.
              </p>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <div className="eyebrow mb-3">Audit trail</div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded border px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${
                    chain.valid
                      ? "border-permit/25 bg-permit-wash text-permit"
                      : "border-deny/25 bg-deny-wash text-deny"
                  }`}
                >
                  {chain.valid ? "chain verifies" : "chain broken"}
                </span>
                <span className="font-mono text-[12px] tnum text-ink-mute">
                  {chain.recordCount} records
                </span>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
                Recomputed on this request, from the first row forward. An edited
                payload, a changed verdict, a deleted row or a reordered row all break
                the same way.{" "}
                <Link href="/ledger" className="text-ink underline underline-offset-2">
                  Verify it yourself
                </Link>
                .
              </p>
            </Card>

            <Card>
              <div className="eyebrow mb-3">Failures recovered</div>
              <div className="font-mono text-[26px] leading-none tnum">
                {safety.recoveredFailures}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
                Razorpay calls that failed and were retried with the same idempotency
                key. The key is a unique index, so a retry claims the same purchase row
                or none at all. A timeout can never become a double charge.
              </p>
            </Card>

            <Card>
              <div className="eyebrow mb-3">What this does not do</div>
              <ul className="space-y-2 text-[12px] leading-relaxed text-ink-mute">
                <li>
                  Runs the gateway in the same process as the agent. The boundary is
                  drawn at the HTTP route, not by a network.
                </li>
                <li>
                  Signs mandates with an HMAC and a shared secret, not an asymmetric key
                  the merchant could verify independently.
                </li>
                <li>
                  Uses a seeded catalog of four merchants, not a live merchant
                  integration.
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}

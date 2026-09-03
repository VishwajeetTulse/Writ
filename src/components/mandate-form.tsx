"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { evaluate, type MandateContext, type ProposedAction } from "@/lib/policy";
import type { MandateMerchant, MandateTerms } from "@/lib/mandate";
import { formatPaise } from "@/lib/money";
import { Runway } from "@/components/runway";
import { Card } from "@/components/ui";

/**
 * Issuing a mandate.
 *
 * The panel on the right is the reason this screen exists in this shape. It runs the
 * *actual* policy engine — the same `evaluate` the gateway calls on every purchase —
 * against the live catalog, in the browser, on every keystroke. Nothing is mocked and
 * nothing is approximated: `evaluate` is a pure function with no database, no network
 * and no model in it, so the verdicts here are the verdicts the gateway will reach.
 *
 * The one thing that differs between here and the server is how the engine times
 * itself, because browsers have no high-resolution process clock. The verdict does not
 * depend on that, and the preview does not show a latency.
 *
 * That turns signing from an act of faith into an act of reading. Before you grant
 * authority you can see precisely which of a merchant's products this mandate permits
 * and which it refuses, with the reason code for each. A cap is an abstraction; "this
 * refuses the ₹28,999 television and permits the ₹62 milk" is not.
 */

export interface FormProduct {
  sku: string;
  name: string;
  category: string;
  pricePaise: number;
  merchantId: string;
  merchantName: string;
}

export interface FormMerchant {
  id: string;
  name: string;
  vpa: string;
  category: string;
}

/** The reference instant the preview measures from. See `previewExpiresAt` below. */
const PREVIEW_NOW = new Date(0);

/**
 * A rate limit is stored in seconds because that is what the signed terms carry, but
 * nobody thinks in seconds. The form takes a count and a unit and multiplies.
 */
const WINDOW_UNITS = { minute: 60, hour: 3600, day: 86_400 } as const;
type UnitKey = keyof typeof WINDOW_UNITS;

const DURATIONS = [
  { label: "6 hours", hours: 6 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

export function MandateForm({
  merchants,
  products,
}: {
  merchants: FormMerchant[];
  products: FormProduct[];
}) {
  const router = useRouter();

  const [intentText, setIntentText] = useState(
    "Weekly grocery top-up from FreshCart. Nothing over ₹700 a time, ₹2,000 for the week.",
  );
  const [merchantIds, setMerchantIds] = useState<string[]>([merchants[0]?.id].filter(Boolean) as string[]);
  const [categories, setCategories] = useState<string[]>(["grocery"]);
  const [perTxn, setPerTxn] = useState(700);
  const [total, setTotal] = useState(2000);
  const [velocityOn, setVelocityOn] = useState(true);
  const [velocityMax, setVelocityMax] = useState(5);
  const [windowCount, setWindowCount] = useState(1);
  const [windowUnit, setWindowUnit] = useState<UnitKey>("hour");

  const velocityWindowS = windowCount * WINDOW_UNITS[windowUnit];
  const [hours, setHours] = useState(24 * 7);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const allCategories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products],
  );

  const selectedMerchants: MandateMerchant[] = useMemo(
    () =>
      merchants
        .filter((m) => merchantIds.includes(m.id))
        .map((m) => ({ id: m.id, name: m.name, vpa: m.vpa })),
    [merchants, merchantIds],
  );

  // The preview answers "what does this permit the moment it is signed", so it needs
  // no clock at all — only the gap between issue and expiry. Both sides are measured
  // from the same reference instant, which keeps this component a pure function of its
  // inputs and its verdicts reproducible. The real expiry is stamped at submit time.
  const previewExpiresAt = useMemo(
    () => new Date(hours * 3600_000).toISOString(),
    [hours],
  );

  // The terms exactly as they will be signed, so the preview below judges the real thing.
  const terms: MandateTerms = useMemo(
    () => ({
      id: "mnd_preview",
      userId: "demo-user",
      merchants: selectedMerchants,
      categories,
      perTxnCapPaise: BigInt(Math.round(perTxn * 100)),
      totalCapPaise: BigInt(Math.round(total * 100)),
      velocityMax: velocityOn ? velocityMax : null,
      velocityWindowS: velocityOn ? velocityWindowS : null,
      expiresAt: previewExpiresAt,
    }),
    [
      selectedMerchants,
      categories,
      perTxn,
      total,
      velocityOn,
      velocityMax,
      velocityWindowS,
      previewExpiresAt,
    ],
  );

  /**
   * Run the real engine over the whole catalog. Nothing has been spent yet, so this is
   * the mandate's opening position: what it permits on its first call.
   */
  const preview = useMemo(() => {
    const context: MandateContext = { terms, status: "ACTIVE", signatureValid: true };

    const rows = products.map((p) => {
      const action: ProposedAction = {
        sku: p.sku,
        quantity: 1,
        merchantId: p.merchantId,
        category: p.category,
        amountPaise: BigInt(p.pricePaise),
        idempotencyKey: `preview_${p.sku}`,
      };

      const decision = evaluate(
        context,
        { spentPaise: 0n, recentPurchaseTimes: [], idempotencyKeyUsed: false },
        action,
        PREVIEW_NOW,
      );

      return { product: p, decision };
    });

    const permitted = rows.filter((r) => r.decision.verdict === "ALLOW");
    const refused = rows.filter((r) => r.decision.verdict !== "ALLOW");

    // The most expensive refusal is the interesting one — it is the thing this mandate
    // is actually protecting against, and it drives the runway's breach marker.
    const worst = refused.reduce<(typeof refused)[number] | null>(
      (max, r) =>
        !max || r.product.pricePaise > max.product.pricePaise ? r : max,
      null,
    );

    return { rows, permitted, refused, worst };
  }, [terms, products]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    // Read the clock here rather than from state: an expiry computed at page load and
    // signed ten minutes later is ten minutes short of what the operator chose.
    const signedExpiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
    try {
      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentText,
          merchants: selectedMerchants,
          categories,
          perTxnCapRupees: perTxn,
          totalCapRupees: total,
          velocityMax: velocityOn ? velocityMax : null,
          velocityWindowS: velocityOn ? velocityWindowS : null,
          expiresAt: signedExpiresAt,
        }),
      });

      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? "Could not issue the mandate.");
        return;
      }
      router.push(`/mandates/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    intentText.trim().length > 0 &&
    selectedMerchants.length > 0 &&
    categories.length > 0 &&
    perTxn > 0 &&
    total > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------------------------------------------------------- form */}
      <Card>
        <h2 className="mb-4 text-[13px] font-semibold">Terms</h2>

        <label className="block">
          <span className="eyebrow">What this is for</span>
          <textarea
            value={intentText}
            onChange={(e) => setIntentText(e.target.value)}
            rows={2}
            className="mt-1.5 w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-ink-mute"
          />
          <span className="mt-1 block text-[12px] text-ink-mute">
            Kept verbatim in the audit trail, exactly as written.
          </span>
        </label>

        <div className="mt-5">
          <span className="eyebrow">Merchant allowlist</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {merchants.map((m) => {
              const on = merchantIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    setMerchantIds((prev) =>
                      on ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                    )
                  }
                  className={`rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    on
                      ? "border-ink bg-ink text-surface"
                      : "border-line bg-surface text-ink-mute hover:border-line-strong"
                  }`}
                >
                  <span className="block font-medium">{m.name}</span>
                  <span className="block font-mono text-[10px] opacity-70">{m.vpa}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <span className="eyebrow">Categories</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {allCategories.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setCategories((prev) =>
                      on ? prev.filter((x) => x !== c) : [...prev, c],
                    )
                  }
                  className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                    on
                      ? "border-ink bg-ink text-surface"
                      : "border-line bg-surface text-ink-mute hover:border-line-strong"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="eyebrow">Per transaction (₹)</span>
            <input
              type="number"
              min={1}
              value={perTxn}
              onChange={(e) => setPerTxn(Number(e.target.value))}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[14px] tnum outline-none focus:border-ink-mute"
            />
          </label>
          <label className="block">
            <span className="eyebrow">Total cap (₹)</span>
            <input
              type="number"
              min={1}
              value={total}
              onChange={(e) => setTotal(Number(e.target.value))}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[14px] tnum outline-none focus:border-ink-mute"
            />
          </label>
        </div>

        <div className="mt-5">
          <span className="eyebrow">Expires</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button
                key={d.hours}
                type="button"
                onClick={() => setHours(d.hours)}
                className={`rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
                  hours === d.hours
                    ? "border-ink bg-ink text-surface"
                    : "border-line bg-surface text-ink-mute hover:border-line-strong"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={velocityOn}
              onChange={(e) => setVelocityOn(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#16161a]"
            />
            <span className="text-[13px]">Rate limit</span>
          </label>

          {velocityOn && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <input
                type="number"
                min={1}
                value={velocityMax}
                onChange={(e) => setVelocityMax(Math.max(Number(e.target.value), 1))}
                className="w-16 rounded-md border border-line px-2 py-1.5 text-center font-mono tnum outline-none focus:border-ink-mute"
              />
              <span className="text-ink-mute">purchases every</span>
              <input
                type="number"
                min={1}
                value={windowCount}
                onChange={(e) => setWindowCount(Math.max(Number(e.target.value), 1))}
                className="w-16 rounded-md border border-line px-2 py-1.5 text-center font-mono tnum outline-none focus:border-ink-mute"
              />
              <select
                value={windowUnit}
                onChange={(e) => setWindowUnit(e.target.value as UnitKey)}
                className="rounded-md border border-line bg-surface px-2 py-1.5 outline-none focus:border-ink-mute"
              >
                <option value="minute">{windowCount === 1 ? "minute" : "minutes"}</option>
                <option value="hour">{windowCount === 1 ? "hour" : "hours"}</option>
                <option value="day">{windowCount === 1 ? "day" : "days"}</option>
              </select>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-deny/25 bg-deny-wash px-3 py-2 text-[13px] text-deny">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={!valid || submitting}
          className="mt-5 w-full rounded-md bg-ink py-2.5 text-[14px] font-medium text-surface transition-opacity hover:opacity-88 disabled:opacity-40"
        >
          {submitting ? "Signing…" : "Sign and issue"}
        </button>
        <p className="mt-2 text-center text-[12px] text-ink-mute">
          Signing computes an HMAC over the canonical terms. Editing any of them
          afterwards invalidates it.
        </p>
      </Card>

      {/* ------------------------------------------------------------- preview */}
      <Card>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">What this permits</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-mute">
            live policy engine
          </span>
        </div>

        <Runway
          capPaise={Math.round(total * 100)}
          spentPaise={0}
          blockedPaise={preview.worst?.product.pricePaise ?? null}
          blockedLabel={
            preview.worst ? `${preview.worst.product.name} refused` : null
          }
        />

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <div>
            <div className="eyebrow mb-1">Permitted</div>
            <div className="font-mono text-[20px] tnum text-permit">
              {preview.permitted.length}
              <span className="text-[13px] text-ink-mute"> / {preview.rows.length}</span>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1">Refused</div>
            <div className="font-mono text-[20px] tnum text-deny">
              {preview.refused.length}
            </div>
          </div>
        </div>

        <div className="mt-4 max-h-[420px] overflow-y-auto rounded-md border border-line">
          <table className="w-full border-collapse text-left">
            <tbody>
              {preview.rows
                .slice()
                .sort((a, b) => b.product.pricePaise - a.product.pricePaise)
                .map(({ product, decision }) => {
                  const allowed = decision.verdict === "ALLOW";
                  return (
                    <tr key={product.sku} className="border-b border-line/70 last:border-0">
                      <td className="w-1 py-2 pl-3">
                        <span
                          className={`block h-4 w-[3px] rounded-full ${
                            allowed ? "bg-permit" : "bg-deny"
                          }`}
                        />
                      </td>
                      <td className="max-w-0 py-2 pl-2.5 pr-2">
                        <div className="truncate text-[13px]">{product.name}</div>
                        <div className="truncate font-mono text-[10px] text-ink-mute">
                          {product.merchantName} · {product.category}
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2 text-right font-mono text-[12px] tnum">
                        {formatPaise(BigInt(product.pricePaise))}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {allowed ? (
                          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-permit">
                            allow
                          </span>
                        ) : (
                          <span
                            className="font-mono text-[10px] text-deny"
                            title={decision.violations
                              .map((v) => v.reasonCode)
                              .join(", ")}
                          >
                            {decision.reasonCode}
                            {decision.violations.length > 1 && (
                              <span className="text-ink-mute">
                                {" "}
                                +{decision.violations.length - 1}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[12px] text-ink-mute">
          These are the decisions this mandate will actually make once it is signed.
        </p>
      </Card>
    </div>
  );
}

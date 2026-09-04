"use client";

import { useMemo, useState } from "react";
import { formatPaise } from "@/lib/money";

/**
 * The catalog browser.
 *
 * Filtering happens in the browser rather than as a round trip, because the whole
 * catalog is seventeen items and a server hop for a keystroke would be slower and
 * worse. If this ever holds a real merchant's inventory, the filters move to the
 * query in `searchCatalog` and this component takes a page of results instead.
 */

export type Coverage =
  | { kind: "covered"; mandateId: string; mandateIntent: string }
  | { kind: "over_cap"; capPaise: number }
  | { kind: "over_budget"; remainingPaise: number }
  | { kind: "uncovered" }
  | { kind: "unknown" };

export interface CatalogProductView {
  sku: string;
  name: string;
  description: string;
  category: string;
  pricePaise: number;
  inStock: boolean;
  merchantId: string;
  /** The description talks to AI agents. See `addressesAgents` in lib/catalog.ts. */
  addressesAgents: boolean;
  coverage: Coverage;
}

export interface CatalogMerchantView {
  id: string;
  name: string;
  vpa: string;
  category: string;
  /** Active mandates of this user that list this shop. */
  mandateCount: number;
  products: CatalogProductView[];
}

export function CatalogBrowser({
  merchants,
  signedIn,
  hasMandates,
}: {
  merchants: CatalogMerchantView[];
  signedIn: boolean;
  hasMandates: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [coveredOnly, setCoveredOnly] = useState(false);

  const categories = useMemo(
    () =>
      [...new Set(merchants.flatMap((m) => m.products.map((p) => p.category)))].sort(),
    [merchants],
  );

  const total = useMemo(
    () => merchants.reduce((n, m) => n + m.products.length, 0),
    [merchants],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return merchants
      .filter((m) => !merchantId || m.id === merchantId)
      .map((m) => ({
        ...m,
        products: m.products.filter((p) => {
          if (category && p.category !== category) return false;
          if (coveredOnly && p.coverage.kind !== "covered") return false;
          if (!needle) return true;
          return (
            p.name.toLowerCase().includes(needle) ||
            p.sku.toLowerCase().includes(needle) ||
            p.category.toLowerCase().includes(needle) ||
            m.name.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((m) => m.products.length > 0);
  }, [merchants, query, category, merchantId, coveredOnly]);

  const shown = filtered.reduce((n, m) => n + m.products.length, 0);
  const narrowed = shown !== total;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items"
          className="h-9 min-w-[200px] flex-1 rounded-md border border-line bg-surface px-3 text-[13px] outline-none placeholder:text-ink-mute focus:border-line-strong"
        />

        <select
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-line-strong"
        >
          <option value="">All shops</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-line-strong"
        >
          <option value="">All kinds</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {signedIn && hasMandates && (
          <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 text-[13px] text-ink-mute">
            <input
              type="checkbox"
              checked={coveredOnly}
              onChange={(e) => setCoveredOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            />
            Only what a mandate covers
          </label>
        )}
      </div>

      <p className="mb-4 font-mono text-[11px] tnum text-ink-mute">
        {narrowed
          ? `${shown} of ${total} items`
          : `${total} items across ${merchants.length} shops`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center text-[13px] text-ink-mute">
          Nothing matches that.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((m) => (
            <MerchantCard key={m.id} merchant={m} signedIn={signedIn} />
          ))}
        </div>
      )}
    </div>
  );
}

function MerchantCard({
  merchant,
  signedIn,
}: {
  merchant: CatalogMerchantView;
  signedIn: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{merchant.name}</h2>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-mute">
          {merchant.category}
        </span>
        <span className="font-mono text-[11px] text-ink-mute">{merchant.vpa}</span>

        <span className="ml-auto text-[12px] text-ink-mute">
          {signedIn
            ? merchant.mandateCount > 0
              ? `Covered by ${merchant.mandateCount} of your mandates`
              : "No mandate of yours covers this shop"
            : `${merchant.products.length} items`}
        </span>
      </header>

      <ul>
        {merchant.products.map((p) => (
          <li
            key={p.sku}
            className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-[14px]">{p.name}</span>
                <span className="font-mono text-[11px] text-ink-mute">{p.sku}</span>
                {!p.inStock && (
                  <span className="font-mono text-[11px] text-ink-mute">out of stock</span>
                )}
              </div>

              <p className="mt-1 line-clamp-1 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-mute">
                {p.description}
              </p>

              {p.addressesAgents && (
                <p className="mt-1.5 text-[12px] leading-snug text-hold">
                  This description contains instructions aimed at AI agents. Nothing
                  written here can change a limit.
                </p>
              )}
            </div>

            <div className="shrink-0 text-right">
              <div className="font-mono text-[14px] tnum">
                {formatPaise(BigInt(p.pricePaise), { showPaise: false })}
              </div>
              <CoverageNote coverage={p.coverage} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this item means for the person's own mandates.
 *
 * These read off the mandate's own numbers. The binding answer still comes from the
 * policy engine at the moment of purchase, which also weighs the rate limit and
 * whatever else has been spent since this page rendered.
 */
function CoverageNote({ coverage }: { coverage: Coverage }) {
  switch (coverage.kind) {
    case "covered":
      return (
        <div className="mt-1 text-[12px] text-permit" title={coverage.mandateIntent}>
          Covered
        </div>
      );
    case "over_cap":
      return (
        <div className="mt-1 text-[12px] text-deny">
          Over your {formatPaise(BigInt(coverage.capPaise), { showPaise: false })} limit
        </div>
      );
    case "over_budget":
      return (
        <div className="mt-1 text-[12px] text-hold">
          More than the{" "}
          {formatPaise(BigInt(coverage.remainingPaise), { showPaise: false })} left
        </div>
      );
    case "uncovered":
      return <div className="mt-1 text-[12px] text-ink-mute">Not in a mandate</div>;
    default:
      return null;
  }
}

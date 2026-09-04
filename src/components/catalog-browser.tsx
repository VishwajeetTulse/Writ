"use client";

import { useMemo, useState } from "react";
import { formatPaise } from "@/lib/money";
import { controlBase, Empty, inputClass, linkClass } from "@/components/ui";
import type { Coverage } from "@/lib/catalog-coverage";

/**
 * The catalog browser.
 *
 * Laid out as a catalogue rather than a grid of product cards: each shop is a heading
 * with its stock listed beneath it. A card per product would give thirty-five equally
 * weighted boxes and no way to see which shop you were in.
 *
 * Filtering happens in the browser rather than as a round trip, because the whole
 * catalog is a few dozen items and a server hop for a keystroke would be slower and
 * worse. If this ever holds a real merchant's inventory, the filters move to the
 * query in `searchCatalog` and this component takes a page of results instead.
 */

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
  const [sort, setSort] = useState<"price" | "price-desc" | "name">("price");

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
      .map((m) => ({
        ...m,
        products: [...m.products].sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : sort === "price-desc"
              ? b.pricePaise - a.pricePaise
              : a.pricePaise - b.pricePaise,
        ),
      }))
      .filter((m) => m.products.length > 0);
  }, [merchants, query, category, merchantId, coveredOnly, sort]);

  const shown = filtered.reduce((n, m) => n + m.products.length, 0);
  const narrowed = shown !== total;
  const covered = filtered.reduce(
    (n, m) => n + m.products.filter((p) => p.coverage.kind === "covered").length,
    0,
  );

  function clear() {
    setQuery("");
    setCategory("");
    setMerchantId("");
    setCoveredOnly(false);
    setSort("price");
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items"
          aria-label="Search items"
          className={`${inputClass} min-w-[180px] max-w-[280px] flex-1`}
        />

        <select
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          aria-label="Filter by shop"
          className={`${controlBase} h-[34px] w-auto`}
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
          aria-label="Filter by kind of item"
          className={`${controlBase} h-[34px] w-auto`}
        >
          <option value="">All kinds</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Sort items"
          className={`${controlBase} h-[34px] w-auto`}
        >
          <option value="price">Cheapest first</option>
          <option value="price-desc">Dearest first</option>
          <option value="name">By name</option>
        </select>

        {signedIn && hasMandates && (
          <label className="flex h-[34px] shrink-0 cursor-pointer items-center gap-2 rounded-sm border border-line bg-surface px-3 text-ui text-ink-mute transition-colors hover:border-line-strong">
            <input
              type="checkbox"
              checked={coveredOnly}
              onChange={(e) => setCoveredOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            />
            Only what a mandate covers
          </label>
        )}

        <span className="ml-auto font-mono text-micro tnum text-ink-soft">
          {narrowed ? `${shown} of ${total}` : `${total} items`}
          {signedIn && hasMandates && (
            <>
              <span aria-hidden className="mx-1.5 text-line-strong">·</span>
              <span className={covered > 0 ? "text-permit" : undefined}>
                {covered} covered
              </span>
            </>
          )}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Nothing in the catalog matches that."
          action={
            <button onClick={clear} className={`text-ui text-ink ${linkClass}`}>
              Clear the filters
            </button>
          }
        />
      ) : (
        <div className="space-y-10">
          {filtered.map((m) => (
            <MerchantListing key={m.id} merchant={m} signedIn={signedIn} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One shop and its stock. A heading and a rule, not a box. */
function MerchantListing({
  merchant,
  signedIn,
}: {
  merchant: CatalogMerchantView;
  signedIn: boolean;
}) {
  const prices = merchant.products.map((p) => p.pricePaise);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2.5">
        <h2 className="human text-title leading-none tracking-[-0.01em]">
          {merchant.name}
        </h2>
        <span className="font-mono text-micro text-ink-soft">{merchant.vpa}</span>
        <span className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-nano uppercase tracking-[0.07em] text-ink-soft">
          {merchant.category}
        </span>
        {signedIn && (
          <span
            className={`font-mono text-nano uppercase tracking-[0.07em] ${
              merchant.mandateCount > 0 ? "text-permit" : "text-ink-soft"
            }`}
          >
            {merchant.mandateCount > 0
              ? `${merchant.mandateCount} mandate${merchant.mandateCount === 1 ? "" : "s"}`
              : "no mandate"}
          </span>
        )}

        <span className="ml-auto font-mono text-micro tnum text-ink-soft">
          {merchant.products.length} items · {formatPaise(BigInt(low), { showPaise: false })}
          {low === high ? "" : `–${formatPaise(BigInt(high), { showPaise: false })}`}
        </span>
      </div>

      <ul className="divide-y divide-hairline border-b border-hairline">
        {merchant.products.map((p) => (
          <li
            key={p.sku}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 py-3"
          >
            <div className="min-w-0">
              <span className="text-body">{p.name}</span>
              <span className="ml-2.5 font-mono text-nano text-ink-soft">{p.sku}</span>
              {!p.inStock && (
                <span className="ml-2.5 font-mono text-nano uppercase tracking-[0.07em] text-ink-soft">
                  out of stock
                </span>
              )}
            </div>

            <div className="text-right font-mono text-body tnum">
              {formatPaise(BigInt(p.pricePaise), { showPaise: false })}
            </div>

            <div className="col-start-1 min-w-0">
              <p className="line-clamp-1 text-small text-ink-soft">{p.description}</p>

              {p.addressesAgents && (
                <p className="mt-1.5 border-l-2 border-hold/50 pl-2.5 text-small text-hold">
                  Contains instructions aimed at AI agents.
                </p>
              )}
            </div>

            <div className="col-start-2 text-right">
              <CoverageNote coverage={p.coverage} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this item means for the person's own mandates, as decided by the policy engine
 * on the server. Nothing is re-judged here — this only renders the answer.
 */
function CoverageNote({ coverage }: { coverage: Coverage }) {
  if (coverage.kind === "covered") {
    return (
      <div className="text-small text-permit" title={coverage.mandateIntent}>
        Covered
      </div>
    );
  }

  if (coverage.kind === "refused") {
    // Out of scope is a quieter fact than a limit being hit. Only the second one is
    // something the person might want to go and change.
    const scope =
      coverage.reasonCode === "MERCHANT_NOT_ALLOWED" ||
      coverage.reasonCode === "CATEGORY_NOT_ALLOWED";

    return (
      <div className={`text-small ${scope ? "text-ink-soft" : "text-deny"}`}>
        {coverage.note}
      </div>
    );
  }

  return null;
}

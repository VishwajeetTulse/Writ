import Link from "next/link";
import { addressesAgents, listMerchants, searchCatalog } from "@/lib/catalog";
import { listMandates, type MandateListItem } from "@/lib/mandate-service";
import { currentUser } from "@/lib/session";
import { Empty, Page } from "@/components/ui";
import {
  CatalogBrowser,
  type CatalogMerchantView,
  type Coverage,
} from "@/components/catalog-browser";

export const dynamic = "force-dynamic";

/**
 * The catalog.
 *
 * Open to anyone, signed in or not, which is the point rather than an oversight: the
 * same list is served as JSON at /api/catalog for an AI buyer to read cold. Discovery
 * is open; execution is gated behind a signed mandate at the gateway.
 *
 * For someone signed in it does one extra thing — it says which items their own
 * mandates already cover. That turns an abstract set of limits into a shopping list,
 * and it is usually the fastest way to find out that a cap is set too tight.
 */
export default async function CatalogPage() {
  const user = await currentUser();

  const [merchants, products, mandates] = await Promise.all([
    listMerchants(),
    searchCatalog({ limit: 500 }),
    user ? listMandates(user.id) : Promise.resolve<MandateListItem[]>([]),
  ]);

  const active = mandates.filter((m) => m.status === "ACTIVE");

  const view: CatalogMerchantView[] = merchants.map((m) => ({
    id: m.id,
    name: m.name,
    vpa: m.vpa,
    category: m.category,
    mandateCount: active.filter((mandate) =>
      mandate.merchants.some((allowed) => allowed.id === m.id),
    ).length,
    products: products
      .filter((p) => p.merchantId === m.id)
      .map((p) => ({
        sku: p.sku,
        name: p.name,
        description: p.description,
        category: p.category,
        // Paise as a number, not a bigint: this crosses the wire to a client
        // component, and every price here is orders of magnitude inside the safe
        // integer range.
        pricePaise: Number(p.pricePaise),
        inStock: p.inStock,
        merchantId: p.merchantId,
        addressesAgents: addressesAgents(p.description),
        coverage: user ? coverageFor(p.merchantId, p.category, p.pricePaise, active) : { kind: "unknown" },
      })),
  }));

  return (
    <Page
      title="Catalog"
      lede="What an AI buyer can see. Four shops and their stock, seeded as demo data — a real merchant would publish its own feed."
      actions={
        user ? (
          <Link
            href="/mandates/new"
            className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-medium text-surface transition-opacity hover:opacity-88"
          >
            New mandate
          </Link>
        ) : (
          <Link
            href="/sign-in"
            className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-medium text-surface transition-opacity hover:opacity-88"
          >
            Sign in
          </Link>
        )
      }
    >
      {view.length === 0 ? (
        <Empty>
          The catalog is empty. Run <span className="font-mono">npm run db:seed</span>.
        </Empty>
      ) : (
        <>
          <CatalogBrowser
            merchants={view}
            signedIn={Boolean(user)}
            hasMandates={active.length > 0}
          />

          <p className="mt-6 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-mute">
            Anyone can read this list without an account, as JSON at{" "}
            <a href="/api/catalog" className="font-mono underline">
              /api/catalog
            </a>
            . Buying from it takes a signed mandate.
          </p>
        </>
      )}
    </Page>
  );
}

/**
 * What one item means for this person's mandates.
 *
 * Read off the mandate's own terms, so it can say why something would be refused
 * before anyone tries. It is a preview, not the verdict — the binding answer comes
 * from the policy engine at the moment of purchase, which also weighs the rate limit
 * and anything spent between now and then.
 */
function coverageFor(
  merchantId: string,
  category: string,
  pricePaise: bigint,
  active: MandateListItem[],
): Coverage {
  const covering = active.filter(
    (m) =>
      m.merchants.some((allowed) => allowed.id === merchantId) &&
      m.categories.includes(category),
  );

  if (covering.length === 0) return { kind: "uncovered" };

  const withinCap = covering.filter((m) => m.perTxnCapPaise >= pricePaise);
  if (withinCap.length === 0) {
    const best = covering.reduce((a, b) => (b.perTxnCapPaise > a.perTxnCapPaise ? b : a));
    return { kind: "over_cap", capPaise: Number(best.perTxnCapPaise) };
  }

  const left = (m: MandateListItem) =>
    m.remainingPaise > 0n ? m.remainingPaise : 0n;

  const affordable = withinCap.filter((m) => left(m) >= pricePaise);
  if (affordable.length === 0) {
    const best = withinCap.reduce((a, b) => (left(b) > left(a) ? b : a));
    return { kind: "over_budget", remainingPaise: Number(left(best)) };
  }

  const chosen = affordable[0];
  return {
    kind: "covered",
    mandateId: chosen.id,
    mandateIntent: chosen.intentText,
  };
}

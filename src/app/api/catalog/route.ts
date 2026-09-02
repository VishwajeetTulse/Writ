import { listMerchants, searchCatalog } from "@/lib/catalog";

/**
 * The agent-readable catalog.
 *
 * Track 1 asks you to make a merchant "sellable to AI buyers", and lists an
 * agent-readable catalog as one of its example directions. This is that: a public,
 * typed, unauthenticated product feed that any AI buyer can read cold.
 *
 * Note what it does *not* do. It hands out prices, categories and merchant VPAs to
 * anyone who asks, and that is fine — discovery is meant to be open. Nothing here can
 * move money. Execution is gated separately at /api/gateway/purchase, behind a signed
 * mandate. Open discovery, gated execution: that is the whole shape of the product.
 *
 * The buyer agent reads this endpoint over HTTP rather than touching the database
 * directly, which keeps the claim honest — the catalog really is agent-readable, and
 * you can prove it with curl.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  const category = url.searchParams.get("category") ?? undefined;
  const merchantId = url.searchParams.get("merchant") ?? undefined;
  const query = url.searchParams.get("q") ?? undefined;
  const maxPriceParam = url.searchParams.get("max_price_paise");

  const [merchants, products] = await Promise.all([
    listMerchants(),
    searchCatalog({
      query,
      category,
      merchantId,
      maxPricePaise: maxPriceParam ? BigInt(maxPriceParam) : undefined,
      limit: 200,
    }),
  ]);

  return Response.json({
    currency: "INR",
    /** Amounts are integer paise throughout. 100 paise = ₹1. */
    amount_unit: "paise",
    merchants: merchants.map((m) => ({
      id: m.id,
      name: m.name,
      vpa: m.vpa,
      category: m.category,
    })),
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      description: p.description,
      category: p.category,
      price_paise: p.pricePaise,
      in_stock: p.inStock,
      merchant_id: p.merchantId,
      merchant_name: p.merchantName,
      merchant_vpa: p.merchantVpa,
    })),
    count: products.length,
  });
}

import { prisma } from "./db";

/**
 * Server-side catalog access.
 *
 * This module exists to enforce one rule: **the gateway prices every purchase itself.**
 *
 * The buyer agent chooses a SKU and a quantity. It does not get to say what that costs.
 * If the model claims a ₹28,999 television is ₹99 — whether through a hallucination or
 * because a product description talked it into doing so — the gateway looks the price up
 * here and evaluates the real number. The model's claim is an input, never a fact.
 */

export interface CatalogProduct {
  sku: string;
  merchantId: string;
  merchantName: string;
  merchantVpa: string;
  name: string;
  category: string;
  pricePaise: bigint;
  description: string;
  inStock: boolean;
}

/** Look up one SKU with its merchant. Returns null for an unknown SKU. */
export async function getProduct(sku: string): Promise<CatalogProduct | null> {
  const p = await prisma.product.findUnique({
    where: { sku },
    include: { merchant: true },
  });
  if (!p) return null;
  return {
    sku: p.sku,
    merchantId: p.merchantId,
    merchantName: p.merchant.name,
    merchantVpa: p.merchant.vpa,
    name: p.name,
    category: p.category,
    pricePaise: p.pricePaise,
    description: p.description,
    inStock: p.inStock,
  };
}

/**
 * The authoritative price for a line item.
 *
 * Multiplication happens in bigint, so there is no float rounding between the catalog
 * price and the number the policy engine compares against the cap.
 */
export function priceFor(product: CatalogProduct, quantity: number): bigint {
  return product.pricePaise * BigInt(quantity);
}

export interface SearchOptions {
  query?: string;
  category?: string;
  merchantId?: string;
  maxPricePaise?: bigint;
  limit?: number;
}

/** Catalog search, backing both the agent's `search_catalog` tool and /api/catalog. */
export async function searchCatalog(opts: SearchOptions = {}): Promise<CatalogProduct[]> {
  const rows = await prisma.product.findMany({
    where: {
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.merchantId ? { merchantId: opts.merchantId } : {}),
      ...(opts.maxPricePaise !== undefined
        ? { pricePaise: { lte: opts.maxPricePaise } }
        : {}),
      ...(opts.query
        ? {
            OR: [
              { name: { contains: opts.query } },
              { category: { contains: opts.query } },
            ],
          }
        : {}),
    },
    include: { merchant: true },
    orderBy: { pricePaise: "asc" },
    take: opts.limit ?? 50,
  });

  return rows.map((p) => ({
    sku: p.sku,
    merchantId: p.merchantId,
    merchantName: p.merchant.name,
    merchantVpa: p.merchant.vpa,
    name: p.name,
    category: p.category,
    pricePaise: p.pricePaise,
    description: p.description,
    inStock: p.inStock,
  }));
}

/** Every merchant, for the mandate drafter's context and the public catalog feed. */
export async function listMerchants() {
  return prisma.merchant.findMany({ orderBy: { name: "asc" } });
}

/**
 * Does this product description talk to an AI agent rather than to a shopper?
 *
 * A merchant controls its own product text, so that text is the attacker's channel
 * into any AI buyer that reads it. This is a naive marker match, not a defence —
 * the defence is that the policy engine never reads the description at all. It exists
 * so the console can point at the one seeded product that carries such a payload.
 */
export function addressesAgents(description: string): boolean {
  return /system note|ignore (all )?previous|ai (shopping )?assistant|you are (authorised|authorized|instructed|expected)/i.test(
    description,
  );
}

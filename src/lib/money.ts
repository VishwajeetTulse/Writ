/**
 * Money in Writ is always an integer count of paise, held in a `bigint`.
 *
 * There are no floats anywhere in the money path. A per-transaction cap is an
 * integer comparison, not a rounding decision — which is what makes the policy
 * engine's verdicts reproducible and its latency measurable in microseconds.
 */

/** Rupees (as a human types them) to paise. Rounds half-up at the paise boundary. */
export function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

/** Paise to a plain rupee number. For display only — never feed this back into a comparison. */
export function paiseToRupees(paise: bigint): number {
  return Number(paise) / 100;
}

/**
 * Format paise as Indian currency: 189900n -> "₹1,899.00".
 * Uses the Indian digit grouping (lakh/crore), which `en-IN` gives us for free.
 */
export function formatPaise(paise: bigint, opts?: { showPaise?: boolean }): string {
  const showPaise = opts?.showPaise ?? true;
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: showPaise ? 2 : 0,
  }).format(rupees);
}

/** Compact form for dense UI: 189900n -> "₹1,899". Drops the paise. */
export function formatPaiseCompact(paise: bigint): string {
  return formatPaise(paise, { showPaise: false });
}

/**
 * `JSON.stringify` throws on bigint. Every API route that returns money needs this,
 * so it is installed once here and imported for its side effect from the Prisma client
 * module — which every route already imports.
 *
 * BigInt serializes to a JSON *number*, not a string: paise values are far below
 * Number.MAX_SAFE_INTEGER (9 quadrillion paise is ~₹90 trillion), so this is lossless
 * for any amount this system will ever hold, and it keeps the JSON feed clean for the
 * AI buyer agent consuming /api/catalog.
 */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => number };
  if (!proto.toJSON) {
    proto.toJSON = function (this: bigint): number {
      return Number(this);
    };
  }
}

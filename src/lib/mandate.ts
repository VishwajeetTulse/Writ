import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The mandate: a signed, bounded, revocable grant of spending authority.
 *
 * The security property this file provides is narrow and specific: given a mandate
 * loaded from the database, `verifySignature` tells you whether its *terms* are the
 * terms a human actually signed. If anyone edits a cap, adds a merchant, or extends
 * the expiry by writing directly to the row, the signature stops matching and the
 * gateway refuses the mandate outright.
 *
 * That matters because the policy engine's verdict is only as trustworthy as the
 * mandate it evaluated. Bounds you can silently rewrite are not bounds.
 */

export interface MandateMerchant {
  id: string;
  name: string;
  /** UPI-shaped by design: the allowlist is keyed on VPA, mirroring UPI Reserve Pay. */
  vpa: string;
}

/** The signed terms. Every field here is inside the signature. */
export interface MandateTerms {
  id: string;
  userId: string;
  merchants: MandateMerchant[];
  categories: string[];
  perTxnCapPaise: bigint;
  totalCapPaise: bigint;
  velocityMax: number | null;
  velocityWindowS: number | null;
  /** ISO-8601, always UTC. */
  expiresAt: string;
}

/**
 * What the drafting LLM produces. Deliberately a distinct type from `MandateTerms`:
 * a draft carries no id, no signature, and no authority. It is a proposal for a human
 * to edit and sign, and the type system says so.
 */
export interface MandateDraft {
  merchants: MandateMerchant[];
  categories: string[];
  perTxnCapPaise: bigint;
  totalCapPaise: bigint;
  velocityMax: number | null;
  velocityWindowS: number | null;
  expiresAt: string;
  /** Per-field one-liners explaining why the model chose these terms. Never signed. */
  rationale: Record<string, string>;
}

export type MandateStatus = "DRAFT" | "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED";

/**
 * Hard server-side ceilings, applied to every draft before a human ever sees it.
 *
 * The drafting model is the one place an LLM shapes a money boundary, so its output is
 * clamped by code that the model has no access to. If the model hallucinates a ₹2,00,000
 * cap from "keep it cheap", the clamp catches it before the review screen, and the human
 * review catches whatever the clamp doesn't.
 */
export const MANDATE_CEILINGS = {
  maxPerTxnPaise: 5_000_00n,
  maxTotalPaise: 50_000_00n,
  maxDurationMs: 30 * 24 * 60 * 60 * 1000,
  maxMerchants: 20,
  maxCategories: 10,
} as const;

/** `mnd_` + 12 hex chars. Short enough to read aloud in a demo, long enough not to collide. */
export function newMandateId(): string {
  return `mnd_${randomBytes(6).toString("hex")}`;
}

/**
 * Canonical serialization — the exact bytes that get signed.
 *
 * Two rules make this stable, and both matter: keys are emitted in a fixed order (never
 * `Object.keys` order, which depends on insertion), and bigints become decimal strings
 * (JSON has no bigint, and a float would round). Arrays are sorted so that reordering the
 * merchant list cannot change the signature — the same authority must serialize the same
 * way every time or verification becomes a coin flip.
 */
export function canonicalize(terms: MandateTerms): string {
  const merchants = [...terms.merchants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, name: m.name, vpa: m.vpa }));

  const categories = [...terms.categories].sort();

  // Explicit field order. Do not reorder — it would invalidate every existing signature.
  const ordered = {
    v: 1,
    id: terms.id,
    userId: terms.userId,
    merchants,
    categories,
    perTxnCapPaise: terms.perTxnCapPaise.toString(),
    totalCapPaise: terms.totalCapPaise.toString(),
    velocityMax: terms.velocityMax,
    velocityWindowS: terms.velocityWindowS,
    expiresAt: terms.expiresAt,
  };

  return JSON.stringify(ordered);
}

function signingKey(): string {
  const key = process.env.MANDATE_SIGNING_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "MANDATE_SIGNING_KEY is missing or too short (need >= 16 chars). " +
        "Set it in .env — see .env.example.",
    );
  }
  return key;
}

/** HMAC-SHA256 over the canonical bytes, hex-encoded. */
export function signMandate(terms: MandateTerms): string {
  return createHmac("sha256", signingKey()).update(canonicalize(terms)).digest("hex");
}

/**
 * Constant-time signature check.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length is compared first and a
 * malformed signature returns false rather than blowing up the gateway.
 */
export function verifySignature(terms: MandateTerms, signature: string): boolean {
  if (!signature) return false;
  const expected = signMandate(terms);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Clamp a model-produced draft to the hard ceilings. Returns what was clamped, for the UI. */
export function clampDraft(draft: MandateDraft): {
  draft: MandateDraft;
  clamped: string[];
} {
  const clamped: string[] = [];
  const out: MandateDraft = { ...draft };

  if (out.perTxnCapPaise > MANDATE_CEILINGS.maxPerTxnPaise) {
    out.perTxnCapPaise = MANDATE_CEILINGS.maxPerTxnPaise;
    clamped.push("perTxnCapPaise");
  }
  if (out.totalCapPaise > MANDATE_CEILINGS.maxTotalPaise) {
    out.totalCapPaise = MANDATE_CEILINGS.maxTotalPaise;
    clamped.push("totalCapPaise");
  }
  // A per-transaction cap above the total cap is incoherent rather than dangerous,
  // but it produces a confusing review screen, so normalise it.
  if (out.perTxnCapPaise > out.totalCapPaise) {
    out.perTxnCapPaise = out.totalCapPaise;
    clamped.push("perTxnCapPaise");
  }
  if (out.merchants.length > MANDATE_CEILINGS.maxMerchants) {
    out.merchants = out.merchants.slice(0, MANDATE_CEILINGS.maxMerchants);
    clamped.push("merchants");
  }
  if (out.categories.length > MANDATE_CEILINGS.maxCategories) {
    out.categories = out.categories.slice(0, MANDATE_CEILINGS.maxCategories);
    clamped.push("categories");
  }

  const maxExpiry = Date.now() + MANDATE_CEILINGS.maxDurationMs;
  if (new Date(out.expiresAt).getTime() > maxExpiry) {
    out.expiresAt = new Date(maxExpiry).toISOString();
    clamped.push("expiresAt");
  }

  return { draft: out, clamped };
}

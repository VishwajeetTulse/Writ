import type { MandateTerms } from "../mandate";

/**
 * Writ's mandate, compiled to a UPI Autopay mandate.
 *
 * This is the part of the design that is not a metaphor. Razorpay's UPI Autopay
 * authorisation carries a token object shaped like this:
 *
 *     "token": { "max_amount": 200000, "expire_at": 2709971120, "frequency": "monthly" }
 *
 * A per-debit ceiling, an expiry, and a rate. That is a mandate, and it is the same
 * object Writ signs — which is the point worth making about this project: the primitive
 * was not invented here. NPCI already shipped it, Razorpay already exposes it, and the
 * open problem is that an AI buyer needs bounds finer than the rail can express.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAPS, AND WHAT WRIT HAS TO ENFORCE ITSELF
 * ---------------------------------------------------------------------------
 *
 *   perTxnCapPaise  ->  token.max_amount    The rail enforces this one.
 *   expiresAt       ->  token.expire_at     The rail enforces this one.
 *   velocity        ->  token.frequency     Lossy. See below.
 *
 *   totalCapPaise   ->  nothing             No UPI equivalent exists.
 *   merchants[]     ->  nothing             No UPI equivalent exists.
 *   categories[]    ->  nothing             No UPI equivalent exists.
 *
 * The three that do not map are why the policy engine exists. UPI Autopay can cap a
 * single debit and expire a mandate; it cannot say "at most ₹2,000 in total, only at
 * these two shops, only for groceries". An agent needs all six, so Writ enforces the
 * whole set before a purchase ever reaches the rail, and hands the rail the two bounds
 * it understands.
 *
 * `frequency` is the lossiest of the three. UPI's values are calendar-shaped — daily,
 * weekly, monthly, yearly, as_presented — and a shopping agent does not buy on a
 * calendar. `as_presented` is the honest choice: debit whenever presented, up to
 * `max_amount` each time. Writ's own "5 purchases per hour" is finer than anything the
 * enum can hold, so that bound also stays on this side of the wire.
 *
 * NOT WIRED UP END TO END. Creating the authorisation order is a real call and it is in
 * `client.ts`. Completing the mandate needs the customer to approve it once in a UPI
 * app, and charging against it afterwards needs Recurring Payments enabled on the
 * Razorpay account, which is granted on request rather than by default. See the README
 * for exactly how far this goes.
 */

/** The UPI Autopay frequency values Razorpay accepts. */
export type AutopayFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "as_presented";

export interface AutopayToken {
  /** Ceiling for a single debit, in paise. */
  max_amount: number;
  /** Mandate expiry, as unix seconds. */
  expire_at: number;
  frequency: AutopayFrequency;
}

/**
 * The bounds a UPI Autopay mandate can carry, taken from the signed terms.
 *
 * Pure and total: it reads the terms and returns the token, with no clock and no I/O,
 * so the same mandate always compiles to the same object and the mapping is testable
 * without touching Razorpay.
 */
export function toAutopayToken(terms: MandateTerms): AutopayToken {
  return {
    max_amount: Number(terms.perTxnCapPaise),
    // Unix seconds, floored. A mandate that expires mid-second expires at the start of
    // it rather than the end — erring toward less authority, not more.
    expire_at: Math.floor(new Date(terms.expiresAt).getTime() / 1000),
    // An agent buys when it needs to, not on a schedule. Every other value would
    // describe a subscription, which this is not.
    frequency: "as_presented",
  };
}

export interface UnmappedBound {
  bound: string;
  value: string;
  why: string;
}

/**
 * The bounds that have to stay on Writ's side of the wire, with the reason for each.
 *
 * Rendered on the mandate screen. A mapping that only showed what fits would overstate
 * how much of this the rail is doing.
 */
export function unmappedBounds(terms: MandateTerms): UnmappedBound[] {
  const out: UnmappedBound[] = [
    {
      bound: "Total budget",
      value: `${Number(terms.totalCapPaise) / 100} rupees`,
      why: "UPI Autopay caps each debit, never the sum of them.",
    },
    {
      bound: "Shops",
      value: terms.merchants.map((m) => m.name).join(", "),
      why: "A UPI mandate is held against one payee. It cannot carry an allowlist.",
    },
    {
      bound: "Kinds of item",
      value: terms.categories.join(", "),
      why: "The rail never sees what is in the basket.",
    },
  ];

  if (terms.velocityMax && terms.velocityWindowS) {
    out.push({
      bound: "Rate limit",
      value: `${terms.velocityMax} per ${terms.velocityWindowS}s`,
      why: "UPI frequency is calendar-shaped, so anything finer than daily is lost.",
    });
  }

  return out;
}

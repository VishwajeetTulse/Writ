import { prisma } from "./db";
import { issueMandate } from "./mandate-service";

/**
 * Sample mandates for a new account.
 *
 * The catalog is shared — it is a marketplace, and every merchant in it is visible to
 * everyone. Mandates are not: a mandate is one person's spending authority and belongs
 * to exactly one account. So this cannot live in `prisma/seed.ts`, which runs once
 * against the whole database. It runs per user, the first time they sign in.
 *
 * They are real mandates, signed with the same key and enforced by the same engine as
 * anything the user creates themselves. Nothing here is a mock.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const SAMPLES = [
  {
    intentText:
      "Weekly grocery and household top-up from FreshCart and DailyBasket. " +
      "Nothing over ₹700 at a time, ₹2,000 for the week.",
    merchants: ["mrc_freshcart", "mrc_dailybasket"],
    categories: ["grocery", "household"],
    perTxnCapPaise: 700_00n,
    totalCapPaise: 2000_00n,
    velocityMax: 5,
    velocityWindowS: 3600,
    expiresInMs: 7 * DAY,
  },
  {
    // Already lapsed, on purpose. It costs nothing and it means a new user can see what
    // an expired mandate looks like, and what happens when an agent tries to use one,
    // without having to wait a week for one of their own to run out.
    intentText: "Household supplies from HomeNeeds. One-day window, ₹500 total.",
    merchants: ["mrc_homeneeds"],
    categories: ["household"],
    perTxnCapPaise: 300_00n,
    totalCapPaise: 500_00n,
    velocityMax: null,
    velocityWindowS: null,
    expiresInMs: -2 * HOUR,
  },
];

export async function createSampleMandates(userId: string): Promise<string[]> {
  if (!process.env.MANDATE_SIGNING_KEY) {
    console.warn("MANDATE_SIGNING_KEY is not set — skipping sample mandates.");
    return [];
  }

  // Idempotent. Auth.js fires createUser once, but a retry or a re-run of this helper
  // should not quietly double someone's spending authority.
  const existing = await prisma.mandate.count({ where: { userId } });
  if (existing > 0) return [];

  const merchantRows = await prisma.merchant.findMany();
  const byId = new Map(merchantRows.map((m) => [m.id, m]));

  const created: string[] = [];

  for (const sample of SAMPLES) {
    const merchants = sample.merchants
      .map((id) => byId.get(id))
      .filter((m) => m !== undefined)
      .map((m) => ({ id: m.id, name: m.name, vpa: m.vpa }));

    // An empty catalog means the seed has not been run. A mandate that allows no
    // merchants would refuse everything and look broken, so skip it instead.
    if (merchants.length === 0) continue;

    const { id } = await issueMandate({
      userId,
      intentText: sample.intentText,
      draft: {
        merchants,
        categories: sample.categories,
        perTxnCapPaise: sample.perTxnCapPaise,
        totalCapPaise: sample.totalCapPaise,
        velocityMax: sample.velocityMax,
        velocityWindowS: sample.velocityWindowS,
        expiresAt: new Date(Date.now() + sample.expiresInMs).toISOString(),
        rationale: {},
      },
    });

    created.push(id);
  }

  return created;
}

import { z } from "zod";
import { listMandates, issueMandate } from "@/lib/mandate-service";
import { clampDraft, MANDATE_CEILINGS } from "@/lib/mandate";
import { listMerchants } from "@/lib/catalog";
import { requireApiUser } from "@/lib/session";

/**
 * Mandates, over HTTP.
 *
 * POST is the only way authority is created, and it always goes through `clampDraft`.
 * That matters because the drafting model will eventually be the thing calling it: a
 * model that hallucinates a fifty-lakh cap out of "keep it cheap" gets clamped by code
 * it has no access to, and the human review screen catches whatever the clamp does not.
 * The clamp runs here rather than in the UI so it cannot be skipped by calling the API
 * directly.
 */

export const dynamic = "force-dynamic";

const MerchantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vpa: z.string().min(1),
});

const IssueSchema = z.object({
  intentText: z.string().min(1).max(500),
  merchants: z.array(MerchantSchema).min(1).max(MANDATE_CEILINGS.maxMerchants),
  categories: z.array(z.string().min(1)).min(1).max(MANDATE_CEILINGS.maxCategories),
  // Rupees at the edge, paise everywhere inside. The conversion happens once, here.
  perTxnCapRupees: z.number().positive(),
  totalCapRupees: z.number().positive(),
  velocityMax: z.number().int().positive().nullable().optional(),
  velocityWindowS: z.number().int().positive().nullable().optional(),
  expiresAt: z.iso.datetime(),
});

export async function GET() {
  const { user, response } = await requireApiUser();
  if (response) return response;

  const [mandates, merchants] = await Promise.all([
    listMandates(user.id),
    listMerchants(),
  ]);

  return Response.json({
    mandates: mandates.map((m) => ({
      ...m,
      expiresAt: m.expiresAt.toISOString(),
      createdAt: m.createdAt.toISOString(),
    })),
    merchants,
    ceilings: MANDATE_CEILINGS,
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = IssueSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid mandate.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Clamped before signing, so the signature covers the clamped terms rather than the
  // terms that were asked for.
  const { draft, clamped } = clampDraft({
    merchants: input.merchants,
    categories: input.categories,
    perTxnCapPaise: BigInt(Math.round(input.perTxnCapRupees * 100)),
    totalCapPaise: BigInt(Math.round(input.totalCapRupees * 100)),
    velocityMax: input.velocityMax ?? null,
    velocityWindowS: input.velocityWindowS ?? null,
    expiresAt: input.expiresAt,
    rationale: {},
  });

  const issued = await issueMandate({
    userId: user.id,
    intentText: input.intentText,
    draft,
  });

  return Response.json(
    {
      id: issued.id,
      signature: issued.signature,
      terms: issued.terms,
      /** Non-empty when a server ceiling reduced something the caller asked for. */
      clamped,
    },
    { status: 201 },
  );
}

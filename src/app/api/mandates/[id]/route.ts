import { getMandateDetail } from "@/lib/mandate-service";

/**
 * One mandate, with its spend and its refusals.
 *
 * `signatureValid` is recomputed on every read rather than stored, so a mandate whose
 * terms were edited in the database reports as invalid here immediately.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/mandates/[id]">,
) {
  const { id } = await ctx.params;
  const detail = await getMandateDetail(id);

  if (!detail) {
    return Response.json({ error: "No such mandate." }, { status: 404 });
  }

  return Response.json({
    id: detail.row.id,
    intentText: detail.row.intentText,
    status: detail.status,
    signatureValid: detail.signatureValid,
    signature: detail.row.signature,
    terms: detail.terms,
    spentPaise: detail.spentPaise,
    remainingPaise: detail.remainingPaise,
    purchaseCount: detail.purchaseCount,
    blockCount: detail.blockCount,
    purchases: detail.purchases,
    refusals: detail.refusals,
  });
}

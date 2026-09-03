import { prisma } from "@/lib/db";
import { explainDecision } from "@/lib/explain";
import { parsePayload, violationsFrom } from "@/lib/format";
import type { Verdict } from "@/lib/policy";

/**
 * Explain one recorded decision.
 *
 * Track 1's bar asks that every money action be explainable. This endpoint is the
 * answer, and it reads from the ledger rather than recomputing anything: the sentence
 * it returns is rendered from the evidence that was recorded at the moment the decision
 * was made. An explanation therefore cannot drift from the decision it explains.
 *
 * `GET /api/explain?seq=42`
 *
 * The response carries the sentence, the machine facts it was built from, and the raw
 * reason code. The UI renders all three together on purpose — a paraphrase you cannot
 * check against the original is not an explanation, it is a claim.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const seqParam = new URL(request.url).searchParams.get("seq");
  const seq = Number(seqParam);

  if (!seqParam || !Number.isInteger(seq)) {
    return Response.json(
      { error: "A ledger sequence number is required: /api/explain?seq=42" },
      { status: 400 },
    );
  }

  const event = await prisma.auditEvent.findUnique({ where: { seq } });
  if (!event) {
    return Response.json({ error: "No such ledger event." }, { status: 404 });
  }

  const payload = parsePayload(event.payload);

  const explanation = explainDecision({
    verdict: (event.verdict as Verdict | null) ?? "ALLOW",
    reasonCode: event.reasonCode,
    evidence: payload,
    violations: violationsFrom(payload),
    productName: typeof payload.productName === "string" ? payload.productName : null,
    merchantName: typeof payload.merchantName === "string" ? payload.merchantName : null,
    latencyUs: event.latencyUs,
  });

  return Response.json({
    seq: event.seq,
    type: event.type,
    actor: event.actor,
    mandateId: event.mandateId,
    createdAt: event.createdAt.toISOString(),
    ...explanation,
    /**
     * Stated in the response, not just in the docs. The sentence above was rendered
     * from recorded arithmetic; no model was asked what it thought had happened.
     */
    generatedBy:
      "Rendered from the evidence recorded at decision time. No model was involved.",
  });
}

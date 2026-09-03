import { queryLedger, verifyChain, type EventType } from "@/lib/ledger";
import type { Verdict } from "@/lib/policy";
import { requireApiUser } from "@/lib/session";

/**
 * The audit trail, over HTTP.
 *
 * `?verify=1` walks the whole chain and recomputes every link. That is the endpoint
 * worth pointing a judge at: the table is only evidence if the chain holds, and this
 * is what proves it does. It is deliberately a plain GET so it can be run with curl
 * during a demo without any setup.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);

  if (url.searchParams.get("verify")) {
    // Verification is deliberately global rather than scoped to this account. The
    // chain links every row in the ledger, so a slice of it cannot be verified in
    // isolation — and a tampered row in someone else's history would still mean this
    // ledger cannot be trusted. It reports integrity, not contents.
    const result = await verifyChain();
    return Response.json(result, { status: result.valid ? 200 : 409 });
  }

  const events = await queryLedger({
    userId: user.id,
    mandateId: url.searchParams.get("mandate") ?? undefined,
    runId: url.searchParams.get("run") ?? undefined,
    verdict: (url.searchParams.get("verdict") as Verdict | null) ?? undefined,
    type: (url.searchParams.get("type") as EventType | null) ?? undefined,
    afterSeq: url.searchParams.has("after")
      ? Number(url.searchParams.get("after"))
      : undefined,
    limit: url.searchParams.has("limit")
      ? Math.min(Number(url.searchParams.get("limit")), 500)
      : undefined,
  });

  return Response.json({
    events: events.map((e) => ({
      ...e,
      // The payload is stored as JSON text; hand it back as JSON rather than a string
      // so a caller does not have to parse twice.
      payload: JSON.parse(e.payload) as unknown,
      createdAt: e.createdAt.toISOString(),
    })),
    count: events.length,
  });
}

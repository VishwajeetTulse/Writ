import { revokeMandate } from "@/lib/mandate-service";
import { requireApiUser } from "@/lib/session";

/**
 * Revoke a mandate.
 *
 * Worth being precise about what this endpoint does and does not do. It flips one
 * column and writes one ledger event. It sends nothing to the agent, cancels no
 * in-flight request, and has no notion of a run to interrupt.
 *
 * That is the entire point. The gateway loads mandate status fresh on every purchase
 * attempt and never caches it, so authority is checked at the moment it is used rather
 * than handed out at the start of a run. An agent that is mid-run loses its ability to
 * spend on its very next tool call, with no coordination between the two.
 */

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/mandates/[id]/revoke">,
) {
  const { user, response } = await requireApiUser();
  if (response) return response;

  const { id } = await ctx.params;
  const revoked = await revokeMandate(id, user.id);

  if (!revoked) {
    return Response.json(
      { error: "No such mandate, or it was already revoked." },
      { status: 409 },
    );
  }

  return Response.json({
    id,
    status: "REVOKED",
    effective: "immediately — checked on the next purchase attempt, not cached",
  });
}

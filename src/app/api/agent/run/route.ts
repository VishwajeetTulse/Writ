import { runScripted } from "@/lib/agent/scripted";
import { claudeAvailable, runClaude } from "@/lib/agent/claude";
import { geminiAvailable, runGemini } from "@/lib/agent/gemini";
import { sse, type RunEvent } from "@/lib/agent/events";
import { isChaosMode } from "@/lib/razorpay/chaos";
import { requireApiUser } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * A run, streamed.
 *
 * Server-sent events rather than a single JSON response, because the point of this
 * screen is the *sequence*: an attempt, then a verdict, then the runway moving. A run
 * that returns its whole history at the end shows the same facts and demonstrates
 * nothing about when the enforcement happened.
 *
 * The driver is chosen here and nowhere else, and it is the only thing about a run that
 * changes. `claude` is a real tool loop against a real model; `scripted` is a fixed
 * sequence that needs no key, no tokens and no network beyond Razorpay. Both emit the
 * same events, and every verdict on the screen is produced by the same gateway either
 * way — which is precisely the claim being made. The console labels which one ran.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (response) return response;

  let body: {
    mandateId?: string;
    goal?: string;
    chaos?: string | null;
    pauseForRevocation?: boolean;
    /** Tell the buyer its limits. Off by default; see buyer.ts. */
    briefed?: boolean;
    /** "auto" prefers whichever model is configured, Gemini first. */
    driver?: "auto" | "gemini" | "claude" | "scripted";
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { mandateId } = body;
  if (!mandateId) {
    return Response.json({ error: "mandateId is required." }, { status: 400 });
  }

  // Starting a run spends real money against a mandate, so the caller has to own it.
  const owned = await prisma.mandate.findFirst({
    where: { id: mandateId, userId: user.id },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "No such mandate." }, { status: 404 });
  }

  const goal = body.goal?.trim() || "Restock the weekly essentials.";
  const chaos = isChaosMode(body.chaos) ? body.chaos : null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: RunEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        const wanted = body.driver ?? "auto";

        // "auto" picks whatever is actually reachable, preferring Gemini because that is
        // the key this project is configured with. Asking for a driver whose credentials
        // are missing says so and falls back, rather than quietly running something else
        // and letting the label do the lying.
        const resolved =
          wanted === "auto"
            ? geminiAvailable()
              ? "gemini"
              : claudeAvailable()
                ? "claude"
                : "scripted"
            : wanted;

        const reachable =
          resolved === "gemini"
            ? geminiAvailable()
            : resolved === "claude"
              ? claudeAvailable()
              : true;

        if (!reachable) {
          emit({
            type: "note",
            tone: "warn",
            text:
              resolved === "gemini"
                ? "GEMINI_API_KEY is not set, so the Gemini buyer cannot run. Falling back to the scripted one."
                : "No Anthropic credentials are set, so the Claude buyer cannot run. Falling back to the scripted one.",
          });
        }

        const args = {
          mandateId,
          goal,
          chaos,
          pauseForRevocation: body.pauseForRevocation === true,
          briefed: body.briefed === true,
          emit,
        };

        if (reachable && resolved === "gemini") await runGemini(args);
        else if (reachable && resolved === "claude") await runClaude(args);
        else await runScripted(args);
      } catch (err) {
        // A run that dies mid-way still has to say so on the wire, or the console sits
        // there looking like it is thinking.
        emit({
          type: "note",
          tone: "warn",
          text: `Run failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Turbopack's dev proxy and most reverse proxies will otherwise buffer the
      // stream and deliver every event at once, which defeats the purpose.
      "X-Accel-Buffering": "no",
    },
  });
}

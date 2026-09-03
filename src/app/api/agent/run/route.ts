import { runScripted } from "@/lib/agent/scripted";
import { sse, type RunEvent } from "@/lib/agent/events";
import { isChaosMode } from "@/lib/razorpay/chaos";

/**
 * A run, streamed.
 *
 * Server-sent events rather than a single JSON response, because the point of this
 * screen is the *sequence*: an attempt, then a verdict, then the runway moving. A run
 * that returns its whole history at the end shows the same facts and demonstrates
 * nothing about when the enforcement happened.
 *
 * The driver is chosen here and nowhere else. `scripted` needs no model and no key,
 * which is what the console falls back to today; when an Anthropic key is present the
 * Claude tool loop will slot in behind the same stream.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    mandateId?: string;
    goal?: string;
    chaos?: string | null;
    pauseForRevocation?: boolean;
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
        await runScripted({
          mandateId,
          goal,
          chaos,
          pauseForRevocation: body.pauseForRevocation === true,
          emit,
        });
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

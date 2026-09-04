import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { MAX_TURNS, startBuyer, TOOL_SCHEMAS, type BuyerCtx } from "./buyer";

/**
 * The Claude buyer.
 *
 * The alternative driver to `gemini.ts`, kept because the argument this product makes is
 * that the gateway's verdicts do not depend on the buyer — and the cheapest way to keep
 * proving that is to be able to swap the buyer out.
 *
 * Everything that matters is shared: the tools, the system prompt, the run lifecycle and
 * the one function that can move money all live in `buyer.ts`. What is left here is the
 * shape of an Anthropic request and how a tool call is read back out of the response.
 */

/**
 * Two ways to reach the model, and the environment decides which.
 *
 * `ANTHROPIC_API_KEY` is the direct path. `GOOGLE_CLOUD_PROJECT` plus `CLOUD_ML_REGION`
 * routes the same requests through Claude on Vertex AI instead, which bills a GCP
 * account and authenticates with application default credentials rather than a key.
 * Everything this file asks for is supported on both, so nothing below changes.
 */
export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || vertexConfigured();
}

function vertexConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.CLOUD_ML_REGION);
}

/** Which surface a run will use. Reported on screen so the label is never a guess. */
export function claudeSurface(): "vertex" | "anthropic" | "none" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (vertexConfigured()) return "vertex";
  return "none";
}

function makeClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && vertexConfigured()) {
    return new AnthropicVertex({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      region: process.env.CLOUD_ML_REGION,
    }) as unknown as Anthropic;
  }
  return new Anthropic();
}

/**
 * The tools, in Anthropic's shape.
 *
 * `strict: true` guarantees the arguments validate against the schema, which requires
 * `additionalProperties: false`. That is added here rather than in `buyer.ts` because it
 * is a property of this API rather than of the tools themselves.
 */
const TOOLS: Anthropic.Tool[] = Object.entries(TOOL_SCHEMAS).map(([name, spec]) => ({
  name,
  description: spec.description,
  input_schema: {
    ...spec.parameters,
    additionalProperties: false,
  } as Anthropic.Tool.InputSchema,
  strict: true,
}));

export async function runClaude(ctx: BuyerCtx) {
  const session = await startBuyer(ctx, "claude");
  if (!session) return;

  const { emit } = ctx;

  if (claudeSurface() === "vertex") {
    emit({
      type: "note",
      text: `Reaching claude-opus-5 through Vertex AI on ${process.env.GOOGLE_CLOUD_PROJECT}.`,
    });
  }

  const client = makeClient();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: ctx.goal }];

  let turns = 0;

  try {
    while (turns < MAX_TURNS) {
      turns++;

      const response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        // Shopping from a few dozen catalog items is not a hard reasoning problem, and a
        // demo waiting on the model is a demo nobody watches.
        output_config: { effort: "medium" },
        system: session.systemPrompt,
        tools: TOOLS,
        messages,
      });

      // A safety decline is a real possible outcome here: the catalog deliberately
      // contains adversarial text. It is not a crash, and the run should say what
      // happened rather than fail silently.
      if (response.stop_reason === "refusal") {
        emit({
          type: "note",
          tone: "warn",
          text:
            "The model declined to continue" +
            (response.stop_details?.category
              ? ` (${response.stop_details.category})`
              : "") +
            ". Ending the run here.",
        });
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          emit({ type: "plan", text: block.text.trim() });
        }
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) break;

      // Every tool_result for one assistant turn goes back in a single user message.
      // Splitting them teaches the model to stop calling tools in parallel.
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const use of toolUses) {
        // Tool inputs are JSON the model produced. Read them as data, never by
        // string-matching the serialized form.
        const result = await session.call(
          use.name,
          (use.input ?? {}) as Record<string, unknown>,
        );
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: results });
    }

    if (turns >= MAX_TURNS) {
      emit({
        type: "note",
        tone: "warn",
        text: `Stopped the agent at its ${MAX_TURNS}-turn ceiling.`,
      });
    }
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Claude returned ${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    emit({ type: "note", tone: "warn", text: `The buyer stopped: ${message}` });
  }

  await session.finish();
}

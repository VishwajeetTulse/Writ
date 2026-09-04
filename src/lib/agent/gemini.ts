import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { MAX_TURNS, startBuyer, TOOL_SCHEMAS, type BuyerCtx } from "./buyer";

/**
 * The Gemini buyer.
 *
 * A real model, with real tools, shopping against a real mandate. Together with the
 * scripted buyer it makes the whole argument: the script proves the gateway's verdicts
 * do not depend on the buyer, and this proves they hold when the buyer is something
 * nobody wrote a script for.
 *
 * Everything that matters — the tools, the system prompt, the run lifecycle, the one
 * function that can move money — lives in `buyer.ts` and is shared with the Claude
 * driver. What is left here is the shape of a Gemini request and how a tool call is
 * read back out of the response. That split is deliberate: a purchase tool with two
 * implementations would eventually behave two ways.
 *
 * Two details worth knowing about this API. Tool results go back as a **user** turn
 * carrying `functionResponse` parts, not as their own role. And thinking parts arrive
 * in the same `parts` array as the reply, flagged with `thought`, so they are skipped —
 * a model's private reasoning is not narration, and putting it in the buyer pane would
 * misrepresent what the agent actually said.
 */

/**
 * The default model.
 *
 * The cheapest tier that reliably makes tool calls, which is all this loop needs. Change
 * it with one line in `.env`:
 *
 *     GEMINI_MODEL="gemini-3.8-flash"
 *
 * Measured on a real key by `npm run gemini:models`, which does not list models — it
 * makes an actual tool call against each candidate, because listing proves nothing.
 * `gemini-2.5-flash` appears in `models.list()` and then returns 404 on use, being
 * retired for new keys. Of the ones that answered: 3.1-flash-lite in 1.9s,
 * 3.6-flash in 2.9s, 3.5-flash-lite in 164s, and both 3.7 and 3.8 flash returning 503
 * for load. Re-run that script before recording anything — availability moves, and a
 * demo waiting on a model is a demo nobody watches.
 */
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

export function geminiAvailable(): boolean {
  return Boolean(apiKey());
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * The tools, declared in Gemini's shape.
 *
 * `parametersJsonSchema` takes plain JSON Schema, which is what `buyer.ts` already
 * holds, so the two drivers describe their tools from one source and cannot disagree
 * about what a tool accepts.
 */
const FUNCTION_DECLARATIONS: FunctionDeclaration[] = Object.entries(TOOL_SCHEMAS).map(
  ([name, spec]) => ({
    name,
    description: spec.description,
    parametersJsonSchema: spec.parameters,
  }),
);

/**
 * How many times to retry a turn that Google refused for load, and how long to wait.
 *
 * The free tier returns 503 "experiencing high demand" unpredictably — it happened
 * three times while this driver was being built, on three different models. That is not
 * a bug to fix, it is a property of the tier, and a demo that dies on it is a demo that
 * dies at random. Backoff is 1s, 2s, 4s: long enough to clear a spike, short enough
 * that nobody watching thinks the app has hung.
 */
const LOAD_RETRIES = 3;

function isTransient(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  // The SDK surfaces the API error as JSON in the message rather than as a typed status.
  return /"code":\s*(429|503|500)|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(text);
}

export async function runGemini(ctx: BuyerCtx) {
  const session = await startBuyer(ctx, "gemini");
  if (!session) return;

  const { emit } = ctx;
  const model = geminiModel();

  // Say which model is driving. It changes what the buyer pane is showing, and a screen
  // that hid it would be guessing.
  emit({ type: "note", text: `Buyer is ${model}.` });

  const ai = new GoogleGenAI({ apiKey: apiKey() });
  const contents: Content[] = [{ role: "user", parts: [{ text: ctx.goal }] }];

  let turns = 0;

  try {
    while (turns < MAX_TURNS) {
      turns++;

      let response;
      for (let attempt = 1; ; attempt++) {
        try {
          response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: session.systemPrompt,
              tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
            },
          });
          break;
        } catch (err) {
          if (!isTransient(err) || attempt > LOAD_RETRIES) throw err;
          const waitMs = 1000 * 2 ** (attempt - 1);
          emit({
            type: "note",
            tone: "warn",
            text:
              `${model} is busy. Waiting ${waitMs / 1000}s and trying again ` +
              `(${attempt} of ${LOAD_RETRIES}). Nothing was spent on this attempt.`,
          });
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }

      const reply = response.candidates?.[0]?.content;
      if (reply) contents.push(reply);

      for (const part of reply?.parts ?? []) {
        // `thought` marks the model's internal reasoning. It is not something the buyer
        // said, so it does not go in the pane that shows what the buyer said.
        if (part.thought) continue;
        const text = part.text?.trim();
        if (text) emit({ type: "plan", text });
      }

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) break;

      // Every result for one model turn goes back together, in a single user turn.
      const parts: Part[] = [];

      for (const call of calls) {
        const name = call.name ?? "";
        // Tool arguments are JSON the model produced. Read them as data, never by
        // string-matching a serialized form.
        const args = (call.args ?? {}) as Record<string, unknown>;
        const result = await session.call(name, args);

        parts.push({
          functionResponse: {
            // The Developer API often omits the id. Sending an empty one would be worse
            // than sending none, so it is only included when it exists.
            ...(call.id ? { id: call.id } : {}),
            name,
            response: result as Record<string, unknown>,
          },
        });
      }

      contents.push({ role: "user", parts });
    }

    if (turns >= MAX_TURNS) {
      emit({
        type: "note",
        tone: "warn",
        text: `Stopped the agent at its ${MAX_TURNS}-turn ceiling.`,
      });
    }
  } catch (err) {
    // A model or network failure should end the run honestly, not leave the console
    // waiting. Everything already decided is already in the ledger.
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "note", tone: "warn", text: `The buyer stopped: ${message}` });
  }

  await session.finish();
}

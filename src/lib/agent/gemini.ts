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
 * function that can move money — lives in `buyer.ts`, where the scripted buyer reaches
 * it too. What is left here is the shape of a Gemini request and how a tool call is
 * read back out of the response. That split is deliberate: the money path should not be
 * something a driver owns a copy of.
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
 * Chosen for consistency rather than for a good single sample. `npm run gemini:models`
 * does not list models — it makes a real tool call against each candidate and times it,
 * because listing proves nothing. Two runs an hour apart on the same key:
 *
 *     gemini-3.6-flash          2.9s   2.8s     <- the only one fast twice
 *     gemini-3.1-flash-lite     1.9s  20.5s
 *     gemini-3.7-flash          503    6.0s
 *     gemini-3.8-flash          503   59.3s
 *     gemini-3.5-flash-lite   164.0s  fetch failed
 *     gemini-3.1-pro-preview    n/a    429, quota
 *     gemini-2.5-flash          404 — listed, retired for new keys
 *
 * The free tier is that volatile, so a demo pinned to whatever was quickest once will
 * eventually stall on camera. Re-run the script before recording and set `GEMINI_MODEL`
 * if the numbers have moved:
 *
 *     GEMINI_MODEL="gemini-3.8-flash"
 */
const DEFAULT_MODEL = "gemini-3.6-flash";

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

/**
 * Models to fall through to when one stops answering.
 *
 * Google's free tier meters **20 requests per day, per model** — the 429 says so
 * outright: `limit: 20, model: gemini-3.6-flash`. One agent run costs a request per
 * turn, so two or three rehearsals exhaust a model for the day, and a demo pinned to a
 * single id will fail on camera at the worst possible moment.
 *
 * The quota is per model, so a chain multiplies it. Each entry answered a real tool call
 * during testing; the run moves down the list and says so on screen when it does. The
 * conversation carries over unchanged, because the history is the history regardless of
 * which model reads it next.
 */
const FALLBACK_CHAIN = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.8-flash",
];

/** Out of quota. Retrying the same model will not help; another model might. */
function isQuota(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|"code":\s*429/.test(text);
}

/** Busy rather than exhausted. Worth waiting for. */
function isBusy(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /UNAVAILABLE|"code":\s*(503|500)/.test(text);
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

  // The chosen model first, then anything else known to answer. Deduplicated so an
  // explicit GEMINI_MODEL is not tried twice.
  const chain = [model, ...FALLBACK_CHAIN.filter((m) => m !== model)];
  let modelIndex = 0;

  let turns = 0;

  try {
    while (turns < MAX_TURNS) {
      turns++;

      let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
      let lastError: unknown;

      // Walk the chain until something answers. A busy model is waited for; an
      // exhausted one is abandoned immediately, because burning three more requests
      // against a daily quota that is already spent only spends it harder.
      outer: while (modelIndex < chain.length) {
        const current = chain[modelIndex];

        for (let attempt = 1; ; attempt++) {
          try {
            response = await ai.models.generateContent({
              model: current,
              contents,
              config: {
                systemInstruction: session.systemPrompt,
                tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
              },
            });
            break outer;
          } catch (err) {
            lastError = err;
            if (isQuota(err)) break;
            if (!isBusy(err) || attempt > LOAD_RETRIES) break;

            const waitMs = 1000 * 2 ** (attempt - 1);
            emit({
              type: "note",
              tone: "warn",
              text:
                `${current} is busy. Waiting ${waitMs / 1000}s and trying again ` +
                `(${attempt} of ${LOAD_RETRIES}). Nothing was spent on this attempt.`,
            });
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }

        modelIndex++;
        if (modelIndex < chain.length) {
          emit({
            type: "note",
            tone: "warn",
            text:
              `${current} is ${isQuota(lastError) ? "out of free-tier quota" : "not answering"}. ` +
              `Continuing on ${chain[modelIndex]}.`,
          });
        }
      }

      if (!response) throw lastError;

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

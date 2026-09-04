import "dotenv/config";
import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";

/** Cheapest-first. A model that lists is not necessarily a model that answers. */
const CANDIDATES = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
];

const TOOL: FunctionDeclaration = {
  name: "search_catalog",
  description: "List products available to buy.",
  parametersJsonSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: [],
  },
};

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  console.log("Testing an actual tool call on each. A model that lists may still 404.\n");

  for (const model of CANDIDATES) {
    const started = Date.now();
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: "Find me some groceries." }] }],
        config: {
          systemInstruction: "You are a shopping agent. Use your tools.",
          tools: [{ functionDeclarations: [TOOL] }],
        },
      });
      const calls = res.functionCalls ?? [];
      const ms = Date.now() - started;
      console.log(
        `  ${model.padEnd(30)} OK   ${String(ms).padStart(5)}ms  ` +
          `${calls.length} tool call${calls.length === 1 ? "" : "s"}` +
          `${calls.length ? ` (${calls[0].name})` : " — answered in text only"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.match(/"code":\s*(\d+)/)?.[1] ?? "?";
      const reason = msg.match(/"message":\s*"([^"]{0,90})/)?.[1] ?? msg.slice(0, 90);
      console.log(`  ${model.padEnd(30)} FAIL ${code.padStart(5)}    ${reason}`);
    }
  }
}

main().catch((e) => console.error(e));

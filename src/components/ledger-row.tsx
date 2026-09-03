"use client";

import { useState } from "react";
import type { Explanation } from "@/lib/explain";
import { VerdictPill } from "@/components/verdict";
import type { Verdict } from "@/lib/policy";

/**
 * One ledger row, with its explanation on demand.
 *
 * The Explain affordance fetches `/api/explain?seq=…` rather than rendering the
 * sentence locally, even though it could. That is deliberate: the endpoint is the
 * thing that satisfies "every money action is explainable", and a UI that quietly
 * bypasses it would leave the claim resting on a code path nobody exercises.
 *
 * The expanded panel always shows the sentence, the arithmetic it was rendered from,
 * and the raw reason code together. A paraphrase you cannot check against the original
 * is a claim, not an explanation.
 */

export interface LedgerRowData {
  seq: number;
  time: string;
  actor: string;
  type: string;
  verdict: string | null;
  reasonCode: string | null;
  amount: string | null;
  latency: string | null;
  prevHash: string;
  hash: string;
  detail: string | null;
  extraViolations: number;
}

const ACTOR_TONE: Record<string, string> = {
  agent: "text-ink",
  policy: "text-ink",
  human: "text-ink",
  razorpay: "text-ink-mute",
  system: "text-ink-mute",
};

export function LedgerRow({ row }: { row: LedgerRowData }) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only decisions carry evidence worth rendering. Everything else is a fact about the
  // system, not a judgement about money.
  const explainable = row.verdict !== null;

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (explanation || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/explain?seq=${row.seq}`);
      if (!res.ok) {
        setError("Could not explain this row.");
        return;
      }
      setExplanation((await res.json()) as Explanation);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-b border-line/70 align-top hover:bg-ground/60">
        <td className="whitespace-nowrap px-3 py-2.5 pl-5 font-mono text-[11px] tnum text-ink-mute">
          {row.seq}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tnum text-ink-mute">
          {row.time}
        </td>
        <td
          className={`whitespace-nowrap px-3 py-2.5 font-mono text-[11px] ${
            ACTOR_TONE[row.actor] ?? "text-ink-mute"
          }`}
        >
          {row.actor}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">{row.type}</td>
        <td className="px-3 py-2.5">
          {row.verdict ? <VerdictPill verdict={row.verdict as Verdict} /> : null}
        </td>
        <td className="max-w-[300px] px-3 py-2.5">
          {row.reasonCode && (
            <div className="font-mono text-[11px] font-medium">{row.reasonCode}</div>
          )}
          {row.extraViolations > 0 && (
            <div className="font-mono text-[10px] text-deny">
              + {row.extraViolations} more bound{row.extraViolations === 1 ? "" : "s"} broken
            </div>
          )}
          {row.detail && (
            <div className="truncate text-[12px] text-ink-mute">{row.detail}</div>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] tnum">
          {row.amount ?? ""}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] tnum text-ink-mute">
          {row.latency ?? ""}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          {explainable && (
            <button
              onClick={toggle}
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-mute transition-colors hover:border-line-strong hover:text-ink"
            >
              {open ? "Hide" : "Explain"}
            </button>
          )}
        </td>
        <td
          className="whitespace-nowrap px-3 py-2.5 pr-5 font-mono text-[10px] text-ink-mute"
          title={`prev ${row.prevHash}\nthis ${row.hash}`}
        >
          {row.prevHash.slice(0, 4)}…{row.prevHash.slice(-3)}
          <span className="mx-1 text-line-strong">→</span>
          <span className="text-ink">
            {row.hash.slice(0, 4)}…{row.hash.slice(-3)}
          </span>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line/70 bg-ground/50">
          <td colSpan={10} className="px-5 py-4">
            {loading && <p className="text-[13px] text-ink-mute">Reading the evidence…</p>}
            {error && <p className="text-[13px] text-deny">{error}</p>}

            {explanation && (
              <div className="max-w-[92ch]">
                <p className="text-[14px] leading-relaxed">{explanation.text}</p>

                {explanation.facts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                    {explanation.facts.map((f) => (
                      <div key={f.label}>
                        <div className="eyebrow">{f.label}</div>
                        <div className="mt-0.5 font-mono text-[12px] tnum">{f.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-ink-mute">
                  Rendered from the evidence recorded at decision time. No model was
                  involved, so the sentence cannot say anything the arithmetic does not.
                  {explanation.reasonCode && (
                    <>
                      {" "}
                      Machine code:{" "}
                      <span className="font-mono text-ink">{explanation.reasonCode}</span>
                      {explanation.reasonLabel ? ` — ${explanation.reasonLabel}.` : "."}
                    </>
                  )}
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

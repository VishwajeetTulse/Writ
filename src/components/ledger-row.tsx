"use client";

import { useState } from "react";
import type { Explanation } from "@/lib/explain";
import { VerdictPill } from "@/components/verdict";
import { buttonClass } from "@/components/ui";
import type { Verdict } from "@/lib/policy";

/**
 * One ledger row, with its explanation on demand.
 *
 * The Explain affordance fetches `/api/explain?seq=…` rather than rendering the
 * sentence locally, even though it could. That is deliberate: the endpoint is the
 * thing that satisfies "every money action is explainable", and a UI that quietly
 * bypasses it would leave the claim resting on a code path nobody exercises.
 *
 * The sentence is set in the serif and the numbers behind it in mono, which is the
 * product's rule everywhere: the explanation is addressed to a reader, the evidence
 * under it was computed.
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

/** Who acted. The two that decide things are inked; the rest recede. */
const ACTOR_TONE: Record<string, string> = {
  agent: "text-ink",
  policy: "text-ink",
  human: "text-ink",
  razorpay: "text-ink-soft",
  system: "text-ink-soft",
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
        setError("This row could not be explained. It may have been filtered out.");
        return;
      }
      setExplanation((await res.json()) as Explanation);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const cell = "px-3 py-2 align-top";

  return (
    <>
      <tr
        className={`border-b border-hairline transition-colors ${
          open ? "bg-surface" : "hover:bg-surface"
        }`}
      >
        <td className={`${cell} whitespace-nowrap pl-4 font-mono text-micro tnum text-ink-soft`}>
          {row.seq}
        </td>
        <td className={`${cell} whitespace-nowrap font-mono text-micro tnum text-ink-mute`}>
          {row.time}
        </td>
        <td
          className={`${cell} whitespace-nowrap font-mono text-micro ${
            ACTOR_TONE[row.actor] ?? "text-ink-soft"
          }`}
        >
          {row.actor}
        </td>
        <td className={`${cell} whitespace-nowrap font-mono text-micro`}>{row.type}</td>
        <td className={cell}>
          {row.verdict ? <VerdictPill verdict={row.verdict as Verdict} /> : null}
        </td>
        <td className={`${cell} max-w-[280px]`}>
          {row.reasonCode && (
            <div className="font-mono text-micro font-medium">{row.reasonCode}</div>
          )}
          {row.extraViolations > 0 && (
            <div className="font-mono text-nano text-deny">
              +{row.extraViolations} more bound{row.extraViolations === 1 ? "" : "s"} broken
            </div>
          )}
          {row.detail && (
            <div className="truncate text-small text-ink-mute">{row.detail}</div>
          )}
        </td>
        <td className={`${cell} whitespace-nowrap text-right font-mono text-micro tnum`}>
          {row.amount ?? ""}
        </td>
        <td
          className={`${cell} whitespace-nowrap text-right font-mono text-micro tnum text-ink-soft`}
        >
          {row.latency ?? ""}
        </td>
        <td className={`${cell} whitespace-nowrap text-right`}>
          {explainable && (
            <button
              onClick={toggle}
              aria-expanded={open}
              className={buttonClass("secondary", "sm")}
            >
              {open ? "Hide" : "Explain"}
            </button>
          )}
        </td>
        <td
          className={`${cell} whitespace-nowrap pr-4 font-mono text-nano text-ink-soft`}
          title={`previous ${row.prevHash}\nthis     ${row.hash}`}
        >
          {row.prevHash.slice(0, 4)}…{row.prevHash.slice(-3)}
          <span aria-hidden className="mx-1 text-line-strong">
            →
          </span>
          <span className="text-ink">
            {row.hash.slice(0, 4)}…{row.hash.slice(-3)}
          </span>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-hairline bg-sunk">
          <td colSpan={10} className="px-4 py-4">
            {loading && <ExplanationSkeleton />}

            {error && <p className="text-ui text-deny">{error}</p>}

            {explanation && (
              <div className="max-w-[88ch]">
                <p className="human text-lede leading-[1.6]">{explanation.text}</p>

                {explanation.facts.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                    {explanation.facts.map((f) => (
                      <div key={f.label}>
                        <div className="eyebrow">{f.label}</div>
                        <div className="mt-1 font-mono text-small tnum">{f.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The shape of the answer, held while it loads.
 *
 * A skeleton rather than a spinner: the row is about to fill with a sentence and a set
 * of figures, and showing that shape means the layout does not jump when it arrives.
 */
function ExplanationSkeleton() {
  return (
    <div className="max-w-[88ch] animate-pulse" aria-live="polite" aria-busy="true">
      <span className="sr-only">Reading the evidence.</span>
      <div className="h-4 w-[72%] rounded-xs bg-line" />
      <div className="mt-2 h-4 w-[46%] rounded-xs bg-line" />
      <div className="mt-5 flex gap-8">
        <div className="h-6 w-24 rounded-xs bg-line/70" />
        <div className="h-6 w-24 rounded-xs bg-line/70" />
        <div className="h-6 w-20 rounded-xs bg-line/70" />
      </div>
    </div>
  );
}

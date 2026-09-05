"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RunEvent } from "@/lib/agent/events";
import { formatPaise } from "@/lib/money";
import { Runway } from "@/components/runway";
import { VerdictPill } from "@/components/verdict";
import { explainDecision } from "@/lib/explain";
import {
  Button,
  buttonClass,
  controlClass,
  inputClass,
  linkClass,
  Panel,
  PanelHead,
} from "@/components/ui";

/**
 * The run console.
 *
 * Two panes, and the split is the argument. On the left is what the buyer did — its
 * reasoning, its choices, the text it read. On the right is what the gateway decided.
 * Nothing crosses from left to right except a SKU and a quantity; the amount, the
 * merchant, the category and the verdict are all derived on the right from data the
 * left-hand side cannot write.
 *
 * The two panes are set in different typefaces, and that is the fastest way to read
 * this screen. The buyer speaks in the serif, because everything it says is a claim.
 * The gateway answers in mono, because everything it returns is a computed value. You
 * can tell which side of the wire you are looking at without reading a word.
 *
 * The runway sits above both because it is the only thing in the room that is true
 * regardless of which pane you believe.
 */

export interface RunMandate {
  id: string;
  intentText: string;
  status: string;
  totalCapPaise: number;
  spentPaise: number;
}

interface AttemptRow {
  key: string;
  sku: string;
  productName: string;
  merchantName: string;
  amountPaise: number;
  decision?: Extract<RunEvent, { type: "decision" }>;
}

interface Narration {
  key: string;
  kind: "plan" | "note";
  text: string;
  tone?: "plain" | "warn";
}

/**
 * Explain one decision, inline, with no round trip.
 *
 * `explainDecision` is a pure function over recorded evidence, so it runs in the browser
 * and produces exactly the sentence `/api/explain` would return for the same decision.
 * The ledger screen deliberately goes through the endpoint instead; here, during a live
 * run, an instant answer matters more than exercising the route.
 */
function DecisionExplanation({
  decision,
}: {
  decision: Extract<RunEvent, { type: "decision" }>;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={`mt-2.5 ${buttonClass("secondary", "sm")}`}
      >
        Explain
      </button>
    );
  }

  const explanation = explainDecision({
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    evidence: (decision.violations[0]?.evidence ?? {}) as Record<string, unknown>,
    violations: decision.violations,
    productName: decision.productName,
    latencyUs: decision.latencyUs,
  });

  return (
    <div className="mt-2.5 rounded-sm border border-hairline bg-sunk px-3 py-2.5">
      <p className="human text-lede leading-[1.55]">{explanation.text}</p>

      {explanation.facts.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
          {explanation.facts.map((f) => (
            <div key={f.label}>
              <div className="eyebrow">{f.label}</div>
              <div className="mt-1 font-mono text-micro tnum">{f.value}</div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setOpen(false)}
        aria-expanded
        className={`mt-2.5 text-micro text-ink-mute ${linkClass}`}
      >
        Hide
      </button>
    </div>
  );
}

type Driver = "gemini" | "scripted";

export function RunConsole({
  mandates,
  geminiReady,
}: {
  mandates: RunMandate[];
  /** Whether a model key is configured on the server. */
  geminiReady: boolean;
}) {
  const active = mandates.filter((m) => m.status === "ACTIVE");
  const [mandateId, setMandateId] = useState(active[0]?.id ?? mandates[0]?.id ?? "");
  const [goal, setGoal] = useState(
    "Restock the weekly essentials. I have also been wanting a TV for the living " +
      "room, so have a look at what is available and get one if it is any good.",
  );
  /** Off by default: an agent that already knows the limits proves nothing. */
  const [briefed, setBriefed] = useState(false);
  const driver: Driver = geminiReady ? "gemini" : "scripted";
  const [chaos, setChaos] = useState(false);
  const [pauseForRevocation, setPauseForRevocation] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [narration, setNarration] = useState<Narration[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [spend, setSpend] = useState<{ spent: number; cap: number } | null>(null);
  const [ended, setEnded] = useState<Extract<RunEvent, { type: "run_ended" }> | null>(
    null,
  );

  const selected = mandates.find((m) => m.id === mandateId);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Follow the tail of both panes as events land, so the newest line is always the one
  // on screen without anyone having to scroll during a demo.
  useEffect(() => {
    leftRef.current?.scrollTo({ top: leftRef.current.scrollHeight, behavior: "smooth" });
  }, [narration]);
  useEffect(() => {
    rightRef.current?.scrollTo({ top: rightRef.current.scrollHeight, behavior: "smooth" });
  }, [attempts]);

  // The last refusal breaches the wall on the runway. The largest one is chosen rather
  // than the most recent, because the biggest thing this mandate stopped is the fact
  // worth keeping on screen.
  const worstBlock = attempts
    .filter((a) => a.decision && a.decision.verdict !== "ALLOW")
    .reduce<AttemptRow | null>(
      (max, a) => (!max || a.amountPaise > max.amountPaise ? a : max),
      null,
    );

  async function run() {
    if (!mandateId) return;

    setRunning(true);
    setNarration([]);
    setAttempts([]);
    setEnded(null);
    setRunId(null);
    setRevoked(false);
    setSpend({ spent: selected?.spentPaise ?? 0, cap: selected?.totalCapPaise ?? 0 });

    let seq = 0;

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mandateId,
          goal,
          chaos: chaos ? "razorpay_timeout" : null,
          pauseForRevocation,
          driver,
          briefed,
        }),
      });

      if (!res.body) throw new Error("No stream returned.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;

          let event: RunEvent;
          try {
            event = JSON.parse(line.slice(6)) as RunEvent;
          } catch {
            continue;
          }

          seq++;
          apply(event, seq);
        }
      }
    } catch (err) {
      setNarration((n) => [
        ...n,
        {
          key: `err_${Date.now()}`,
          kind: "note",
          tone: "warn",
          text: err instanceof Error ? err.message : "The run could not be started.",
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  /**
   * Revoke while the run is still going.
   *
   * Nothing here talks to the run. It posts to the same endpoint the mandate screen
   * uses, which flips one column. The run finds out the way anything else would: by
   * asking the gateway for permission and being told no.
   */
  async function revokeNow() {
    if (!mandateId) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/mandates/${mandateId}/revoke`, { method: "POST" });
      if (res.ok) setRevoked(true);
    } finally {
      setRevoking(false);
    }
  }

  function apply(event: RunEvent, seq: number) {
    switch (event.type) {
      case "run_started":
        setRunId(event.runId);
        break;

      case "plan":
        setNarration((n) => [...n, { key: `p${seq}`, kind: "plan", text: event.text }]);
        break;

      case "note":
        setNarration((n) => [
          ...n,
          { key: `n${seq}`, kind: "note", text: event.text, tone: event.tone },
        ]);
        break;

      case "attempt":
        setAttempts((a) => [
          ...a,
          {
            key: `a${seq}`,
            sku: event.sku,
            productName: event.productName,
            merchantName: event.merchantName,
            amountPaise: event.amountPaise,
          },
        ]);
        break;

      case "decision":
        setAttempts((a) => {
          const next = [...a];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].sku === event.sku && !next[i].decision) {
              next[i] = { ...next[i], amountPaise: event.amountPaise, decision: event };
              break;
            }
          }
          return next;
        });
        break;

      case "spend":
        setSpend({ spent: event.spentPaise, cap: event.capPaise });
        break;

      case "run_ended":
        setEnded(event);
        break;
    }
  }

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------- controls */}
      <div className="border-b border-line pb-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_auto] lg:items-end">
          <div>
            <label htmlFor="run-mandate" className="eyebrow mb-2 block">
              Mandate
            </label>
            <select
              id="run-mandate"
              value={mandateId}
              onChange={(e) => setMandateId(e.target.value)}
              disabled={running}
              className={`${controlClass} h-[34px] font-mono`}
            >
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="run-goal" className="eyebrow mb-2 block">
              What the buyer is asked to do
            </label>
            <input
              id="run-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={running}
              className={inputClass}
            />
          </div>

          <div className="flex items-end gap-2">
            <Button
              size="lg"
              variant="primary"
              onClick={run}
              disabled={running || !mandateId}
            >
              {running ? "Running…" : "Run"}
            </Button>

            {running && !revoked && (
              <Button size="lg" variant="danger-quiet" onClick={revokeNow} disabled={revoking}>
                {revoking ? "Withdrawing…" : "Withdraw now"}
              </Button>
            )}

            {revoked && (
              <span className="inline-flex h-[42px] items-center rounded-xs border border-deny/25 bg-deny-wash px-3 font-mono text-micro font-medium uppercase tracking-[0.07em] text-deny">
                withdrawn
              </span>
            )}
          </div>
        </div>

        {/* The two switches below change what the demo does, not what the product is.
            Labelling them as such is the difference between a demo and a trick. */}
        <div
          role="group"
          aria-label="Demo conditions"
          className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          <span className="eyebrow">Demo conditions</span>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={briefed}
              onChange={(e) => setBriefed(e.target.checked)}
              disabled={running}
              className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            />
            <span className="text-ui text-ink-mute">
              Tell the buyer its limits
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={chaos}
              onChange={(e) => setChaos(e.target.checked)}
              disabled={running}
              className="h-3.5 w-3.5 accent-[var(--color-hold)]"
            />
            <span className="text-ui text-ink-mute">
              Make Razorpay time out once, to show the retry
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={pauseForRevocation}
              onChange={(e) => setPauseForRevocation(e.target.checked)}
              disabled={running}
              className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            />
            <span className="text-ui text-ink-mute">
              Hold mid-run, so there is time to withdraw
            </span>
          </label>
        </div>

        {selected && selected.status !== "ACTIVE" && (
          <p className="mt-4 rounded-sm border border-hold/25 bg-hold-wash px-3 py-2 text-ui text-hold">
            This mandate is {selected.status.toLowerCase()}. Every attempt will be refused.
          </p>
        )}
      </div>

      {/* -------------------------------------------------------------- runway */}
      <Runway
        capPaise={spend?.cap ?? selected?.totalCapPaise ?? 0}
        spentPaise={spend?.spent ?? selected?.spentPaise ?? 0}
        blockedPaise={worstBlock?.amountPaise ?? null}
        blockedLabel={worstBlock ? `${worstBlock.productName} refused` : null}
      />

      {/* ----------------------------------------------------------- the panes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel pad={false} className="flex h-[460px] flex-col lg:h-[540px]">
          <PanelHead title="Buyer" />

          <div ref={leftRef} className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
            {narration.length === 0 && (
              <p className="human px-2 pt-14 text-center text-lede text-ink-soft">
                What the buyer says appears here.
              </p>
            )}
            {narration.map((n) => (
              <p
                key={n.key}
                className={`human text-lede leading-[1.6] ${
                  n.kind === "plan"
                    ? "text-ink"
                    : n.tone === "warn"
                      ? "rounded-sm border border-hold/25 bg-hold-wash px-3 py-2 text-hold"
                      : "border-l-2 border-line pl-3 text-ink-mute"
                }`}
              >
                {n.text}
              </p>
            ))}
          </div>
        </Panel>

        <Panel pad={false} className="flex h-[460px] flex-col lg:h-[540px]">
          <PanelHead
            title="Gateway"
            aside={
              <span className="font-mono text-nano text-ink-soft">{runId ?? "idle"}</span>
            }
          />

          <div ref={rightRef} className="flex-1 overflow-y-auto">
            {attempts.length === 0 ? (
              <p className="px-6 pt-14 text-center text-ui text-ink-soft">
                Verdicts appear here.
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {attempts.map((a) => (
                  <li key={a.key} className="px-4 py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-body">{a.productName}</span>
                      <span className="shrink-0 font-mono text-body tnum">
                        {formatPaise(BigInt(Math.round(a.amountPaise)))}
                      </span>
                    </div>

                    <div className="mt-0.5 truncate font-mono text-nano text-ink-soft">
                      {a.merchantName} · {a.sku}
                    </div>

                    {a.decision ? (
                      <>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <VerdictPill verdict={a.decision.verdict} />
                          {a.decision.reasonCode && (
                            <span className="font-mono text-micro font-medium">
                              {a.decision.reasonCode}
                            </span>
                          )}
                          <span className="ml-auto font-mono text-nano tnum text-ink-soft">
                            {(a.decision.latencyUs / 1000).toFixed(2)}ms
                          </span>
                        </div>

                        {a.decision.violations.length > 1 && (
                          <div className="mt-2 rounded-sm border border-deny/20 bg-deny-wash px-2.5 py-2">
                            <span className="font-mono text-nano uppercase tracking-[0.07em] text-deny">
                              {a.decision.violations.length} bounds broken at once
                            </span>
                            <div className="mt-1.5 font-mono text-nano leading-relaxed text-deny">
                              {a.decision.violations.map((v) => v.reasonCode).join("  ·  ")}
                            </div>
                          </div>
                        )}

                        <DecisionExplanation decision={a.decision} />

                        {a.decision.recovered && (
                          <div className="mt-2 rounded-sm border border-hold/25 bg-hold-wash px-2.5 py-2 text-micro text-hold">
                            Razorpay failed ({a.decision.recovered.failure}). Retried, one
                            order.
                          </div>
                        )}

                        {a.decision.razorpayOrderId && (
                          <div className="mt-2 font-mono text-nano text-ink-soft">
                            {a.decision.razorpayOrderId}
                            {a.decision.paymentLinkUrl && (
                              <>
                                {" · "}
                                <a
                                  href={a.decision.paymentLinkUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`text-ink ${linkClass}`}
                                >
                                  payment link
                                </a>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-2 font-mono text-nano uppercase tracking-[0.07em] text-ink-soft">
                        deciding…
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {ended && (
            <div className="flex items-center gap-4 border-t border-hairline bg-sunk px-4 py-2.5 font-mono text-micro tnum">
              <span className="text-permit">{ended.summary.allowed} allowed</span>
              <span className="text-deny">{ended.summary.blocked} refused</span>
              <span className="text-ink-mute">
                {formatPaise(BigInt(Math.round(ended.summary.spentPaise)))} spent
              </span>
              {runId && (
                <Link href={`/ledger?mandate=${mandateId}`} className={`ml-auto ${linkClass}`}>
                  See the trail
                </Link>
              )}
            </div>
          )}
        </Panel>
      </div>

    </div>
  );
}

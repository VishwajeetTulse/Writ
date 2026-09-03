"use client";

import { useState } from "react";

interface Verification {
  valid: boolean;
  recordCount: number;
  brokenAtSeq?: number;
  reason?: string;
}

/**
 * Verify the chain, on demand, in front of whoever is watching.
 *
 * The result is deliberately not precomputed and cached. The whole claim is "you can
 * check this yourself right now", and a number rendered at build time proves nothing.
 * It recomputes every hash from the first row forward, so an edited payload, a changed
 * verdict, a deleted row and a reordered row all surface as the same failure: the first
 * sequence number where the link stops holding.
 */
export function VerifyChain({ recordCount }: { recordCount: number }) {
  const [result, setResult] = useState<Verification | null>(null);
  const [running, setRunning] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  async function verify() {
    setRunning(true);
    setResult(null);
    const started = performance.now();
    try {
      const res = await fetch("/api/ledger?verify=1");
      const body = (await res.json()) as Verification;
      setMs(Math.round(performance.now() - started));
      setResult(body);
    } catch {
      setResult({ valid: false, recordCount, reason: "Could not reach the server." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] ${
              result.valid
                ? "border-permit/25 bg-permit-wash text-permit"
                : "border-deny/25 bg-deny-wash text-deny"
            }`}
          >
            {result.valid ? "chain intact" : "chain broken"}
          </span>
          <span className="font-mono text-[11px] tnum text-ink-mute">
            {result.valid
              ? `${result.recordCount} records · ${ms}ms`
              : `broke at seq ${result.brokenAtSeq ?? "?"}`}
          </span>
        </div>
      )}

      <button
        onClick={verify}
        disabled={running}
        className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] transition-colors hover:border-line-strong disabled:opacity-60"
      >
        {running ? "Verifying…" : "Verify chain"}
      </button>
    </div>
  );
}

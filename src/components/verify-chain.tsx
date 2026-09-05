"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

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
 *
 * The record count comes back and is not shown. The chain spans every account, so the
 * number is always larger than the table under this button, and two disagreeing counts
 * next to each other read as a discrepancy rather than as two different things.
 */
export function VerifyChain() {
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
      setResult({ valid: false, recordCount: 0, reason: "Could not reach the server." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <div className="flex items-center gap-2" role="status">
          <span
            className={`inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-nano font-medium uppercase tracking-[0.07em] ${
              result.valid
                ? "border-permit/25 bg-permit-wash text-permit"
                : "border-deny/25 bg-deny-wash text-deny"
            }`}
          >
            {result.valid ? "chain intact" : "chain broken"}
          </span>
          <span className="font-mono text-micro tnum text-ink-soft">
            {result.valid
              ? `${ms}ms`
              : (result.reason ?? `broke at seq ${result.brokenAtSeq ?? "?"}`)}
          </span>
        </div>
      )}

      <Button onClick={verify} disabled={running} variant="secondary">
        {running ? "Verifying…" : "Verify chain"}
      </Button>
    </div>
  );
}

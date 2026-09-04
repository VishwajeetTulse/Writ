"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";

/**
 * Revocation.
 *
 * There is no "pending" state to render and nothing to propagate, because the gateway
 * reads mandate status fresh on every purchase attempt. Flipping the row *is* the whole
 * mechanism — an agent mid-run loses its authority on its next tool call, not at the
 * end of the run. The confirmation step exists because it is irreversible, not because
 * it is slow, and the consequence is spelled out in the confirmation rather than left
 * to a colour.
 */
export function RevokeButton({ mandateId }: { mandateId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function revoke() {
    setError(null);
    const res = await fetch(`/api/mandates/${mandateId}/revoke`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "The mandate could not be withdrawn. Try again.");
      return;
    }
    setConfirming(false);
    startTransition(() => router.refresh());
  }

  if (!confirming) {
    return (
      <Button variant="danger-quiet" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-small text-ink-mute">
        Takes effect on the agent&rsquo;s next request. Cannot be undone.
      </span>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
      <Button variant="danger" onClick={revoke} disabled={pending}>
        {pending ? "Withdrawing…" : "Withdraw now"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-right text-small text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

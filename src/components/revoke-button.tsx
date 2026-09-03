"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Revocation.
 *
 * There is no "pending" state to render and nothing to propagate, because the gateway
 * reads mandate status fresh on every purchase attempt. Flipping the row *is* the whole
 * mechanism — an agent mid-run loses its authority on its next tool call, not at the
 * end of the run. The confirmation step exists because it is irreversible, not because
 * it is slow.
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
      setError(body.error ?? "Revocation failed.");
      return;
    }
    setConfirming(false);
    startTransition(() => router.refresh());
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-deny hover:text-deny"
      >
        Revoke
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[12px] text-deny">{error}</span>}
      <span className="text-[12px] text-ink-mute">Cannot be undone.</span>
      <button
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-mute"
      >
        Cancel
      </button>
      <button
        onClick={revoke}
        disabled={pending}
        className="rounded-md bg-deny px-3 py-1.5 text-[13px] font-medium text-surface disabled:opacity-60"
      >
        {pending ? "Revoking…" : "Revoke now"}
      </button>
    </div>
  );
}

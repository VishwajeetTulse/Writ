import { REASON_LABELS, type ReasonCode, type Verdict } from "@/lib/policy";

/**
 * Verdicts and reason codes, rendered the same way everywhere.
 *
 * Two rules, and they are the whole reason this is a component rather than inline
 * markup. First: a reason code is always shown as the code itself, in mono, never
 * softened into prose alone. `PER_TXN_CAP_EXCEEDED` is a value from a closed enum that
 * an evaluation suite scores and a ledger filters on; the sentence underneath is a
 * courtesy, not the fact. Second: these three colours mean a decision and nothing else,
 * so they never appear as decoration anywhere in the console.
 */

const VERDICT_STYLE: Record<Verdict, string> = {
  ALLOW: "border-permit/25 bg-permit-wash text-permit",
  BLOCK: "border-deny/25 bg-deny-wash text-deny",
  ESCALATE: "border-hold/25 bg-hold-wash text-hold",
};

export function VerdictPill({
  verdict,
  size = "sm",
}: {
  verdict: Verdict;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={`inline-flex items-center rounded border font-mono font-medium uppercase tracking-[0.06em] ${
        VERDICT_STYLE[verdict]
      } ${size === "lg" ? "px-2.5 py-1 text-[12px]" : "px-1.5 py-0.5 text-[10px]"}`}
    >
      {verdict}
    </span>
  );
}

/** The machine-readable refusal, with its human gloss as a title and optional caption. */
export function ReasonChip({
  code,
  withLabel = false,
}: {
  code: ReasonCode | string;
  withLabel?: boolean;
}) {
  const label = REASON_LABELS[code as ReasonCode];

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        title={label ?? code}
        className="font-mono text-[11px] font-medium tracking-[0.02em] text-ink"
      >
        {code}
      </span>
      {withLabel && label && (
        <span className="text-[12px] leading-snug text-ink-mute">{label}</span>
      )}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-permit/25 bg-permit-wash text-permit",
  REVOKED: "border-deny/25 bg-deny-wash text-deny",
  EXPIRED: "border-line-strong bg-ground text-ink-mute",
  EXHAUSTED: "border-hold/25 bg-hold-wash text-hold",
  DRAFT: "border-line-strong bg-ground text-ink-mute",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] ${
        STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT
      }`}
    >
      {status}
    </span>
  );
}

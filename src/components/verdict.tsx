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
      className={`inline-flex items-center rounded-xs border font-mono font-medium uppercase tracking-[0.07em] ${
        VERDICT_STYLE[verdict]
      } ${size === "lg" ? "px-2 py-1 text-micro" : "px-1.5 py-0.5 text-nano"}`}
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
        className="font-mono text-micro font-medium tracking-[0.01em] text-ink"
      >
        {code}
      </span>
      {withLabel && label && (
        <span className="text-small leading-snug text-ink-mute">{label}</span>
      )}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-permit/25 bg-permit-wash text-permit",
  REVOKED: "border-deny/25 bg-deny-wash text-deny",
  EXPIRED: "border-line-strong bg-sunk text-ink-mute",
  EXHAUSTED: "border-hold/25 bg-hold-wash text-hold",
  DRAFT: "border-line-strong bg-sunk text-ink-mute",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-nano font-medium uppercase tracking-[0.07em] ${
        STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT
      }`}
    >
      {status}
    </span>
  );
}

/**
 * A signed-or-not seal. The load-bearing claim on the mandate screen: it says whether
 * the terms being displayed are the terms someone actually agreed to.
 */
export function SignatureSeal({ valid }: { valid: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-nano font-medium uppercase tracking-[0.07em] ${
        valid
          ? "border-permit/25 bg-permit-wash text-permit"
          : "border-deny/25 bg-deny-wash text-deny"
      }`}
    >
      {valid ? "signature valid" : "signature invalid"}
    </span>
  );
}

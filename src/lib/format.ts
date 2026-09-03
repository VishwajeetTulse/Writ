/**
 * Display formatting. Pure, and shared by both sides of the server/client boundary.
 *
 * Times are rendered server-side into plain strings rather than computed live in the
 * browser, which keeps them out of hydration's way — a clock that ticks between the
 * server render and the client render is a mismatch warning nobody needs mid-demo.
 */

/** "in 6h" / "4m ago". Coarse on purpose: exact timestamps live in the ledger. */
export function relativeTime(then: Date, now: Date = new Date()): string {
  const ms = then.getTime() - now.getTime();
  const future = ms > 0;
  const abs = Math.abs(ms);

  const units: Array<[number, string]> = [
    [1000, "s"],
    [60_000, "m"],
    [3_600_000, "h"],
    [86_400_000, "d"],
  ];

  let value = Math.round(abs / 1000);
  let unit = "s";
  for (const [scale, label] of units) {
    if (abs >= scale) {
      value = Math.floor(abs / scale);
      unit = label;
    }
  }

  if (abs < 1000) return "just now";
  return future ? `in ${value}${unit}` : `${value}${unit} ago`;
}

/** "3 Sep, 14:22:07" — fixed locale so the demo machine's settings cannot change it. */
export function timestamp(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/** First and last few characters of a hash: "a3f19c…8b2d". */
export function truncateHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** "3 per 60s" for a velocity limit, or null when the mandate sets none. */
export function velocityLabel(max: number | null, windowS: number | null): string | null {
  if (!max || !windowS) return null;
  return `${max} per ${windowS}s`;
}

/** Audit payloads are stored as JSON text. Never let a malformed one break a screen. */
export function parsePayload(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface ViolationView {
  reasonCode: string;
  evidence: Record<string, unknown>;
}

/** Pull the violation list out of a POLICY_DECISION payload. */
export function violationsFrom(payload: Record<string, unknown>): ViolationView[] {
  const raw = payload.violations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const obj = v as Record<string, unknown>;
    if (typeof obj.reasonCode !== "string") return [];
    return [
      {
        reasonCode: obj.reasonCode,
        evidence:
          obj.evidence && typeof obj.evidence === "object"
            ? (obj.evidence as Record<string, unknown>)
            : {},
      },
    ];
  });
}

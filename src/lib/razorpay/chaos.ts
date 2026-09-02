/**
 * Deliberate failure injection.
 *
 * Track 1's bar asks for "one failure handled gracefully". A blocked purchase does not
 * satisfy that line — a block is the product working exactly as designed. What the bar
 * is asking about is *infrastructure* failing underneath a money action, which is not
 * something you can wait around for during a five-minute demo.
 *
 * So it is a switch. `?chaos=razorpay_timeout` on a run makes the next Razorpay call fail
 * in a specific, reproducible way, and the retry path handles it on camera. This is
 * documented rather than hidden: a chaos switch is a normal piece of resilience tooling,
 * and being able to demonstrate the failure path on demand is the point.
 */

export const CHAOS_MODES = ["razorpay_timeout", "razorpay_500", "webhook_drop"] as const;

export type ChaosMode = (typeof CHAOS_MODES)[number];

export function isChaosMode(value: string | null | undefined): value is ChaosMode {
  return !!value && (CHAOS_MODES as readonly string[]).includes(value);
}

/** Thrown by the Razorpay client when chaos is armed. Shaped like a real transport failure. */
export class InjectedFailure extends Error {
  readonly injected = true;
  constructor(
    readonly mode: ChaosMode,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "InjectedFailure";
  }
}

/**
 * One-shot arming, keyed by run.
 *
 * A chaos mode fires once and disarms, so a run that injects a timeout sees exactly one
 * failure and then recovers — which is the story worth showing. If it fired on every call
 * the retry could never succeed and the demo would show a broken system rather than a
 * resilient one.
 */
const armed = new Map<string, ChaosMode>();

export function arm(runId: string, mode: ChaosMode): void {
  armed.set(runId, mode);
}

/** Consume the armed mode for this run, if any. Returns null when nothing is armed. */
export function consume(runId: string | null | undefined): ChaosMode | null {
  if (!runId) return null;
  const mode = armed.get(runId);
  if (mode) armed.delete(runId);
  return mode ?? null;
}

export function disarm(runId: string): void {
  armed.delete(runId);
}

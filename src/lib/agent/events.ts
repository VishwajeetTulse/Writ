import type { PolicyViolation } from "../policy";

/**
 * What a run streams to the console.
 *
 * This shape is deliberately independent of *what is driving the run*. There are three
 * drivers — a Gemini tool loop, a Claude tool loop, and a scripted buyer with no model
 * in it at all — and they emit exactly these events. The console renders them
 * identically, because the interesting half of a run was never the model: it is the
 * sequence of gateway decisions, and those are produced by the same code either way.
 *
 * The `driver` field on `run_started` is how the UI stays honest about which one ran.
 */

export type RunEvent =
  | {
      type: "run_started";
      runId: string;
      goal: string;
      driver: "scripted" | "gemini" | "claude";
      chaos: string | null;
    }
  /** The buyer's reasoning, in its own words. Never trusted, only displayed. */
  | { type: "plan"; text: string }
  /** A purchase is about to be put to the gateway. */
  | {
      type: "attempt";
      sku: string;
      productName: string;
      merchantName: string;
      quantity: number;
      /** The catalog price, for display. The gateway prices it again regardless. */
      amountPaise: number;
    }
  /** What the gateway decided. The only event that can be believed. */
  | {
      type: "decision";
      sku: string;
      productName: string;
      verdict: "ALLOW" | "BLOCK" | "ESCALATE";
      reasonCode: string | null;
      violations: PolicyViolation[];
      amountPaise: number;
      latencyUs: number;
      purchaseId?: string;
      razorpayOrderId?: string;
      paymentLinkUrl?: string;
      recovered?: { attempts: number; failure: string };
    }
  /** Spend state after a decision, so the runway can move as the run proceeds. */
  | { type: "spend"; spentPaise: number; capPaise: number; remainingPaise: number }
  /** Narration from the harness rather than the buyer. */
  | { type: "note"; text: string; tone?: "plain" | "warn" }
  | {
      type: "run_ended";
      status: string;
      summary: {
        attempted: number;
        allowed: number;
        blocked: number;
        spentPaise: number;
        recoveredFailures: number;
      };
    };

/** Serialize one event as an SSE frame. */
export function sse(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

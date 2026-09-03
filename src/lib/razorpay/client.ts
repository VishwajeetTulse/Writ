import { consume, InjectedFailure, type ChaosMode } from "./chaos";

/**
 * Razorpay REST client, test mode.
 *
 * Written against `fetch` rather than the `razorpay` npm SDK for one reason that matters
 * here: the failure path is the demo. Owning the transport means the timeout, the retry,
 * and the idempotency behaviour are all visible in this file instead of buried in a
 * dependency, and the chaos switch has somewhere honest to live.
 *
 * This module is the ONLY place in the codebase that holds Razorpay credentials. The
 * buyer agent cannot import it — it reaches money exclusively through the gateway, which
 * is the architectural boundary the whole product is arguing for.
 */

const BASE_URL = "https://api.razorpay.com/v1";
const DEFAULT_TIMEOUT_MS = 12_000;

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body?: unknown,
    /** Transport failures and 5xx are worth retrying; a 400 never is. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. " +
        "Get test-mode keys from the Razorpay dashboard (Settings -> API Keys) " +
        "and put them in .env — see .env.example.",
    );
  }
  // Live keys are refused here rather than in a startup check, because this is the
  // only function in the codebase that reads them. Every path to money runs through
  // it, so there is no route to a live charge that skips this line — which is a much
  // stronger guarantee than a guard someone has to remember to call.
  if (!keyId.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Refusing to use Razorpay key "${keyId.slice(0, 12)}…": this is not a test-mode ` +
        `key. Writ is a prototype and never runs against live keys. Test key ids begin ` +
        `with "${TEST_KEY_PREFIX}".`,
    );
  }

  return { keyId, keySecret };
}

/** Razorpay test-mode key ids carry this prefix. Live ones do not. */
const TEST_KEY_PREFIX = "rzp_test_";

/** True when test-mode keys are configured. */
export function isTestMode(): boolean {
  return (process.env.RAZORPAY_KEY_ID ?? "").startsWith(TEST_KEY_PREFIX);
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Run id, used to consume an armed chaos mode. */
  runId?: string | null;
  timeoutMs?: number;
}

async function request<T>(opts: RequestOptions): Promise<T> {
  const chaos = consume(opts.runId);
  if (chaos) throwInjected(chaos);

  const { keyId, keySecret } = credentials();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      const description =
        (parsed as { error?: { description?: string } })?.error?.description ??
        `Razorpay returned ${res.status}`;
      throw new RazorpayError(description, res.status, parsed, res.status >= 500);
    }

    return parsed as T;
  } catch (err) {
    if (err instanceof RazorpayError || err instanceof InjectedFailure) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new RazorpayError(
        `Razorpay request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        0,
        undefined,
        true,
      );
    }
    throw new RazorpayError(
      err instanceof Error ? err.message : "Razorpay request failed",
      0,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

function throwInjected(mode: ChaosMode): never {
  if (mode === "razorpay_timeout") {
    throw new InjectedFailure("razorpay_timeout", "Razorpay request timed out (injected)");
  }
  if (mode === "razorpay_500") {
    throw new InjectedFailure(
      "razorpay_500",
      "Razorpay returned 502 Bad Gateway (injected)",
      502,
    );
  }
  // webhook_drop is handled at the webhook layer, not here.
  throw new InjectedFailure(mode, `Injected failure: ${mode}`);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
  created_at: number;
  notes?: Record<string, string>;
}

/**
 * Create an order.
 *
 * `receipt` carries our idempotency key. Razorpay does not deduplicate on it, so the
 * real replay defence is the unique index on `Purchase.idempotencyKey` — but putting the
 * key in the receipt means a duplicate is traceable from the Razorpay dashboard too,
 * which is what you want when reconciling after an incident.
 */
export async function createOrder(params: {
  amountPaise: bigint;
  receipt: string;
  notes?: Record<string, string>;
  runId?: string | null;
}): Promise<RazorpayOrder> {
  return request<RazorpayOrder>({
    method: "POST",
    path: "/orders",
    runId: params.runId,
    body: {
      amount: Number(params.amountPaise),
      currency: "INR",
      receipt: params.receipt,
      notes: params.notes,
    },
  });
}

export async function fetchOrder(orderId: string): Promise<RazorpayOrder> {
  return request<RazorpayOrder>({ method: "GET", path: `/orders/${orderId}` });
}

// ---------------------------------------------------------------------------
// Payment Links
// ---------------------------------------------------------------------------

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  amount: number;
  currency: string;
  status: string;
  reference_id?: string;
}

export async function createPaymentLink(params: {
  amountPaise: bigint;
  description: string;
  referenceId: string;
  notes?: Record<string, string>;
  runId?: string | null;
}): Promise<RazorpayPaymentLink> {
  return request<RazorpayPaymentLink>({
    method: "POST",
    path: "/payment_links",
    runId: params.runId,
    body: {
      amount: Number(params.amountPaise),
      currency: "INR",
      description: params.description,
      reference_id: params.referenceId,
      notes: params.notes,
      // No customer contact details: this is a demo link paid by the operator, and
      // sending notifications would put real messages in front of real people.
      notify: { sms: false, email: false },
      reminder_enable: false,
    },
  });
}

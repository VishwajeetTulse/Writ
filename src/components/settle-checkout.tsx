"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Razorpay Checkout, opened against an order the gateway already created.
 *
 * This is an **operator** action, not an agent one, and the distinction is the whole
 * reason it lives on its own screen instead of in the run console. The agent's job ends
 * when the gateway authorises a collection; a human tapping a checkout inside the agent
 * loop would be the slow approval this product exists to remove.
 *
 * What it is for: proving the settlement half of the integration with Razorpay's own
 * money movement rather than a webhook this repository generated. A payment made here
 * is a real test-mode capture with a real payment id, it appears in the Razorpay
 * dashboard, and `npm run reconcile` then settles the purchase by asking Razorpay —
 * not by being told.
 *
 * In production this step is a payment instrument the mandate holder provisions once,
 * which is the layer this prototype does not build. See the README.
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/**
 * Fetch Razorpay's checkout script the first time it is needed.
 *
 * Loaded on click rather than on mount, for two reasons: the rest of the console has no
 * business pulling in a third-party payment script, and a mount effect that has to
 * report "already loaded" back into React state is a cascading render for no benefit.
 */
let loading: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Razorpay's checkout script could not be loaded."));
    };
    document.body.appendChild(script);
  });
  return loading;
}

export function SettleCheckout({
  keyId,
  orderId,
  amountPaise,
  description,
}: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  description: string;
}) {
  const [state, setState] = useState<
    "idle" | "loading" | "open" | "paid" | "dismissed"
  >("idle");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    setState("loading");

    try {
      await loadCheckout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout could not be loaded.");
      setState("idle");
      return;
    }

    if (!window.Razorpay) {
      setError("Checkout loaded but did not register itself.");
      setState("idle");
      return;
    }

    setState("open");

    const checkout = new window.Razorpay({
      key: keyId,
      order_id: orderId,
      amount: amountPaise,
      currency: "INR",
      name: "Writ",
      description,
      // No signature is verified in the browser. The handler below only updates what
      // this screen says; the purchase settles from Razorpay's own state when
      // reconciliation asks for it. A client callback is a claim, not a fact.
      handler: (res: { razorpay_payment_id?: string }) => {
        setPaymentId(res.razorpay_payment_id ?? null);
        setState("paid");
      },
      modal: { ondismiss: () => setState("dismissed") },
      theme: { color: "#16150f" },
    });

    checkout.open();
  }

  if (state === "paid") {
    return (
      <div className="rounded-md border border-permit/25 bg-permit-wash px-4 py-3.5">
        <p className="human text-lede text-permit">Razorpay took the payment.</p>
        {paymentId && (
          <p className="mt-1.5 font-mono text-micro text-permit">{paymentId}</p>
        )}
        <p className="mt-2.5 max-w-[62ch] text-ui leading-relaxed text-ink-mute">
          The purchase is still recorded as unsettled here, and that is deliberate. A
          browser callback is something the browser said. Run{" "}
          <span className="font-mono text-micro">npm run reconcile</span> and the ledger
          will settle it from Razorpay&rsquo;s own answer instead.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          variant="primary"
          onClick={open}
          disabled={state === "loading" || state === "open"}
        >
          {state === "loading" ? "Opening…" : "Pay this order"}
        </Button>
        {state === "dismissed" && (
          <span className="text-ui text-ink-mute">Checkout closed. Nothing was paid.</span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-ui text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

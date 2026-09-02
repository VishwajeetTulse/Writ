# Webhooks

Writ settles its ledger from Razorpay's events, not from an optimistic local write.
The gateway records a purchase as `CREATED` when Razorpay accepts the order — that
means "Razorpay has it", not "the money arrived". Only a signature-verified
`order.paid` moves it to `PAID`.

There are three ways to exercise that path, in increasing order of realism.

## 1. Local harness — no tunnel needed

```
npm run dev
npm run webhook:test
```

Posts Razorpay-shaped events at the running server, signed with the same HMAC-SHA256
scheme Razorpay uses, and asserts the whole contract:

| Check | Expected |
|---|---|
| No signature | 401, body never parsed |
| Wrong signature | 401 |
| Valid signature, body edited afterwards | 401 |
| Valid signature and body | 200, purchase settles to `PAID` |
| Same event delivered twice | 200, no second settlement |

The harness signs a body. It does not fake a payment: the purchase and the order it
settles are real, created by the gateway against Razorpay's test API. Only the
*delivery* of the notification is simulated.

## 2. Pull-based reconciliation — no tunnel, real answers

```
npm run reconcile
```

Asks Razorpay directly about every outstanding order rather than waiting to be told.
It settles anything Razorpay reports as paid, and — more importantly — compares the
amount Razorpay holds against the amount in the ledger. A mismatch would mean an order
was created with terms other than the ones the policy engine judged, which matters more
than a late settlement.

This is the fallback if a tunnel drops mid-demo. It is pull-based, so it cannot fail
to arrive.

## 3. Real webhook delivery, end to end

Needs a public URL. Any tunnel works; ngrok is the shortest path.

**Start the tunnel**

```
ngrok http 3000
```

Copy the `https://` forwarding URL it prints.

**Register the webhook**

Razorpay Dashboard → Settings → Webhooks → Add New Webhook:

- **URL** — `https://<your-ngrok-subdomain>.ngrok-free.app/api/webhooks/razorpay`
- **Secret** — the exact value of `RAZORPAY_WEBHOOK_SECRET` in your `.env`
- **Active events** — `order.paid` and `payment_link.paid`

The secret must match on both sides or every delivery is rejected with a 401. That is
the intended behaviour, not a misconfiguration to work around.

**Trigger a real payment**

Create a purchase with a Payment Link:

```
curl -X POST http://localhost:3000/api/gateway/purchase \
  -H 'content-type: application/json' \
  -d '{"mandateId":"mnd_...","sku":"sku_milk_1l","quantity":1,
       "idempotencyKey":"idem_demo_1","withPaymentLink":true}'
```

Open the `paymentLinkUrl` from the response and pay it in test mode. Razorpay posts
`payment_link.paid`, the ledger settles, and the purchase flips to `PAID`.

The ngrok URL changes every time the tunnel restarts on the free tier, so the webhook
has to be re-registered each session. Worth doing once before recording rather than
discovering on demo day.

## What the signature actually protects

The route reads `request.text()` and verifies the HMAC against those exact bytes
*before* parsing. Parsing first and re-serializing would change key order and spacing,
so the digest would never match — but more importantly, an unverified webhook is an
unauthenticated write to the spend ledger. Anyone who could post to this endpoint could
otherwise mark purchases paid.

The harness's third case is the one that matters: a body edited after being signed with
a valid signature attached. That is the actual attack, and it returns 401.

## Chaos

`webhook_drop` is a chaos mode (see `src/lib/razorpay/chaos.ts`) for demonstrating what
happens when a notification never arrives. The answer is reconciliation: run
`npm run reconcile` and the ledger catches up from the source of truth.

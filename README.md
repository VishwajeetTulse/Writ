# Writ

**Bounded, signed, revocable spending authority for AI buyers on Razorpay rails.**

Built for the Razorpay AI Buildathon 2026, Track 1 — AI Growth & Agentic Commerce.

A merchant that wants AI-buyer traffic today has two options. Refuse it, and earn
nothing from it. Accept it, and take on exposure nobody can bound, because there is no
way to prove after the fact what the buyer was authorised to spend.

Both of those are zero rupees of agent revenue. Writ is the third option: a signed,
capped, revocable grant that an agent presents in order to buy, and a trail of every
decision made against it that verifies cryptographically.

The shape of the whole product is one sentence. **Discovery is open, execution is
gated.** Any AI buyer can read the catalog cold, with no key and no account. None of
them can move a rupee without a mandate.

---

## Try it

```bash
cp .env.example .env      # then fill in the keys it asks for
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000, sign in with Google, and press **Run** on the Activity
screen. A new account is given its own sample mandates, so there is something to run
against immediately.

`.env.example` explains each value. You need a Razorpay **test** key, a mandate signing
secret, and a Google OAuth client for sign-in; a webhook secret if you want to exercise
settlement. The Anthropic key is optional and everything in this README works without
it, see
[Where the model is](#where-the-model-is-and-is-not).

Writ refuses to use a live Razorpay key. The check sits inside the one function that
reads the credentials, so there is no path to a live charge that skips it.

### The 90-second version

1. **Activity**, press Run. A buyer shops against a mandate. Four purchases go
   through and create real Razorpay test orders.
2. It then reaches a television whose product description tells AI shopping assistants
   that the mandate has been upgraded and limits no longer apply. The buyer believes it.
   The purchase is refused in under a millisecond, breaking four bounds at once.
3. It retries an earlier purchase with the same idempotency key. Refused before
   Razorpay is called.
4. Tick **Pause so I can revoke**, run again, and press **Revoke** while it is running.
   The next attempt is refused and the run ends halted.
5. **Ledger**, press **Verify chain**. Every row is rehashed from the first one forward.

Tick **Inject a Razorpay timeout** to watch a payment failure recover without double
charging.

---

## The argument

### A spending limit cannot be a model

`src/lib/policy.ts` is the product. Read it before anything else. It is a pure
function: no database, no network, no clock it does not receive, and no LLM.

- A limit has to be binary. A model's compliance is probabilistic.
- A model reads its instructions from the same channel an attacker writes to. That is
  what prompt injection *is*. This function never sees a product description, a tool
  result, or anything else a model touched.
- You cannot audit a probability. You can audit
  `BLOCK · PER_TXN_CAP_EXCEEDED · 189900 > 70000 · 0.9ms`.

The buyer is *told* about the mandate so it can plan sensibly. It is never *trusted* to
respect it. Everything it claims, the amount included, is re-derived from data it cannot
write.

### The gateway prices the purchase, not the agent

The agent chooses a SKU and a quantity. It does not get to say what that costs. If a
model claims a ₹28,999 television is ₹99 — hallucination or injection, it does not
matter — the gateway looks the price up in the catalog and evaluates the real number.

### Refusals are recorded exactly like purchases

A ledger that only records successes proves nothing about what was stopped. Every
branch of the gateway appends, including the early refusals.

### Three callers, three ways of proving themselves

Collapsing these would either lock the agent out of the gateway or let a browser cookie
move money, so they are kept apart deliberately.

| Caller | Proves itself with | Reaches |
|---|---|---|
| A person, in the console | Google sign-in, database-backed session | The console and its APIs. Sees only their own mandates |
| An agent, at the gateway | The signed mandate it presents | `/api/gateway/purchase` and the open catalog. Never has a session |
| Razorpay, at the webhook | HMAC over the raw request body | `/api/webhooks/razorpay` only |

Sessions are rows rather than signed tokens, so signing out ends one immediately instead
of leaving it valid until it expires. That is the same reason mandate status is re-read
on every purchase rather than cached.

Discovery stays open to everyone with no account at all, because an AI buyer has to be
able to read the catalog cold. Open discovery, gated execution.

### Revocation is not a message

There is no "pending revocation" state and nothing to propagate. Revoking flips one
column. The gateway re-reads mandate status on every single attempt and never caches
it, so an agent mid-run loses its authority on its next tool call. Nothing is
coordinated, which is exactly why it cannot fail to arrive.

---

## Every claim, and how to check it

Each of these runs against real Razorpay test-mode APIs. None of them need the
Anthropic key.

| Claim | Command | What it proves |
|---|---|---|
| The bounds hold across 111 cases | `npm run evals` | Block recall, allow accuracy, per-cause recall, latency |
| The engine behaves at its edges | `npm test` | 67 unit tests over the pure function |
| Razorpay is really wired up | `npm run smoke:razorpay` | Creates a real test-mode order |
| The whole gated path works | `npm run gate2` | 10 assertions end to end, real orders |
| Webhooks cannot be forged | `npm run webhook:test` | Rejects unsigned, wrong-signature and tampered bodies |
| Settlement survives a dropped webhook | `npm run reconcile` | Pulls status from Razorpay and compares amounts |
| Revocation lands on the next call | `npm run revoke:test` | Revokes mid-run, asserts the next attempt is refused |
| The audit trail was not edited | `curl 'localhost:3000/api/ledger?verify=1'` | Rehashes the entire chain |
| Every money action is explainable | `curl 'localhost:3000/api/explain?seq=42'` | Renders a recorded decision into prose, from its own arithmetic |

### Evaluation results

Committed at [`evals/results.json`](evals/results.json), regenerate with `npm run evals`.

| | |
|---|---|
| Cases | 111 (66 must block, 45 must allow) |
| False negatives | **0** — money that should not have moved |
| False positives | 0 — sales that should have gone through |
| Block recall | 100% |
| Decision latency | p50 0.005ms, p95 0.026ms, max 0.17ms |
| Reason codes exercised | 11 of 12 |

The suite scores the two failure modes separately, because they cost completely
different things. A false negative is money that left an account without authority; a
false positive is a sale the merchant did not make. Only a false negative fails the
build.

Caps are swept in one-rupee steps straight through the boundary rather than sampled at
comfortable distances, because a cap of ₹700 that blocks ₹900 proves almost nothing.
What matters is that ₹700.00 is permitted and ₹700.01 is not.

**The suite earned its keep on its first run.** It caught a live defect: a mandate whose
derived status was `EXPIRED` fell through to the generic non-active gate and was
reported as `SIGNATURE_INVALID`. The verdict was right and no money was at risk, but the
recorded cause was wrong, which would have sent someone hunting for tampering that never
happened. Fixed in `evaluate`, with a regression test.

`UNKNOWN_SKU` is out of scope for this suite by design: the gateway raises it before a
priced action exists, so the pure function never emits it. The runner prints that gap
rather than hiding it.

---

## Architecture

![Writ architecture: an AI buyer reads an open catalog with no key, but must present a signed mandate to the gateway. The gateway loads the mandate fresh, verifies its signature, prices the SKU itself, evaluates a pure policy function, claims an idempotency key, and only then calls Razorpay. A block short-circuits before Razorpay is called. Every branch appends to an append-only hash-chained ledger.](docs/architecture.svg)

The gateway is the only path to money. The agent holds no Razorpay credentials and
cannot import the Razorpay client. In this prototype they share a process, so the
boundary is drawn at the HTTP route rather than by a network — see
[limitations](#what-this-does-not-do).

---

## Where the model is, and is not

| Uses an LLM | Does not |
|---|---|
| Drafting a mandate from a sentence, then clamped by server-side ceilings and reviewed by a human before signing | The policy engine |
| The buyer agent, which chooses what to shop for | The gateway |
| | Pricing |
| | Signature verification |
| | Explaining a verdict |
| | The audit ledger |

Explaining a verdict started out on the left of that table and moved right, which is
worth a sentence. Every decision already carries its own arithmetic, because the engine
records evidence rather than prose. Turning that into a sentence is rendering, not
reasoning, and a model asked to do it can only introduce the possibility of saying
something the numbers do not support. So `/api/explain` builds the sentence from the
recorded evidence and the interface shows the reason code beside it. A model may later
rephrase it, and the response says which version you are reading.

The buyer pane in the console currently runs a **scripted buyer**, and says so on
screen. That is deliberate rather than a placeholder apology. The claim Writ makes is
that money actions are bounded regardless of what the buyer does, so substituting a
script and getting identical verdicts is the strongest available statement of it: the
enforcement does not depend on the thing being enforced against. It also means the demo
needs no key, no tokens and no network beyond Razorpay.

With `ANTHROPIC_API_KEY` set, a Claude tool loop drives the same gateway calls and emits
the same event stream. The console does not change.

---

## Screens

| | |
|---|---|
| **Mandates** | Every grant, what it permits, what it has spent, what it refused |
| **Catalog** | The shops and stock an AI buyer can see, with each item marked against your own mandates. Open without an account, the same list the agent reads as JSON |
| **New mandate** | Set the bounds and read what they mean. The preview runs the *real* policy engine in the browser against the live catalog, so before you sign you can see which products it permits and which it refuses, with the reason code for each |
| **Activity** | Split pane. What the buyer did on the left, what the gateway decided on the right. Nothing crosses between them except a SKU and a quantity |
| **Ledger** | The hash-chained trail, filterable by cause, with live chain verification |
| **Spending** | What was spent, what is left on each mandate, and why purchases were stopped |

The spend runway is the signature element. A progress bar shows consumption; it cannot
show a boundary being enforced. So the cap is drawn as a wall with space beyond it, and
a refused attempt renders as a dashed segment cut off by that wall.

---

## API

| | |
|---|---|
| `GET /api/catalog` | Open product feed. No auth, by design |
| `GET /.well-known/agent-catalog.json` | Discovery descriptor. Declares that execution needs a mandate |
| `POST /api/gateway/purchase` | The only path to money |
| `GET POST /api/mandates` | List and issue |
| `GET /api/mandates/:id` | One mandate, signature re-verified on every read |
| `POST /api/mandates/:id/revoke` | Effective on the next attempt |
| `POST /api/agent/run` | Runs a buyer, streams decisions over SSE |
| `GET /api/ledger` | The trail. `?verify=1` rehashes the whole chain |
| `POST /api/webhooks/razorpay` | Settlement. Signature checked on raw bytes before parsing |

All money is integer paise in `bigint`. There is no float anywhere in the money path.

---

## What this does not do

Stated plainly, because a security claim with unstated boundaries is worth nothing.

- **An order is not a settled payment, and there is no payment instrument.** This is
  the boundary worth understanding before anything else. A mandate answers *how much,
  where, and until when*. A payment instrument answers *how the money actually travels*.
  Writ implements the first layer for real and does not implement the second. An allowed
  purchase creates a genuine Razorpay order, which is a server-side authorisation to
  collect; settling it needs an instrument, and provisioning one is out of scope here.

  In production the two compose, and the composition is the whole point: the human
  registers a pre-authorised instrument once — a UPI Autopay or e-mandate debit — at the
  same moment they sign the mandate, and the agent then spends against both with nobody
  tapping anything again. That is also why there is deliberately **no payment link on
  the agent path**. A link is a hosted page a person opens and pays, and a person
  approving each purchase at a checkout is precisely the slow checkout this exists to
  replace. The gateway can still create one behind an explicit flag, for a
  human-present checkout, which is a different use.
- **The gateway shares a process with the agent.** The boundary is drawn at the HTTP
  route, not by a network. Moving the gateway to its own service is a deployment change
  rather than a rewrite, but it has not been done.
- **Mandates are signed with an HMAC and a shared secret**, not an asymmetric key the
  merchant could verify independently. Anyone holding `MANDATE_SIGNING_KEY` can mint a
  mandate. Production wants a keypair, with the private half in an HSM.
- **The ledger is hash-chained, not anchored.** It detects edits, reordering and
  deletion by anyone who cannot recompute the whole chain. Someone with write access to
  the entire table could rebuild it consistently. Anchoring the head hash externally
  would close that.
- **The catalog is seeded**, four merchants and seventeen products, not a live merchant
  integration.
- **The mandate id is the agent's only credential.** Sign-in protects the console, and
  every mandate, purchase and ledger row is scoped to the account that owns it. The
  gateway is deliberately outside that, because agents have no session — but it means
  anyone who learns a mandate id can spend inside that mandate's bounds. The bounds hold,
  so the damage is capped at what the human already authorised, and the attempt is
  recorded. It is still the next thing to fix: the agent should present a token issued
  alongside the mandate, not just its id.
- **No merchant product.** Merchants are seeded, and integrating real ones is out of
  scope rather than unbuilt-by-accident. Two routes exist and both were rejected for
  this prototype: scraping aggregators would breach their terms and Razorpay's, and a
  self-serve merchant dashboard is a second product rather than a feature. The honest
  position is that Writ sells to the buyer side and a merchant integrates through the
  catalog API.
- **SQLite, one signing key, one deployment.** No key rotation, no tenancy beyond
  per-account data scoping.
- **Test mode only.** Writ refuses to start against a live Razorpay key. Nothing here
  has moved real money.
- **`webhook:test` signs a body; it does not fake a payment.** The purchase and the
  order it settles are real, created by the gateway against Razorpay's test API. Only
  the delivery of the notification is simulated.
- **The buyer is scripted unless an Anthropic key is set.** See above.

One product description in the seed contains a prompt-injection payload. That is
deliberate. It is the adversarial case the engine is measured against, and it is
documented in `prisma/seed.ts`.

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · Prisma 7 on SQLite ·
Vitest · Razorpay test-mode REST · Anthropic SDK, optional.

Fonts are Instrument Sans and IBM Plex Mono, and the split is load-bearing: anything
the machine computed is set in mono, anything a person wrote is sans. A reader can tell
claims from evidence without reading a word.

More detail in [`docs/webhooks.md`](docs/webhooks.md). The five-minute demo script,
with the real numbers a run produces, is in
[`docs/demo-script.md`](docs/demo-script.md).

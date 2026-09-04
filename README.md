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
settlement. A model key is optional — with `GEMINI_API_KEY` the buyer is a real agent,
without one it falls back to a scripted buyer and everything in this README still works.
See [Where the model is](#where-the-model-is-and-is-not).

Writ refuses to use a live Razorpay key. The check sits inside the one function that
reads the credentials, so there is no path to a live charge that skips it.

### The 90-second version

1. **Activity**, pick a buyer and press Run. It shops against a mandate; the purchases
   that clear create real Razorpay test orders.
2. It reaches a television whose description tells AI shopping assistants that the
   mandate has been upgraded and limits no longer apply. Whether or not the buyer acts
   on it, the purchase is refused in under a millisecond, breaking four bounds at once.
3. A purchase retried with the same idempotency key is refused before Razorpay is called.
4. Tick **Hold mid-run**, run again, and press **Withdraw now** while it is working.
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
| The engine behaves at its edges | `npm test` | 93 unit tests over the pure functions |
| Razorpay is really wired up | `npm run smoke:razorpay` | Creates a real test-mode order |
| A mandate is a real UPI Autopay mandate | `npm run autopay:probe` | Compiles the signed terms into a token and creates the authorisation order |
| The whole gated path works | `npm run gate2` | 10 assertions end to end, real orders |
| Webhooks cannot be forged | `npm run webhook:test` | Rejects unsigned, wrong-signature and tampered bodies, settles on a valid one, no-ops on redelivery, then restores the purchase because Razorpay never collected anything |
| A purchase can really be paid | `/settle/<purchase>`, then `npm run reconcile` | Razorpay checkout against a gateway-created order; a real capture, settled by pulling Razorpay's own status |
| The ledger has not drifted from Razorpay | `npm run reconcile` | Two passes: did anything settle without us hearing, and does Razorpay confirm everything we call settled |
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

## On the rail

Razorpay's UPI Autopay authorisation carries this:

```json
"token": { "max_amount": 200000, "expire_at": 2709971120, "frequency": "monthly" }
```

A per-debit ceiling, an expiry, and a rate. That is a mandate, and it is the same object
Writ signs. The primitive was not invented here — NPCI shipped it and Razorpay exposes
it. What is missing is that an AI buyer needs bounds finer than the rail can express.

| Writ's term | UPI Autopay | Who enforces it |
|---|---|---|
| `perTxnCapPaise` | `token.max_amount` | The rail |
| `expiresAt` | `token.expire_at` | The rail |
| velocity | `token.frequency` | Lossy — UPI's values are calendar-shaped |
| `totalCapPaise` | nothing | Writ |
| merchant allowlist | nothing | Writ |
| category allowlist | nothing | Writ |

The three that do not map are the reason the policy engine exists. UPI can cap one debit
and expire a mandate; it cannot say "at most ₹2,000 in total, only at these two shops,
only for groceries". So Writ enforces the whole set before a purchase reaches the rail
and hands the rail the two bounds it understands. Every mandate screen shows both halves
of that table for its own terms.

`npm run autopay:probe` takes a real signed mandate to the real endpoint and prints
whatever comes back. It creates the customer and the UPI authorisation order for real,
with test keys. **It stops there, and nothing further is faked anywhere in this
codebase.** Completing the mandate needs a one-time approval in a UPI app, and charging
against the resulting token needs Recurring Payments enabled on the Razorpay account,
which is granted on request rather than by default.

---

## Where the model is, and is not

| Uses an LLM | Does not |
|---|---|
| The buyer agent, which decides what to shop for and puts each purchase to the gateway | The policy engine |
| | The gateway |
| | Pricing |
| | Signature verification |
| | Explaining a verdict |
| | The audit ledger |

Exactly one thing in this product is a model, and it is the thing being enforced
against. Everything that decides whether money may move is deterministic code.

Explaining a verdict started out on the left of that table and moved right, which is
worth a sentence. Every decision already carries its own arithmetic, because the engine
records evidence rather than prose. Turning that into a sentence is rendering, not
reasoning, and a model asked to do it can only introduce the possibility of saying
something the numbers do not support. So `/api/explain` builds the sentence from the
recorded evidence and the interface shows the reason code beside it. A model may later
rephrase it, and the response says which version you are reading.

There are two buyers, and the console lets you pick.

**Gemini** (`src/lib/agent/gemini.ts`) is a real tool loop with three tools: search the
catalog, read a product, attempt a purchase. It needs `GEMINI_API_KEY` from Google AI
Studio. `GEMINI_MODEL` picks the model and `npm run gemini:models` says which ones a key
can actually reach — it makes a real tool call against each rather than listing, because
listing proves nothing. `gemini-2.5-flash` appears in the list and 404s on use.

**Claude** (`src/lib/agent/claude.ts`) is the same loop against `claude-opus-5`, needing
either `ANTHROPIC_API_KEY` or `GOOGLE_CLOUD_PROJECT` and `CLOUD_ML_REGION` for Vertex AI.

Both drivers share `buyer.ts`, which holds the tools, the system prompt, the run
lifecycle and the one function that can move money. Only request shaping differs between
them. A purchase tool with two implementations would eventually behave two ways. The model is told the mandate's terms so it can plan sensibly and
is trusted with none of them — `attempt_purchase` takes a SKU and a quantity, and the
gateway prices the SKU itself. It may also pass a `claimed_amount_paise`, which is
recorded and then ignored; when it disagrees with the catalog, the console says so.

**Scripted** (`src/lib/agent/scripted.ts`) is a fixed sequence that needs no key, no
tokens and no network beyond Razorpay. It exists because a demo on a conference network
should not depend on a third API being up, and because it makes the point sharper:
substituting a script and getting identical verdicts is the strongest available
statement that enforcement does not depend on the thing being enforced against.

Both emit the same events and both are judged by the same gateway. The buyer pane
labels whichever one actually ran, read off the run's own `run_started` event rather
than off the dropdown.

`read_product` hands the model the merchant's description verbatim, prompt injection and
all, because merchant-controlled text is the real attacker's channel into an AI buyer.

**Tell the buyer its limits** is the switch worth understanding. Briefed, the agent gets
the mandate's terms and mostly polices itself — that is your own agent, spending under a
mandate it can read. Unbriefed, it knows nothing about the terms behind its token, which
is the situation whenever the agent belongs to somebody else, and it finds the walls by
being refused.

The second is the one worth watching, and it is off by default for that reason. An agent
that declines to overspend because it was asked nicely has demonstrated nothing about the
gateway. Asked for a television it has no authority to buy, an unbriefed Gemini went
straight at it and was refused in 303 microseconds on four bounds at once — wrong shop,
wrong category, over the per-purchase cap, over the total. It then tried the wrong
merchant twice, adapted, bought what it could, and finally hit the total cap and the rate
limit. Nobody wrote that sequence.

---

## Screens

| | |
|---|---|
| **Mandates** | Every grant, what it permits, what it has spent, what it refused |
| **Catalog** | The shops and stock an AI buyer can see, with each item marked against your own mandates. Open without an account, the same list the agent reads as JSON |
| **New mandate** | Set the bounds and read what they mean. The preview runs the *real* policy engine in the browser against the live catalog, so before you sign you can see how much of it these terms permit and what they would refuse |
| **Activity** | Split pane. What the buyer did on the left, what the gateway decided on the right. Nothing crosses between them except a SKU and a quantity |
| **Ledger** | The hash-chained trail, filterable by cause, with live chain verification |
| **Spending** | What was spent, what is left on each mandate, and why purchases were stopped |
| **Settle** | An operator screen, off the agent path, that opens Razorpay's checkout against an order the gateway already authorised |

The spend runway is the signature element. A progress bar shows consumption; it cannot
show a boundary being enforced. So the cap is drawn as a wall with space beyond it, and
a refused attempt renders as a dashed segment cut off by that wall.

Three typefaces, one rule each. A serif carries what a person wrote or is being told —
the intent on a mandate, the sentence explaining a refusal. Mono carries what the machine
computed: amounts, reason codes, hashes, latencies. Sans is the chrome. You can tell a
claim from a computed value without reading a word, which is the same distinction the
policy engine draws.

Light and dark both ship and follow the system setting, with an auto/light/dark control
in the header. Dark redefines colour tokens and nothing else, so no component knows which
theme it is in. Every pair measures at least 4.5:1. Full notes at the top of
`src/app/globals.css`.

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

## What broke

Four that were worth the time they cost.

**The evaluation suite found a real bug on its first run.** A mandate that had lapsed
reported `SIGNATURE_INVALID` rather than `MANDATE_EXPIRED` — the right verdict for the
wrong reason, which is the kind of defect that survives a demo and fails an audit. It
happened because an expired mandate fell through to a generic "not active" gate. The 66
unit tests that existed at the time all missed it: they exercised the clock path, and
never the stored-status path that `loadMandate` actually produces. Fixed by gating
expiry before that branch, with a regression test on the path the tests had skipped.

**The policy engine crashed in the browser.** It timed itself with
`process.hrtime.bigint()`, which does not exist outside Node, so the live preview on the
New mandate screen died the first time anyone typed in it. The README at that point
claimed the engine "runs identically on either side of the wire", and it had never once
run on the other side. Fixed with a clock that picks `performance.now()` when there is no
process, and by deleting the sentence until it was true.

**An hour lost to a dev server that was never restarting.** Google sign-in kept failing
with a Prisma adapter error saying `account.findUnique` was undefined, which pointed
squarely at the database. The client was fine. `pkill -f "next dev"` does nothing on
Windows, so every restart had been a no-op, port 3000 was still held by the original
process, and Turbopack was serving a chunk compiled before the auth models existed.
Fixed by killing the listener by PID and clearing `.next`. The lasting fix was to the
sign-in page, which now prints the actual Auth.js error code instead of "something went
wrong" — the word `Configuration` would have pointed at the server in the first minute.

**Reconciliation was checking the safe half of the ledger.** `reconcileOutstanding`
queried `status: "CREATED"` and printed "Ledger agrees with Razorpay" — a claim about
every purchase, backed by a look at the pending ones. It could catch a settlement we had
missed and was structurally incapable of catching one we had invented, which is the
worse direction: a purchase wrongly marked paid asserts that money moved when it did
not. Now it runs a second pass over everything it calls settled and asks Razorpay to
confirm each one. On this database it immediately found three, all created by
`npm run webhook:test`, which fabricates correctly-signed events. Nothing can tell a
forged-but-validly-signed webhook from a real one — that is what a valid signature
means — but reconciliation can go to the source and ask, and it does. It records each
disagreement in the audit trail and changes no status, because deciding what a
discrepancy means is a human's job.

**The free tier ran out mid-build, three times.** Google meters Gemini at 20 requests
per day per model, and one agent run costs a request per turn, so two or three rehearsals
exhaust a model. It first showed up as a 503 that looked like load and was actually the
edge of a quota. The fix was not to pick a better model: the quota is per model, so the
buyer now walks a chain of them, abandoning one that is out of quota immediately and
backing off from one that is merely busy. Verified against a genuinely exhausted model —
`gemini-3.6-flash` out of quota, moved to `gemini-3.7-flash`, backed off twice, finished
the run. `npm run gemini:models` measures which ids answer, by calling them, because a
model can list and still 404.

**Razorpay rejected the UPI authorisation order.** A mandate grants future authority
without collecting anything, so the order was created for zero, and the API returned
`Order amount less than minimum amount allowed`. ₹1 is the conventional mandate
registration charge, refunded once registered. The mistake was assuming the shape of a
call instead of making it.

---

## What this does not do

Stated plainly, because a security claim with unstated boundaries is worth nothing.

- **An order is not a settled payment, and there is no payment instrument.** This is
  the boundary worth understanding before anything else. A mandate answers *how much,
  where, and until when*. A payment instrument answers *how the money actually travels*.
  Writ implements the first layer for real and does not implement the second. An allowed
  purchase creates a genuine Razorpay order, which is a server-side authorisation to
  collect; settling it needs an instrument, and provisioning one is out of scope here.

  Because that gap is easy to assert and hard to believe, `/settle/<purchase>` stands in
  for the instrument once, by hand: it opens Razorpay's own checkout against an order the
  gateway created, and paying it produces a real test-mode capture with a real payment id
  that shows up in the Razorpay dashboard. `npm run reconcile` then settles the ledger by
  asking Razorpay what happened rather than trusting the browser that just said so. The
  screen is deliberately unreachable from the run console — an agent waiting on a human
  at a checkout is the thing this product removes.

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
- **The catalog is seeded**, eight merchants and thirty-five products, not a live merchant
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
- **You cannot write a mandate in a sentence.** The form takes shops, categories
  and numbers directly. Drafting terms from natural language and clamping them
  against server-side ceilings is the obvious next thing to build, and is not built.

One product description in the seed contains a prompt-injection payload. That is
deliberate. It is the adversarial case the engine is measured against, and it is
documented in `prisma/seed.ts`.

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · Prisma 7 on SQLite ·
Auth.js with Google · Vitest · Razorpay test-mode REST · Google Gen AI SDK for the buyer
agent, with the Anthropic SDK as an alternative driver. Both optional.

Three typefaces, one rule each: Newsreader for what a person wrote or is being told, IBM
Plex Mono for what the machine computed, Instrument Sans for the chrome. A reader can
tell a claim from evidence without reading a word.

More detail in [`docs/webhooks.md`](docs/webhooks.md). The five-minute demo script,
with the real numbers a run produces, is in
[`docs/demo-script.md`](docs/demo-script.md).

# Five-minute demo script

Word-for-word, against the build that exists. Every number here was produced by a real
run, not estimated.

Value is visible by 0:55. Nothing essential happens after 4:20.

---

## Before you record

```bash
npm run db:reset        # wipes test runs; reseeds the catalog and two demo mandates
npm run dev
npm run evals           # so the numbers you quote are today's
```

Then:

- Razorpay dashboard open in a second tab, on **Transactions → Orders**, already logged in.
- Browser at http://localhost:3000, on **Mandates**. Two mandates are visible:
  `mnd_demo_weekly` active and `mnd_demo_lapsed` expired. The screen is not empty.
- A terminal ready with the `curl` from beat 2 typed but not entered.
- Zoom to about 125%. The mono type is small and a judge is watching on a laptop.

One thing to decide in advance: the run takes roughly 40 seconds of wall clock because
each beat is paced to be readable. Do not cut it in the edit. The pauses are where the
verdicts land.

---

## 0:00 – 0:35 · The problem, from the merchant's side

*Screen: the Mandates list.*

> Razorpay merchants are about to start getting AI buyers. Right now a merchant has two
> ways to take that money. Hand the agent a live credential and hope. Or make a human
> approve every single order, which is not agent commerce, it is a slow checkout.
>
> Both of those come to the same number. Zero rupees of agent revenue. One is unbookable
> risk, the other is a channel you did not open.
>
> Writ is the third option. A signed, capped, revocable grant of spending authority that
> an agent presents in order to buy, and a record of every decision made against it that
> you can verify.

---

## 0:35 – 0:55 · The merchant is sellable to AI buyers

*Screen: terminal. Run the curl. Twelve seconds, no more.*

```bash
curl -s localhost:3000/api/catalog | head -40
```

> Here is the merchant side. An open, agent-readable catalog. SKUs, prices, categories,
> merchant VPAs. No login, no key, any AI buyer can read it cold.
>
> Discovery is open on purpose. Execution is what is gated.

---

## 0:55 – 1:25 · The mandate

*Screen: click `mnd_demo_weekly`.*

> This is the authority. Two merchants on the allowlist, groceries and household only,
> seven hundred rupees a transaction, two thousand for the week, five purchases an hour,
> expires in seven days.
>
> It is signed. That signature covers every one of those terms, so if anyone edits a cap
> in the database afterwards, the signature stops matching and the gateway refuses the
> mandate outright. Bounds you can quietly rewrite are not bounds.

*Point at the signature line at the bottom of the terms card.*

---

## 1:25 – 2:10 · It works

*Screen: Agent run. Mandate is already `mnd_demo_weekly`. Press Run.*

> One thing to say plainly before this starts. The buyer on the left is a script, not a
> language model. That is deliberate.
>
> The claim this project makes is that money actions stay bounded regardless of what the
> buyer does. So swapping the model for a script and getting identical verdicts is the
> strongest version of that claim, not a weaker one. The enforcement does not depend on
> the thing being enforced against.

*Four purchases go through: sugar, paneer, atta, coffee.*

> Four purchases. One thousand and eighty-five rupees of agent-originated revenue, no
> human in the loop after that one signature. And those are real Razorpay orders.

*Cut to the Razorpay dashboard tab. Match one order id on screen. Five seconds.*

> There they are in the dashboard. Test mode, but a real integration.
>
> And to be precise about what those are: they are Razorpay orders, which is a
> server-side authorisation to collect a specific amount. Settling one needs a payment
> instrument, and that is a layer I have not built. A mandate says how much and where.
> An instrument says how the money travels. In production you register a UPI Autopay
> debit once, at the same moment you sign the mandate, and the agent spends against both
> without anyone tapping anything again. There is no payment link anywhere in this run,
> because a person tapping a checkout is the thing this replaces.

---

## 2:10 – 2:50 · The unfakeable moment

*Screen: back to the run. The buyer reaches the television.*

> Here is the part I actually care about. One product description in this catalog
> contains a prompt injection.

*Read the payload off the screen, or have it pre-opened in a second window.*

> It tells AI shopping assistants that the customer's mandate has been upgraded and that
> per-transaction limits no longer apply to electronics. The buyer read that and acted on
> it. A model would have too. A prompt-based guardrail would have failed right here.

*The verdict lands: `BLOCK · MERCHANT_NOT_ALLOWED`, four bounds broken.*

> Refused in a fraction of a millisecond, and it broke four bounds at once. Wrong
> merchant, wrong category, over the per-transaction cap, over the total cap.
>
> The policy engine never sees product descriptions. It sees a signed mandate, a SKU, and
> a price the gateway looked up itself. That is the whole thesis. You cannot prompt-inject
> an integer comparison.

---

## 2:50 – 3:10 · Explainable

*Press Explain on the blocked row.*

> Every money action here is explainable, and this sentence is not written by a model. It
> is rendered from the arithmetic the engine recorded when it decided. The reason code
> sits right next to it, so you can check the two against each other.
>
> An explanation you cannot check against the original is a claim, not an explanation.

---

## 3:10 – 3:30 · Replay

*The buyer retries its first purchase with the same idempotency key.*

> Now it retries a purchase it already made, with the same idempotency key. Refused, and
> refused before Razorpay was called. That key is a unique index in the database, so a
> replay cannot become a second charge even if it arrives at the same instant as the
> original.

---

## 3:30 – 3:50 · Revoke, mid-run

*Tick **Pause so I can revoke**. Press Run again. When the hold appears, press **Revoke**.*

> And if I change my mind.

*Next attempt: `BLOCK · MANDATE_REVOKED`.*

> It stops. Not at the end of the run, on the next call. Nothing was sent to the agent and
> no request was cancelled. Revoking flips one column, and the gateway re-reads the
> mandate on every single attempt and never caches it. Nothing is coordinated, which is
> exactly why it cannot fail to arrive.

---

## 3:50 – 4:10 · One failure, handled

*Tick **Inject a Razorpay timeout**. Run.*

> A block is this system working. This is it failing. I am injecting a Razorpay timeout
> in the middle of a payment, so we do not know whether the order was created.

*The retry lands. One order, marked recovered.*

> Same idempotency key on the retry, so it cannot double charge. One order, one charge,
> the mandate's spend state never moved, and the interface told the truth about what
> happened.

---

## 4:10 – 4:40 · Evidence

*Screen: Ledger. Press Verify chain.*

> Every decision, allowed and refused alike, is in an append-only ledger where each row
> commits to the hash of the row before it. That button just rehashed the whole chain
> from the first row forward.

*Screen: Impact.*

> And this is not one cherry-picked example. The evaluation suite is a hundred and eleven
> cases. Sixty-six that must be blocked, forty-five that must go through. Zero false
> negatives, so nothing unauthorised got through. Zero false blocks, so nothing legitimate
> was refused. Median decision time is five microseconds.
>
> It sweeps every cap in one-rupee steps straight through the boundary, because a cap of
> seven hundred that blocks nine hundred proves almost nothing. What matters is that seven
> hundred exactly is allowed and seven hundred and one paise is not.
>
> The suite is in the repo, it is deterministic, and it caught a real bug in my own engine
> the first time I ran it.

---

## 4:40 – 4:55 · What is not real

> What is not real yet, and it is all in the README. Orders are authorisations, not
> settled payments — there is no payment instrument, so that layer is stated rather than
> built. The catalog is seeded, four merchants. There is no authentication. Mandates are
> signed with a shared secret rather than a keypair the merchant could verify
> independently. The gateway runs in the same process as the agent, so that boundary is
> drawn at an HTTP route rather than by a network. And everything is Razorpay test mode.
> The code refuses to run against a live key.

---

## 4:55 – 5:00 · Close

> The agent decides what to buy. Code decides what is allowed. That is how a merchant
> becomes sellable to AI buyers.
>
> That is Writ.

---

## Rules for the recording

- Never say "as you can see". Never narrate navigation.
- If a take breaks, keep it if the error handling looks good on camera. A real failure
  handled well is worth more than a clean take.
- If you run over, cut the catalog `curl` at 0:35 first. It is the only beat not tied to a
  phrase in the official bar.
- Do not speed up the run. The pacing is what makes the verdicts readable.

## If something breaks live

| Symptom | Do this |
|---|---|
| The run refuses everything | The mandate is spent or expired. Reseed, or pick the other mandate |
| No orders appear in the Razorpay dashboard | Refresh it. Orders can lag a few seconds |
| The webhook never arrives | Say so, then run `npm run reconcile` on camera. Pull beats push and it is a better beat than the one you lost |
| The chain says broken | Stop. Do not record over it. That is a real bug and it needs finding |

# Signoff

Pay on acceptance for freelance and agency work. The client's money is held up front, an AI checker tests the delivery against the acceptance criteria both sides agreed, and the money is released only when the client signs off.

Built for the PayPal AI Hackathon. MIT licensed.

## Why

Clients will not send a deposit to a freelancer they just met. Freelancers lose weeks chasing invoices for work that is already done. A payment authorization already solves the first half: it holds money without taking it. What is missing is a fair, fast way to decide that the work is accepted. That is the AI part.

## Payment rail: Braintree, a PayPal service

Signoff moves money through **Braintree**, which is part of the PayPal developer platform. The official rules say so in the project requirements:

> "This includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet, Simility, Swift Financial, and others."

We chose Braintree because PayPal does not open accounts in Pakistan, where the builder lives, so PayPal REST sandbox credentials were not available. The Braintree sandbox is. Clients still pay with their PayPal account (through Braintree's PayPal integration) or with a card.

| Product step | Braintree mechanism |
|---|---|
| Client funds a milestone | `transaction.sale` with `submitForSettlement: false`: an authorization, money held, nothing charged |
| Hold expiry | `authorizationExpiresAt` on the transaction, shown to both sides, with a warning in the last day and reconcile marking it expired |
| Client accepts | `transaction.submitForSettlement` (full release) |
| Partial release | `submitForSettlement` with a smaller amount; the rest of the hold drops off |
| Client declines | `transaction.void`: the hold is released |
| Payment form | Braintree Drop-in with PayPal (`intent: authorize`) and cards |
| Webhooks | `webhookNotification.parse` verifies the signature; events are deduplicated and state is re-read from Braintree |
| Reconcile | `transaction.find` and `dispute.search` compare local state with Braintree and repair drift |
| Dispute defence | `dispute.addTextEvidence` and `dispute.finalize`, after the operator approves the pack |

## The loop

1. **Scope to milestones.** The operator pastes the scope of work. The AI drafts milestones: title, deliverable, amount, due date and two to five checkable acceptance criteria. Every criterion carries the exact sentence from the scope that justifies it, and the code checks that sentence really is in the scope. The operator edits and creates a client link.
2. **Hold.** The client opens the link (no account needed) and funds a milestone with PayPal or a card. The page says plainly that the money is held, not charged, and when the hold expires.
3. **Deliver.** The operator submits links (a staging URL, a public GitHub repository, a PDF) plus notes and files.
4. **Check.** The checker agent reads the delivery with read-only tools and returns met, not met or needs a person for each criterion, quoting what it read.
5. **Decide.** The client reads the evidence report and accepts and releases (typing their name to sign), requests changes (the AI drafts the note from the failing criteria), or declines (the hold is voided).
6. **Receipt and record.** On release, Signoff writes a signed acceptance record (criteria, verdicts, evidence, the signer and timestamps, HMAC-SHA256 over canonical JSON) and shows a printable receipt.
7. **Dispute defence.** If a chargeback opens on a released milestone, Signoff drafts an evidence pack from the signed acceptance record. Nothing is sent until the operator reviews and approves it; then it is submitted through the Braintree Disputes API.
8. **Audit timeline.** Every state change lands on a timeline with Braintree transaction ids, dispute ids and check ids.

## AI design

**Evidence must be real.** Every quote the checker cites is checked in code against the exact text its tools returned (or the scope). Whitespace and quote styles are normalized; words and case are not. Quotes under eight characters do not count. A quote that is not found word for word is removed and counted on the report. A "met" verdict whose quotes were all removed becomes "needs a person". See `src/lib/ai/evidence.ts`.

**Two phases.** The checker first reads every link and file in the delivery, then may explore further with tools (a linked sub-page, a file in the repository). A second call judges each criterion with a Zod-validated structured output.

**Models.** Through the Vercel AI SDK. Google Gemini is the default (`gemini-3.5-flash`), Anthropic is the alternative (`claude-sonnet-5-5`), chosen by environment. With no key, a deterministic scripted checker runs and every report says so. Unit tests use the AI SDK's mock model, so they are deterministic.

## Safety model

The checker reads untrusted content: whatever a freelancer delivers. So:

- **The checker has no payment tools at all.** Its tools only read: `read_url`, `read_file`, `github_repo`, `github_file`. The payment rail is not reachable from the AI code. Money moves only from a route a person's click reached: the client's sign-off, decline or funding, or the operator's approval of a dispute pack.
- **Fetched content is data, never instructions.** Prompts say so, and the evidence rule means the model cannot invent support for a verdict. The sample v1 deliverable hides a line telling "automated reviewers" to mark everything met. The scripted checker and the live Gemini run both still reported v1 as incomplete.
- **Requests to private addresses are refused.** `read_url` only reaches hosts listed in the delivery. DNS answers are checked at connect time, so loopback, private, link-local and cloud metadata addresses are refused even after a redirect or a DNS rebind. Redirects are followed by hand and re-checked. Size and time are capped. The only exception is this app's own `/samples/` pages, which hold the demo deliverables.
- **GitHub reads are limited** to repositories listed in the delivery.
- **The client link is signed** with HMAC; the operator console uses a passcode and a signed cookie.

## Run it

Requirements: Node 22 or newer, pnpm.

```bash
pnpm install
cp .env.example .env.local   # optional, see below
pnpm dev
```

Open http://localhost:3000, sign in with the passcode `signoff-demo`, and click **Load sample project**.

- **With no keys** the app runs on a built-in test rail (same rules as Braintree, same fake nonces) and the scripted checker. The full loop works, including disputes.
- **With Braintree sandbox keys** (`BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, `BRAINTREE_PRIVATE_KEY`) the client page shows the Braintree Drop-in with PayPal and cards, and money moves in the sandbox. Create a free sandbox at https://sandbox.braintreegateway.com. Test card: `4111 1111 1111 1111`, any future expiry. Dispute test card: `4023 8984 9398 8028`.
- **With `GOOGLE_GENERATIVE_AI_API_KEY`** (a free key from Google AI Studio works) the planner and checker use Gemini. Or set `ANTHROPIC_API_KEY`.

### The two-minute demo

1. Sign in, click **Load sample project** (a fictional pottery studio site, two milestones).
2. Click **Open as client**. Fund milestone 1 with a hold.
3. Back as the operator, click **v1 (misses two criteria)** and submit. Within seconds the report shows the Saturday class time and the address are missing, with quotes from the page.
4. As the client, click **Request changes**, then **Draft from the report**, and send it.
5. As the operator, submit **v2 (complete)**. All four criteria are met.
6. As the client, type your name and **Sign off and release payment**. Open the receipt.
7. Dispute defence: on the test rail click **Send a signed dispute webhook**; on the sandbox fund with the dispute card and click **Settle now and check for disputes**. Review the drafted pack and approve it.

The sample deliverables live in `public/samples/larkspur-v1` and `public/samples/larkspur-v2`.

### Webhooks

Point a Braintree sandbox webhook at `https://<your host>/api/webhooks/braintree` and subscribe to transaction and dispute events. Locally, without a public URL, **Reconcile with Braintree** pulls the same state.

## Tests

```bash
pnpm test        # unit and service tests: state machine, evidence rule, SSRF guard, full loop, mocked LLM, webhooks, disputes
pnpm test:e2e    # Playwright: operator and client run the whole loop in a browser on the test rail
pnpm typecheck && pnpm lint

# Live checks, opt in, read keys from the environment:
set -a; . ./.env.local; set +a
LIVE_AI=1 pnpm vitest run tests/unit/live-ai.test.ts
LIVE_BRAINTREE=1 pnpm vitest run tests/unit/live-braintree.test.ts
```

The mocked-model test has the model invent a quote and try to fetch an unlisted host; it checks that the quote is removed, the verdict drops to "needs a person" and the fetch is blocked.

## Architecture

```
src/
  app/                      Next.js App Router pages, server actions, webhook route
    projects/               operator console
    c/[id]/[token]/         client share page (Drop-in, decision panel)
    receipt/[id]/           printable receipt with the signed record
    api/webhooks/braintree  webhook endpoint
  lib/
    domain/milestone-machine.ts   the state machine every money move goes through
    payments/rail.ts              the one narrow PaymentRail interface
    payments/braintree-rail.ts    Braintree implementation
    payments/fake-rail.ts         in-process test rail with the same rules
    services/                     milestones, deliveries, disputes and webhooks, audit
    ai/planner.ts                 scope to milestones with verified citations
    ai/checker.ts                 the checker agent and the scripted fallback
    ai/evidence.ts                the word-for-word evidence rule
    ai/tools/                     read-only tools and the SSRF-guarded fetch
    db/schema.ts                  Drizzle schema on libSQL (SQLite file locally)
```

Every state change goes through `transition()` in the state machine with a compare-and-set on the current state, so two racing clicks cannot both move money. Braintree has no idempotency key, so a retried authorization with the same order id returns the existing hold, and a retried release or void that already went through returns the current transaction instead of failing.

Stack: Next.js 16, TypeScript strict, Tailwind with shadcn/ui, AG Grid Community (ledger and audit timeline), Drizzle on libSQL, Zod, Vercel AI SDK, Vitest, Playwright, GitHub Actions.

## Tools used

- **Braintree** (a PayPal service): Node SDK on the server, Drop-in in the browser.
- **Google Gemini** through the Vercel AI SDK (`@ai-sdk/google`), default model `gemini-3.5-flash`: drafts milestones from the scope, runs the checker agent's tool loop, judges criteria with structured output, drafts change requests.
- **Anthropic Claude** through `@ai-sdk/anthropic` as the alternative provider.
- **AG Grid Community** for the ledger and the audit timeline.

## Licence

MIT. See [LICENSE](LICENSE).

# Signoff

Pay on acceptance for freelance and agency work. The client's money is held up front, an AI checker tests the delivery against the acceptance criteria both sides agreed and shows its evidence, and the money is released only when the client signs off.

**Live demo:** https://signoff-iota.vercel.app. No sign-up: each visitor gets a private demo workspace, and every payment runs on the real Braintree sandbox. No real money moves.
**Health:** https://signoff-iota.vercel.app/api/health shows which payment rail and which AI model are live right now.

![The evidence report on the cheat sample: tampering found, and the hidden start time and address not accepted as proof](docs/screenshots/report-cheat.png)

A new project, started on 9 November 2026 during the PayPal AI Hackathon. MIT licensed.

## Why

Many clients will not send a deposit to a freelancer they just met. Freelancers chase invoices for work that is already done: in a 2015 Freelancers Union survey of 5,358 US freelancers, 71% had trouble getting paid at some point in their career, and half had trouble in the past year ([The Costs of Nonpayment](https://onlabor.org/wp-content/uploads/2017/05/FU_NonpaymentReport_r3.pdf)). A payment authorization already solves the first half: it holds money without taking it. What is missing is a fair, fast way to decide that the work is accepted. That is the AI part.

## Payment rail: Braintree, a PayPal service

Signoff moves money through **Braintree**, which is part of the PayPal developer platform. The official rules, section 4, say so:

> "This includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet, Simility, Swift Financial, and others."

PayPal does not open accounts in Pakistan, where the builder lives ([Profit, January 2024](https://profit.pakistantoday.com.pk/2024/01/06/fact-check-paypal-is-not-coming-to-pakistan/): users "can simply not create an account on PayPal from Pakistan"), so PayPal REST sandbox credentials were not available. The Braintree sandbox is. Clients pay with their PayPal account through Braintree's PayPal integration, or with a card.

**Run against the live Braintree sandbox on 10 November 2026.** The hosted demo runs every payment on the sandbox (`/api/health` reports `"rail":"sandbox"`). What was run, and the result:

| Case | Result |
|---|---|
| Client token for the Drop-in | Passed |
| Hold with a card, release, settle (sandbox settle helper) | Passed |
| Partial release | Passed |
| Void | Passed |
| A retried hold with the same order id returns the first hold; a retried release or void returns the transaction | Passed |
| Processor decline (`fake-processor-declined-visa-nonce`) | Passed: refused with Braintree's message |
| Webhook signature check with the real keys; a tampered signature | Passed: 200 and 400 on the hosted endpoint |
| Dispute card `4023 8984 9398 8028`: settle, chargeback opens, evidence added and finalized | Passed: Braintree reports the dispute as `disputed` with the evidence attached |
| Real Drop-in, card typed into Braintree's frames, in a browser on the host | Passed, in the production browser test |
| Full loop on the host: hold, cheat caught, change request, passing delivery, sign-off and release, receipt, settle, dispute by reconcile and then by Braintree's own `dispute_opened` webhook, evidence approved and submitted | Passed |
| PayPal through Braintree | Not available: see below |

**PayPal in this sandbox.** The Drop-in's PayPal option fails with Braintree's error `PAYPAL_SANDBOX_ACCOUNT_NOT_LINKED`: "A linked PayPal Sandbox account is required to use PayPal Checkout in Sandbox." The builder cannot open a PayPal account, so none can be linked, and the server refuses Braintree's PayPal test nonce with "Payment instrument type is not accepted by this merchant account". The hosted demo therefore offers cards only, says why next to the form, and the PayPal code path stays behind `BRAINTREE_PAYPAL_ENABLED`. Installs with no keys, and CI, run on a built-in test rail (`src/lib/payments/fake-rail.ts`) with the same rules as Braintree: void only while authorized or submitted, release only while authorized, settle only after release, holds expire (7 days for cards, 29 for PayPal), and Braintree's documented fake nonces are accepted.

| Product step | Braintree mechanism |
|---|---|
| Client funds a milestone | `transaction.sale` with `submitForSettlement: false`: an authorization, money held, nothing charged |
| Hold expiry | `authorizationExpiresAt` on the transaction, shown to both sides, with a warning in the last day; reconcile marks it expired |
| Client accepts | `transaction.submitForSettlement` (full release) |
| Partial release | `submitForSettlement` with a smaller amount; the rest of the hold drops off |
| Client declines | `transaction.void`, only after re-reading that the transaction is still `authorized` |
| Payment form | Braintree Drop-in with cards; PayPal (`intent: authorize`) when a linked PayPal sandbox account allows it |
| Webhooks | `webhookNotification.parse` verifies the signature; events are deduplicated; the transaction or dispute is re-read from Braintree |
| Reconcile | `transaction.find` and `dispute.search` compare local state with Braintree; mismatches are flagged, never papered over |
| Dispute defence | `dispute.find`, `dispute.addTextEvidence` and `dispute.finalize`, after the operator approves the pack |

## The loop

Two people use Signoff: the **operator** (the freelancer or agency doing the work, who runs the app) and the **client** (who pays, and opens a link with no account).

1. **Scope to milestones.** The operator pastes the scope. The AI drafts milestones with two to five checkable acceptance criteria each. Every criterion carries the exact sentence from the scope that justifies it, and the code checks that sentence is really in the scope.
2. **Hold.** The client opens a signed link (no account) and funds a milestone by card through the Braintree Drop-in (PayPal too, where a linked PayPal sandbox account allows it). The page says the money is held, not charged, and when the hold expires.
3. **Deliver.** The operator submits links (a staging URL, a public GitHub repository, a PDF), notes and files. Files are marked either as the deliverable itself or as the freelancer's notes.
4. **Check.** The checker reads the delivery with read-only tools and marks each criterion met, not met or needs a person, quoting what it read. The page shows live progress.
5. **Decide.** The client reads the evidence report and accepts and releases (typing their name), requests changes (the AI drafts the note from the failing criteria), or declines (the hold is voided).
6. **Record.** Sign-off writes an acceptance record (criteria, verdicts, evidence, signer, timestamps), signed with HMAC-SHA256 over canonical JSON, and a printable receipt.
7. **Dispute defence.** If a chargeback opens on a released milestone, Signoff drafts evidence from the signed record. Nothing is sent until the operator approves it; then it goes to Braintree's Disputes API. The dispute screen shows the whole story in one view.
8. **Audit timeline.** Every state change lands on a timeline (AG Grid) with Braintree transaction ids, dispute ids and check ids.

### The two-minute demo

Open the live demo and click **Try the live demo**. You get a private workspace with the sample project, a fictional pottery studio site. You play both sides.

1. Open the project, then **Open as client**. Fund milestone 1 with a hold through the Braintree Drop-in: copy the dispute test card `4023 8984 9398 8028` shown next to the form, any future expiry, any 3-digit code, so step 6 has a real chargeback. In a hurry, **Quick hold with the dispute card** makes the same sandbox hold from the server without typing.
2. As the operator, pick **v1 with a cheat** and submit. The report flags text hidden from visitors, the requirement pasted onto the page and an instruction aimed at the AI, and the hidden start time and address are not accepted as proof.
3. As the client, **Request changes**, **Draft from the report**, send.
4. As the operator, submit **v2, complete**. All four criteria are met, with quotes.
5. As the client, type a name and **Sign off and release payment**. Open the receipt.
6. As the operator, click **Settle now and check for disputes**. Braintree's sandbox settles the transaction and the dispute card opens a chargeback; it appears within a few seconds, and Braintree's webhook follows. Review the drafted evidence and approve it. Braintree marks the dispute `disputed` once evidence is finalized; the sandbox does not go on to rule won or lost. On an install with no keys, **Open a chargeback with a signed webhook** plays the same steps on the test rail.

If a report says it was checked by the scripted checker, the day's AI budget is used up or the model did not answer. The report says which, and when the limit resets. The scripted checker matches key words and is more cautious: it sends more criteria to a person.

If the demo says your network has started too many workspaces today, judges on one office address share that limit (25 a day). Open the demo in a browser you used before, or run it locally with no keys (see "Run it").

## The evidence rule

Every quote the checker cites is verified in code (`src/lib/ai/evidence.ts`) and survives only if:

- it is at least 20 characters, so a lone word cannot prove a criterion;
- it is not the requirement itself: quoting the criterion back does not prove it was met;
- it appears word for word in text a visitor can see on a delivered page, in a delivered file or in the repository. The scope is never a source, and page titles and tool headers are never quotable;
- it is not hidden from visitors (see below);
- it shares at least one key word with the criterion.

And a "met" needs its quotes, together, to contain the specific numbers and names the criterion states. For "the Saturday class with its start time of 10:00", a quote must contain both "Saturday" and "10:00"; "Saturday wheel-throwing (schedule coming soon)" is not enough. A file the freelancer uploads can prove what a document says, but never what a live page shows: criteria about a page, site or form need a link.

**What counts as hidden.** Signoff reads inline styles, `<style>` blocks and same-origin linked stylesheets, with CSS comments and escapes resolved. It matches tag, class, id, attribute and compound selectors with descendant and child combinators. These never count as visible text, and each family has an evaluation case:

| Hiding method | Evaluation case |
|---|---|
| `display:none`, the `hidden` attribute | `landing-cheat` |
| a linked stylesheet: clipping, off-screen positioning, negative text indent, zero font size, zero opacity, text coloured like its background | `landing-css-cheat` |
| image alt text, `aria-label`, a closed `<details>` or `<dialog>`, `<canvas>` content, transparent text, text under 4 pixels | `landing-hidden-tricks` |
| `<video>`, `<noembed>`, `<noframes>`, `scale(0)`, a 1-pixel box | unit tests in `tests/unit/review-2.test.ts` and `tests/unit/css-hidden.test.ts` |

Uploaded HTML files go through the same reader.

Removed quotes are kept and shown on the report with the reason. A "met" with no surviving quote becomes "needs a person". Text from the freelancer's own notes is shown as a claim, and a "met" resting only on notes goes to a person. Hidden text, requirement sentences pasted onto the page, and instructions aimed at the checker are listed on the report as tampering. The instruction detector undoes look-alike letters, zero-width characters and width variants before matching.

## Safety model

- **The checker has no payment tools.** Its tools only read: `read_url`, `read_file`, `github_repo`, `github_file`. No file under `src/lib/ai/` imports the payment rail or a Braintree SDK, and a lint rule (`no-restricted-imports` in `eslint.config.mjs`) fails `pnpm lint` and CI if one does. The functions that move money take the rail as an argument, and the checker is never given one. Money moves only from a request a person's click made: the client funding, signing off or declining, or the operator approving dispute evidence.
- **What it reads is data, not instructions.** The prompts say so, document boundaries are escaped so a page cannot fake a new document, and the evidence rule means the model cannot invent support for a verdict.
- **No requests to private addresses.** `read_url` reaches only hosts listed in the delivery. IP literals, including bracketed IPv6 and IPv4-mapped forms, are checked before connecting, and DNS answers are checked at connect time, so loopback, private, link-local, cloud metadata, NAT64 and 6to4 addresses are refused even after a redirect or a DNS rebind. Redirects are followed by hand and re-checked. Size and time are capped.
- **GitHub reads** are limited to public repositories listed in the delivery. A server token is sent only after the repository is confirmed public without it.
- **Money moves once.** Releasing and voiding first claim the milestone with a compare-and-set (`releasing`, `voiding`), then call Braintree, then settle the claim, so a sign-off and a decline racing each other cannot both reach Braintree. The signed record is written inside the claim.
- **Secrets.** A production server refuses to start with the development session secret or the public demo passcode. Client links are signed with a per-project secret the operator can rotate to revoke old links.
- **Caps.** Daily limits on AI checks, AI drafts, AI change notes and page reads, per demo workspace, per visitor address (demo workspaces from one address share one budget of 120 AI checks a day, and one address can start 25 workspaces a day, so judges in one office are not locked out), and for the whole server (400 AI checks a day). The last fifth of the day's AI checks is kept for workspaces that have not had one yet, so a first-time visitor is the last to lose the live model. Over a cap, or when the model fails, the scripted checker runs and the report says why and when the limit resets (00:00 UTC). Addresses are only stored as a keyed hash.

## Who holds the money

The hold sits in the freelancer's own Braintree account, so a freelancer could still capture it from the Braintree control panel without the client's sign-off. Signoff does not make cheating impossible. What it gives both sides is an agreed test of done, a record they both signed, and evidence ready for a dispute if either side breaks the deal. A production version would keep the right to capture on a neutral platform account, such as PayPal's marketplace and platform payments, so neither side can move the money alone.

## Agent access over MCP

A freelancer's coding agent can work its side of one project through an MCP endpoint at `/api/mcp` (Streamable HTTP, JSON responses, stateless). The operator creates a token on the project page under **Agent access** and can revoke it there at any time.

| Tool | What it does |
|---|---|
| `list_milestones` | Milestones with their acceptance criteria, amount, state, any change request, and whether a delivery can be submitted |
| `submit_delivery` | Hands in up to 5 links and notes for a funded milestone; the checker starts at once |
| `read_evidence_report` | The checker's verdicts, surviving quotes, removed quotes with reasons and tampering found, or its progress while it runs |

There are no payment tools: an agent can get you paid, by handing in work the client then accepts, but it cannot pay or release money itself. It cannot fund, release, decline or touch disputes. A token reaches one project only, is stored as a SHA-256 hash, stops working when revoked or when its demo workspace is deleted after 30 days unused, and its deliveries go through the same checker, caps and audit timeline as the web form.

```bash
claude mcp add --transport http signoff https://signoff-iota.vercel.app/api/mcp \
  --header "Authorization: Bearer so_agent_..."
# then, in the agent: "List my Signoff milestones, submit https://staging.example.com
#  for the landing page, and tell me what the evidence report says."
```

## AI

Through the Vercel AI SDK. **Google Gemini** is the default: `gemini-3.5-flash-lite`, then `gemini-3.5-flash` and `gemini-3.1-flash-lite` when a model is rate-limited. **Anthropic Claude** (`claude-sonnet-5-5`, set `AI_PROVIDER=anthropic`) is supported but has not been evaluated: no Anthropic key was available while building. With no key, a deterministic scripted checker runs, labelled on every report.

A check reads every link and file once in parallel, lets the model explore further with tools only when the delivery has more to read (a repository, or pages linking to other delivery pages), then judges all criteria in one structured call. One call per check keeps a public demo inside a free-tier quota.

### Evaluation

`pnpm eval` runs 8 deliveries and 31 criteria with known right answers: the two sample versions, the cheat version, a version that hides the missing facts with a linked stylesheet, a version that hides them with alt text, closed elements, a canvas, transparent and tiny text, a prices page with one wrong price and a subjective criterion, a handover PDF uploaded as a file, and this repository on GitHub.

**Latest, 9 November 2026, `google/gemini-3.5-flash-lite`: 31 of 31 correct, 0 wrong, 0 sent to a person.** For comparison, the scripted checker with no AI gets 22 of the 28 criteria that need no network right (all but the three GitHub ones), 4 wrong and 2 sent to a person. Full table and timings: [docs/eval-latest.md](docs/eval-latest.md). The sample loop ran five times in a row with v1 failing the same two criteria and v2 passing every time, at about 2 seconds a check.

## Run it

Requirements: Node 22 or newer, pnpm.

```bash
pnpm install
cp .env.example .env.local   # optional
pnpm dev
```

Open http://localhost:3000. Locally, sign in with the passcode `signoff-demo` and click **Load sample project**, or set `DEMO_MODE=true` to get the public-demo flow. Data goes to `./data/signoff.db`, and the app creates its tables on first run.

- **With no keys** the app runs on the test rail and the scripted checker. The whole loop works, including disputes.
- **With Braintree sandbox keys** (`BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, `BRAINTREE_PRIVATE_KEY`) the client page shows the Braintree Drop-in with cards, Braintree's test cards to copy, and quick server-side holds (set `BRAINTREE_PAYPAL_ENABLED=true` only if your sandbox has a linked PayPal sandbox account). Create a free sandbox at https://sandbox.braintreegateway.com. Test card `4111 1111 1111 1111`; dispute test card `4023 8984 9398 8028`.
- **With `GOOGLE_GENERATIVE_AI_API_KEY`** (a free key from Google AI Studio works) the planner and checker use Gemini. The free tier may use prompts to improve Google's products, so the public demo asks visitors not to paste real client documents.

Hosting: [docs/deploy.md](docs/deploy.md) has the environment variables and the steps for Vercel with a hosted libSQL database, and where to point the Braintree webhook.

## Tests

```bash
pnpm test        # 164 tests pass; the 11 live tests are skipped unless you opt in. Includes tests/unit/review-1.test.ts and review-2.test.ts, one test per review finding
pnpm test:e2e    # Playwright, 4 tests: the whole loop in demo mode, workspace isolation, the new-project flow, a coding agent over MCP, and no sideways scroll at 390 px
pnpm typecheck && pnpm lint && pnpm build
pnpm eval        # the evaluation set, with the model in your environment

# Live checks, opt in:
set -a; . ./.env.local; set +a
LIVE_AI=1 pnpm vitest run tests/unit/live-ai.test.ts
LIVE_BRAINTREE=1 pnpm vitest run tests/unit/live-braintree.test.ts
E2E_BASE_URL=https://signoff-iota.vercel.app pnpm test:e2e
```

## Architecture

![Signoff architecture: the checker reads with read-only tools and never pays; Braintree holds, captures, voids and answers disputes only after a person clicks](docs/architecture.png)

The checker reads and never pays. Money moves on Braintree only after a person clicks.

```
src/
  app/                      pages, server actions, the webhook route, /api/health
    projects/               operator console
    c/[id]/[token]/         client page (Drop-in, decision panel)
    receipt/[id]/           printable receipt with the signed record
  lib/
    domain/milestone-machine.ts   the state machine every money move goes through, with claim states
    payments/rail.ts              the one narrow PaymentRail interface
    payments/braintree-rail.ts    Braintree
    payments/fake-rail.ts         the test rail, stored in the database
    services/                     milestones, deliveries, disputes and webhooks, workspaces, usage caps, agent tokens, audit
    mcp/server.ts                 the MCP tools for a freelancer's coding agent
    ai/planner.ts                 scope to milestones with verified citations
    ai/checker.ts                 the checker, tampering findings, the scripted fallback
    ai/evidence.ts                the evidence rule
    ai/tools/                     read-only tools, HTML to visible text, the private-address guard
    eval/cases.ts                 the evaluation set
```

Stack: Next.js 16, TypeScript strict, Tailwind with shadcn/ui, AG Grid Community (the ledger and the audit timeline, with a custom theme, status and actor cell renderers, quick filter and pagination), Drizzle on libSQL (Turso when hosted), Zod, Vercel AI SDK, Vitest, Playwright, GitHub Actions.

The cheat pages in `public/samples/` are test fixtures: they hide text and address an instruction to Signoff's own checker on purpose, to show that it is caught. They are not aimed at any other system.

## Known limits

- PayPal through Braintree is not shown working: the sandbox needs a linked PayPal sandbox account, which the builder cannot have. Cards work end to end.
- After evidence is finalized, the sandbox leaves the dispute `disputed`; a won or lost outcome is not shown on the live sandbox. The test rail shows the outcome step.
- Braintree's control panel offers webhook subscriptions for disputes only in this sandbox; transaction status changes are picked up by reconcile, which runs on every money action and from the **Reconcile with Braintree** button.
- Hidden text set by JavaScript (including text a script removes on load), by stylesheets from another origin or `@import`, by pseudo-class or sibling selectors, by text over an image or gradient, or by stacking one element over another is not detected, and neither is a server that shows the checker a different page from visitors; a headless browser would catch most of these.
- The instruction detector is a pattern list: it catches common phrasings and disguises, not every paraphrase. The evidence rule, not the detector, is what stops a steered model from passing work.
- Client links do not expire; the operator can replace a link to revoke the old one.
- The test rail's dispute outcome follows Braintree's sandbox convention: evidence containing `compelling_evidence` wins. A real dispute is decided by the card issuer.
- The Gemini free tier allows 15 requests a minute and 500 a day on each lite model, and 20 a day on `gemini-3.5-flash`. A very busy demo falls back to the scripted checker and says so.
- Login attempts are limited per address per day; there is no account lockout beyond that.

## Licence

MIT. See [LICENSE](LICENSE).

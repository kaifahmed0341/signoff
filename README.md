# Signoff

Proof of delivery for services. A tracking number wins a chargeback for physical goods, but freelance and agency work has no tracking number, so a client who accepted the work and later disputes the charge leaves the freelancer with little to show the bank. Signoff builds that record: what both sides agreed, what was delivered, what an AI checker found with quotes the code verified, and the client's signature, then answers the chargeback with it.

**For** freelancers and small agencies who work off-platform, with clients who will not pay a deposit up front.

**Live demo:** https://signoff-iota.vercel.app. No sign-up. Each visitor gets a private workspace, and every payment runs on the real Braintree sandbox. No real money moves.

> **Judge path, about four minutes.** You play both people.
>
> 1. Click **Try the live demo**, open the sample project, then **Open as client**. Expect a client page that says the money is held, not charged.
> 2. Fund milestone 1: type `4111 1111 1111 1111` in the Braintree form, any future expiry and any 3-digit code, or click **Quick hold with the test card**. Expect "Your money is held", the card shown as Visa ending 1111, and the date the hold ends.
> 3. Back as the freelancer, choose **v1 with a cheat** and **Submit delivery for checking**. Expect a report in a few seconds: text hidden from visitors, an instruction aimed at the AI and a pasted requirement listed as tampering, and the hidden start time and address not accepted as proof.
> 4. As the client: **Request changes**, **Draft from the report**, **Send change request**.
> 5. As the freelancer: **v2, complete**, submit. Expect 4 of 4 met, each with a quote found word for word on the page.
> 6. As the client: type a name, **Sign off and release payment**, open the receipt. Expect a signed record marked verified.
> 7. As the freelancer: **Sandbox: simulate the client's bank disputing this payment**. Expect a chargeback within a minute (reload if it has not appeared), with an evidence pack drafted from the signed record. Leave **Win** selected, click **Approve and submit evidence to Braintree**, wait about 30 seconds and click **Reconcile with Braintree**. Expect "Outcome: won", labelled as decided by Braintree's sandbox test value, not by a bank.
> 8. Scroll to **Money by milestone**. The AG Grid and chart show what was held, released and disputed, and the audit timeline lists every Braintree transaction and dispute id. Click a milestone to filter the timeline to it.

The problem, in two numbers: 56 percent of US small businesses are owed money on unpaid invoices ([Intuit QuickBooks, 2025 Small Business Late Payments Report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2025/), survey of 2,487 US small businesses, January 2025). And 21 percent of merchants' chargebacks are first-party fraud, customers disputing purchases they made ([Datos Insights for Visa Acceptance, 2025](https://www.visaacceptance.com/content/dam/documents/en/hidden-cost-first-party-fraud.pdf), survey of 840 merchants). The hold answers the first. The signed record answers the second.

### Why this is different

Others in this contest hold money, have an AI check the work and capture on approval. Signoff goes deeper on the proof and carries it through to the dispute:

1. Every "met" needs a quote the code finds word for word in what a visitor can see, carrying the criterion's numbers and names. When the code downgrades a verdict, the report says why. [`evidence.ts`](src/lib/ai/evidence.ts)
2. Measured: 79 of 80 criteria right on 20 deliveries, and 77 of 77 on the 19 a model answered. Prompt injection counted apart: 33 of 34 on 9 deliveries. A keyword checker alone gets 53 of 77. [`docs/eval-latest.md`](docs/eval-latest.md)
3. Hidden text is read from inline styles, style blocks, linked stylesheets, alt text, closed elements and more, with an eval case for each method. [`css-hidden.ts`](src/lib/ai/tools/css-hidden.ts)
4. A real Braintree sandbox chargeback after sign-off, answered through the Disputes API with evidence drafted from the signed record once the freelancer approves it, through to the outcome. [`disputes.ts`](src/lib/services/disputes.ts)
5. Lines of taste such as "modern" or "mobile friendly" stay in the signed record as criteria a person judges, never dropped. [`planner.ts`](src/lib/ai/planner.ts)
6. A coding agent can hand in work over MCP but has no payment tools, and a lint rule keeps the AI code away from the payment rail. [`server.ts`](src/lib/mcp/server.ts), [`eslint.config.mjs`](eslint.config.mjs)

**Braintree, a PayPal service.** Signoff runs on Braintree, PayPal's merchant platform, which the contest rules list as a PayPal service. I build from Pakistan, where PayPal does not open accounts, so the Braintree sandbox was the PayPal service I could use end to end, and it gives this product what it needs: authorizations that hold money without charging, partial capture, voids and a Disputes API. The PayPal option in the Braintree form is built behind a flag and needs a linked PayPal sandbox account, which I cannot open, so the demo takes cards.

**AG Grid.** The money view and the audit timeline use AG Grid Community and AG Charts Community, with no enterprise features and no licence key.

**Honest limits.** The hold sits in the freelancer's own Braintree account, so the freelancer could still capture it from the Braintree control panel without the client's sign-off. Card holds end after 7 days; Braintree cannot extend one, so the client page warns when a hold ends before the due date and offers a renewal. The production fix for both is a neutral platform account that holds the right to capture, so neither side can move the money alone.

![The evidence report on the cheat sample: tampering found, and the hidden start time and address not accepted as proof](docs/screenshots/report-cheat.png)

A new project, started on 9 November 2026 during the PayPal AI Hackathon. MIT licensed. `/api/health` on the live demo shows which payment rail and AI model are running.

## Details

### The loop

Two people use Signoff: the **freelancer** (or agency) doing the work, who runs the app, and the **client**, who pays and opens a link with no account.

1. **Scope to milestones.** The freelancer pastes the scope. The AI drafts milestones with checkable acceptance criteria. Every criterion carries the exact sentence from the scope that justifies it, and the code checks that sentence is in the scope. Lines about taste or feel become criteria marked "For a person to judge", and the code adds back any the model leaves out.
2. **Hold.** The client opens a signed link and funds a milestone by card through the Braintree Drop-in. Only a transaction Braintree returns as authorized counts as a hold; anything charged at once is voided and the page says so. The page shows when the hold ends.
3. **Deliver.** The freelancer submits links (a staging URL, a public GitHub repository), notes and files. Files are marked either as the deliverable or as the freelancer's notes.
4. **Check.** The checker reads the delivery with read-only tools and marks each criterion met, not met or needs a person, quoting what it read. The page shows live progress.
5. **Decide.** The client reads the evidence report and signs off (typing their name, with the option to release part of the hold), requests changes (the AI drafts the note from the failing criteria), or declines (the hold is voided).
6. **Record.** Sign-off writes an acceptance record (criteria, verdicts, evidence, signer, timestamps), signed with HMAC-SHA256 over canonical JSON, and a printable receipt.
7. **Dispute.** If a chargeback opens on a released milestone, Signoff drafts evidence from the signed record. Nothing is sent until the freelancer approves it; then it goes to Braintree's Disputes API. The client page says when a chargeback is open, and sign-off is refused while one is.
8. **Audit.** Every state change lands on the audit timeline with its Braintree transaction, dispute and check ids.

### Payments on Braintree

| Product step | Braintree mechanism |
|---|---|
| Client funds a milestone | `transaction.sale` with `submitForSettlement: false`: an authorization, money held, nothing charged. A transaction that comes back in any status other than `authorized` is voided |
| Hold expiry | `authorizationExpiresAt` shown to both sides, with a warning when it falls before the due date; renewal places a new authorization, then voids the old one |
| Client accepts | `transaction.submitForSettlement` (full release) |
| Partial release | `submitForSettlement` with a smaller amount; the rest of the hold drops off |
| Client declines | `transaction.void`, only after re-reading that the transaction is still `authorized` |
| Payment form | Braintree Drop-in with cards; PayPal (`intent: authorize`) behind `BRAINTREE_PAYPAL_ENABLED`, for a sandbox with a linked PayPal sandbox account |
| Card label | Read from Braintree's `paymentInstrumentType`, so a card reads as its brand and last four digits |
| Webhooks | `webhookNotification.parse` verifies the signature; events are deduplicated; the transaction or dispute is re-read from Braintree |
| Reconcile | `transaction.find` and `dispute.search` compare local state with Braintree; mismatches are flagged, never papered over |
| Dispute defence | `dispute.find`, `dispute.addTextEvidence` and `dispute.finalize`, after the freelancer approves the pack |

**Run against the live Braintree sandbox on 10 November 2026:** client token; hold with a card, release and settle; partial release; void; retried holds, releases and voids returning the first result; a processor decline refused with Braintree's message; webhook signatures checked with the real keys, with a tampered one refused; the real Drop-in with a card typed into Braintree's frames, in the production browser test; and a chargeback after sign-off answered with evidence and ruled won with one sandbox test value and lost with the other. That is 9 of 10 live cases passing; the tenth is PayPal, which this merchant account does not accept. The live tests are in [`tests/unit/live-braintree.test.ts`](tests/unit/live-braintree.test.ts).

**PayPal in this sandbox.** The Drop-in's PayPal option fails with Braintree's error `PAYPAL_SANDBOX_ACCOUNT_NOT_LINKED`: "A linked PayPal Sandbox account is required to use PayPal Checkout in Sandbox." The server also refuses Braintree's PayPal test nonce with "Payment instrument type is not accepted by this merchant account". So the hosted demo offers cards only and says why next to the form. Installs with no keys, and CI, run on a built-in test rail ([`fake-rail.ts`](src/lib/payments/fake-rail.ts)) with the same rules as Braintree.

**The sandbox chargeback.** Braintree's sandbox opens a chargeback only for its dispute test card, and it charges that card at once, so it cannot be held. After sign-off, the sandbox button makes a stand-in charge with that card and ties its real Braintree dispute to the signed milestone. The page labels it as a sandbox simulation. The sandbox then rules the dispute from a test value sent as its own evidence item; the page says the outcome came from that value, not from a bank. A real dispute is decided by the card issuer.

### The evidence rule

Every quote the checker cites is verified in code ([`evidence.ts`](src/lib/ai/evidence.ts)) and survives only if:

- it is at least 20 characters, or, when the criterion names specific values, at least 8 characters and two words that show every one of them ("Two-hour hire: $35" proves "lists two-hour hire at $35"; a lone word never counts);
- it is not the requirement itself;
- it appears word for word in text a visitor can see on a delivered page, in a delivered file or in the repository. The scope is never a source, and page titles are never quotable;
- it, or the heading just above it, shares a key word with the criterion.

A "met" needs its quotes, together, to contain the numbers and names the criterion states. For "the Saturday class with its start time of 10:00", a quote must contain both "Saturday" and "10:00"; "Saturday sourdough (schedule coming soon)" is not enough. A file the freelancer uploads can prove what a document says, but not what a live page shows.

When the rule turns a "met" into "needs a person", the report replaces the model's sentence with the reason, so a client never reads an approving sentence above a downgraded verdict. On a "not met", a quote is kept only when it bears on the criterion, such as a different phone number, and the report labels it as what the delivery shows, not as proof. Removed quotes are kept and shown with the reason. Text from the freelancer's notes is shown as a claim, and a "met" resting only on notes goes to a person. Hidden text, requirement sentences pasted onto the page and instructions aimed at the checker are listed as tampering; the instruction detector undoes look-alike letters, zero-width characters and width variants first.

**What counts as hidden.** Signoff reads inline styles, `<style>` blocks and same-origin linked stylesheets, with CSS comments and escapes resolved, and matches tag, class, id, attribute and compound selectors with descendant and child combinators. Uploaded HTML files go through the same reader.

| Hiding method | Evaluation case |
|---|---|
| `display:none`, the `hidden` attribute | `landing-cheat` |
| a linked stylesheet: clipping, off-screen positioning, negative text indent, zero font size, zero opacity, text coloured like its background | `landing-css-cheat` |
| image alt text, `aria-label`, a closed `<details>` or `<dialog>`, `<canvas>` content, transparent text, text under 4 pixels | `landing-hidden-tricks` |
| `visibility:hidden`, `scale(0)`, a 1-pixel box, `clip-path`, `<video>` fallback, `<noembed>`, `<template>`, an HTML comment | `hidden-more` |

### Evaluation

`pnpm eval` runs 20 deliveries and 80 criteria with known right answers, then the scripted keyword checker on the same cases. The set covers the sample's versions; prompt injection in six forms (a visible note, look-alike letters, a forged document boundary with a fake system message, an instruction in Spanish, a notes file and a Markdown file) plus the three sample pages that carry one; each hiding method; a swapped phone number and date; a wrong price; a hollow six-page PDF; lines of taste; an honestly complete page; an honestly partial one; a handover PDF; and this repository on GitHub. The twelve deliveries added on 10 November are in other trades, so the set does not lean on the sample.

**Latest, 10 November 2026, with `google/gemini-3.5-flash-lite` first in the model chain.** Rate limits moved some checks down the chain, as they do in the app: 14 were answered by `gemini-3.5-flash-lite`, 4 by `gemini-3.5-flash`, 1 by `gemini-3.1-flash-lite`, and 1 by the scripted checker after every model was rate-limited.

| | Result |
|---|---|
| All criteria | 79 of 80 correct on 20 deliveries. The 19 deliveries a model answered: 77 of 77. The miss is the scripted checker's, on `inj-notes`, where it marked the headline not met |
| Prompt injection, counted apart | 33 of 34 correct on 9 deliveries, the miss being that same scripted answer; the report flagged the instruction on 8 of 9. The Spanish one is not flagged, because the detector's patterns are English; the evidence rule still kept every verdict right |
| Keyword baseline, no AI | 53 of the 77 criteria that need no network correct, 20 wrong, 4 sent to a person |

An earlier full run the same day, before the sample was renamed, scored 80 of 80, with 34 of 34 on injection.

While building the set, two misses came from the evidence rule, not the model: a 17-character price line was dropped as too short, and a list of channels quoted without its heading failed the key-word test. Both are fixed in the rule above, with tests. Full table, timings and the model that answered each case: [`docs/eval-latest.md`](docs/eval-latest.md). I wrote the fixtures, so read the set as a regression suite, not an independent benchmark.

### AG Grid and AG Charts

![Money by milestone in AG Grid with a totals row, the AG Charts chart, and the filterable audit timeline, on the test rail](docs/screenshots/audit-grid.png)

- **Money by milestone** ([`money-view.tsx`](src/components/app/money-view.tsx)): one row per milestone with agreed, held, released, voided or expired and disputed amounts, the Braintree transaction, dispute id and status, and a pinned totals row. Clicking a milestone narrows the timeline to it through AG Grid's filter model.
- **Chart**: AG Charts Community, money held, released, voided and disputed per milestone.
- **Audit timeline** ([`timeline.tsx`](src/components/app/timeline.tsx)): sortable columns, a date filter on the time, text filters, a Kind column with quick chips, transaction and dispute ids as their own columns, a search that covers ids, and the whole trail as CSV for a dispute file. At 390 px it collapses to one column with the time and ids under each message.
- **Ledger** on the dashboard: every milestone across projects, with a quick filter.

### Safety model

- **The checker has no payment tools.** Its tools only read: `read_url`, `read_file`, `github_repo`, `github_file`. No file under `src/lib/ai/` imports the payment rail or a Braintree SDK, and a lint rule (`no-restricted-imports` in `eslint.config.mjs`) fails `pnpm lint` and CI if one does. Money moves only from a request a person's click made.
- **What it reads is data, not instructions.** The prompts say so, document boundaries are escaped so a page cannot fake a new document, and the evidence rule means the model cannot invent support for a verdict.
- **No requests to private addresses.** `read_url` reaches only hosts listed in the delivery. IP literals are checked before connecting and DNS answers at connect time, so loopback, private, link-local, cloud metadata, NAT64 and 6to4 addresses are refused even after a redirect or a DNS rebind.
- **GitHub reads** are limited to public repositories listed in the delivery.
- **Money moves once.** Releasing and voiding first claim the milestone with a compare-and-set, then call Braintree, then settle the claim, so a sign-off and a decline racing each other cannot both reach Braintree.
- **Secrets.** A production server refuses to start with the development session secret or the public demo passcode. Client links are signed with a per-project secret the freelancer can rotate.
- **Caps.** Daily limits on AI checks, drafts, change notes and page reads, per demo workspace, per visitor address (120 AI checks a day shared by one address, 25 workspaces a day from one address) and for the whole server (400 AI checks a day). The last fifth of the day's AI checks is kept for workspaces that have not had one yet. Over a cap, or when the model fails, the scripted checker runs and the report says why and when the limit resets (00:00 UTC). Addresses are stored only as a keyed hash.
- **Stored sample results.** So the demo keeps working through the judging period, the three bundled sample deliveries have the live model's own result stored ([`stored-results.ts`](src/lib/ai/stored-results.ts)). When the live model is out of quota, and only for the exact sample link on the sample project, the checker replays that result, checks its quotes against the page again, and labels the report as a stored result with its date. A delivery of your own never gets a stored result.

### Agent access over MCP

A freelancer's coding agent can work its side of one project through an MCP endpoint at `/api/mcp` (Streamable HTTP, stateless). The freelancer creates a token on the project page under **Agent access** and can revoke it there.

| Tool | What it does |
|---|---|
| `list_milestones` | Milestones with their criteria, amount, state, any change request, and whether a delivery can be submitted |
| `submit_delivery` | Hands in up to 5 links and notes for a funded milestone; the checker starts at once |
| `read_evidence_report` | The verdicts, surviving quotes, removed quotes with reasons and tampering found, or progress while it runs |

There are no payment tools: an agent can get you paid, by handing in work the client then accepts, but it cannot fund, release, decline or touch disputes. A token reaches one project only, is stored as a SHA-256 hash, and its deliveries go through the same checker, caps and audit timeline as the web form.

```bash
claude mcp add --transport http signoff https://signoff-iota.vercel.app/api/mcp \
  --header "Authorization: Bearer so_agent_..."
```

### AI

Through the Vercel AI SDK. **Google Gemini** is the default: `gemini-3.5-flash-lite`, then `gemini-3.5-flash` and `gemini-3.1-flash-lite` when a model is rate-limited. **Anthropic Claude** (`claude-sonnet-5-5`, `AI_PROVIDER=anthropic`) is supported but not evaluated: I had no Anthropic key while building. With no key, a scripted checker runs, labelled on every report. A check reads every link and file once in parallel, explores further with tools only when the delivery has more to read, then judges all criteria in one structured call, which keeps a public demo inside a free-tier quota.

### Run it

Requirements: Node 22 or newer, pnpm.

```bash
pnpm install
cp .env.example .env.local   # optional
pnpm dev
```

Open http://localhost:3000, sign in with the passcode `signoff-demo` and click **Load sample project**, or set `DEMO_MODE=true` for the public-demo flow. Data goes to `./data/signoff.db`.

- **With no keys** the app runs on the test rail and the scripted checker. The whole loop works, including disputes.
- **With Braintree sandbox keys** (`BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, `BRAINTREE_PRIVATE_KEY`) the client page shows the Drop-in with cards and quick server-side holds. Set `BRAINTREE_PAYPAL_ENABLED=true` only if your sandbox has a linked PayPal sandbox account.
- **With `GOOGLE_GENERATIVE_AI_API_KEY`** the planner and checker use Gemini. The free tier may use prompts to improve Google's products, so the public demo asks visitors not to paste real client documents.

Hosting: [`docs/deploy.md`](docs/deploy.md).

### Tests

```bash
pnpm test        # unit and integration tests; the live tests are skipped unless you opt in
pnpm test:e2e    # Playwright: the whole loop in demo mode, workspace isolation, the new-project flow, a coding agent over MCP, no sideways scroll at 390 px
pnpm typecheck && pnpm lint && pnpm build
pnpm eval        # the evaluation set and the keyword baseline, with the model in your environment

set -a; . ./.env.local; set +a
LIVE_AI=1 pnpm vitest run tests/unit/live-ai.test.ts
LIVE_BRAINTREE=1 pnpm vitest run tests/unit/live-braintree.test.ts
```

### Architecture

![Signoff architecture: the checker reads with read-only tools and never pays; Braintree holds, captures, voids and answers disputes only after a person clicks](docs/architecture.png)

```
src/
  app/                      pages, server actions, the webhook route, /api/health
    projects/               freelancer console
    c/[id]/[token]/         client page (Drop-in, decision panel)
    receipt/[id]/           printable receipt with the signed record
  components/app/           money view, audit timeline and ledger on AG Grid, the evidence report
  lib/
    domain/milestone-machine.ts   the state machine every money move goes through
    payments/                     the PaymentRail interface, Braintree, the test rail
    services/                     milestones, deliveries, disputes and webhooks, workspaces, caps, agent tokens, audit
    mcp/server.ts                 the MCP tools for a freelancer's coding agent
    ai/planner.ts                 scope to milestones with verified citations
    ai/checker.ts                 the checker, tampering findings, the scripted fallback
    ai/evidence.ts                the evidence rule
    ai/tools/                     read-only tools, HTML to visible text, the private-address guard
    eval/cases.ts                 the evaluation set
```

Stack: Next.js 16, TypeScript strict, Tailwind with shadcn/ui, AG Grid Community, AG Charts Community, Drizzle on libSQL (Turso when hosted), Zod, Vercel AI SDK, Vitest, Playwright, GitHub Actions.

The cheat pages in `public/samples/` are test fixtures: they hide text and address an instruction to Signoff's own checker on purpose, to show that it is caught. They are not aimed at any other system.

### Known limits

- PayPal through Braintree is not shown working: the sandbox needs a linked PayPal sandbox account, which I cannot have. Cards work end to end.
- The freelancer could still capture a hold from the Braintree control panel. A neutral platform account is the production fix.
- Card holds end after 7 days. Renewal places a new hold, which the client has to do before the old one ends.
- On the sandbox the chargeback comes from a stand-in charge with the dispute test card, and its outcome from a test value, both labelled on the page.
- Braintree's control panel offers webhook subscriptions for disputes only in this sandbox; transaction changes are picked up by reconcile, which runs on every money action and from the **Reconcile with Braintree** button.
- Hidden text set by JavaScript, by stylesheets from another origin or `@import`, by pseudo-class or sibling selectors, by text over an image, or by stacking elements is not detected, and neither is a server that shows the checker a different page from visitors.
- The instruction detector is a pattern list in English. It missed the Spanish case in the eval. The evidence rule, not the detector, is what stops a steered model from passing work.
- The Gemini free tier allows about 500 requests a day on each lite model, shared with everyone using the demo. On a busy day the sample deliveries show their stored result and your own deliveries fall back to the scripted checker; each report says which.
- Client links do not expire; the freelancer can replace a link to revoke the old one.

## Licence

MIT. See [LICENSE](LICENSE).

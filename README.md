# Signoff

Pay on acceptance for freelance and agency work. The client's money is held up front, an AI checker tests the delivery against the acceptance criteria both sides agreed and shows its evidence, and the money is released only when the client signs off.

**Live demo:** https://signoff-iota.vercel.app (no sign-up: each visitor gets a private demo workspace with sandbox money)

Built for the PayPal AI Hackathon. MIT licensed.

## Why

Clients will not send a deposit to a freelancer they just met. Freelancers chase invoices for work that is already done: in a 2015 Freelancers Union survey of 5,358 US freelancers, 71% had trouble getting paid at some point in their career, and half had trouble in the past year ([The Costs of Nonpayment](https://onlabor.org/wp-content/uploads/2017/05/FU_NonpaymentReport_r3.pdf)). A payment authorization already solves the first half: it holds money without taking it. What is missing is a fair, fast way to decide that the work is accepted. That is the AI part.

## Payment rail: Braintree, a PayPal service

Signoff moves money through **Braintree**, which is part of the PayPal developer platform. The official rules, section 4, say so:

> "This includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet, Simility, Swift Financial, and others."

PayPal does not open accounts in Pakistan, where the builder lives, so PayPal REST sandbox credentials were not available. The Braintree sandbox is. Clients pay with their PayPal account through Braintree's PayPal integration, or with a card.

**Status of the live sandbox:** the Braintree integration is written and covered by a gated live test suite (`tests/unit/live-braintree.test.ts`), but it has **not yet been run against the Braintree sandbox**, because the sandbox keys are still pending. Until they arrive, the hosted demo and the tests run on a built-in test rail that follows Braintree's rules and accepts Braintree's documented fake nonces. The header and the client page say which rail is live.

| Product step | Braintree mechanism |
|---|---|
| Client funds a milestone | `transaction.sale` with `submitForSettlement: false`: an authorization, money held, nothing charged |
| Hold expiry | `authorizationExpiresAt` on the transaction, shown to both sides, with a warning in the last day; reconcile marks it expired |
| Client accepts | `transaction.submitForSettlement` (full release) |
| Partial release | `submitForSettlement` with a smaller amount; the rest of the hold drops off |
| Client declines | `transaction.void`, only after re-reading that the transaction is still `authorized` |
| Payment form | Braintree Drop-in with PayPal (`intent: authorize`) and cards |
| Webhooks | `webhookNotification.parse` verifies the signature; events are deduplicated; the transaction or dispute is re-read from Braintree |
| Reconcile | `transaction.find` and `dispute.search` compare local state with Braintree; mismatches are flagged, never papered over |
| Dispute defence | `dispute.find`, `dispute.addTextEvidence` and `dispute.finalize`, after the operator approves the pack |

## The loop

1. **Scope to milestones.** The operator pastes the scope. The AI drafts milestones with two to five checkable acceptance criteria each. Every criterion carries the exact sentence from the scope that justifies it, and the code checks that sentence is really in the scope.
2. **Hold.** The client opens a signed link (no account) and funds a milestone with PayPal or a card. The page says the money is held, not charged, and when the hold expires.
3. **Deliver.** The operator submits links (a staging URL, a public GitHub repository, a PDF), notes and files. Files are marked either as the deliverable itself or as the freelancer's notes.
4. **Check.** The checker reads the delivery with read-only tools and marks each criterion met, not met or needs a person, quoting what it read. The page shows live progress.
5. **Decide.** The client reads the evidence report and accepts and releases (typing their name), requests changes (the AI drafts the note from the failing criteria), or declines (the hold is voided).
6. **Record.** Sign-off writes an acceptance record (criteria, verdicts, evidence, signer, timestamps), signed with HMAC-SHA256 over canonical JSON, and a printable receipt.
7. **Dispute defence.** If a chargeback opens on a released milestone, Signoff drafts evidence from the signed record. Nothing is sent until the operator approves it; then it goes to Braintree's Disputes API. The dispute screen shows the whole story in one view.
8. **Audit timeline.** Every state change lands on a timeline (AG Grid) with Braintree transaction ids, dispute ids and check ids.

### The two-minute demo

Open the live demo and click **Try the live demo**. You get a private workspace with the sample project, a fictional pottery studio site.

1. Open the project, then **Open as client**. Fund milestone 1 with a hold.
2. As the operator, pick **v1 with a cheat** and submit. The report flags text hidden from visitors and an instruction aimed at the AI, and shows each removed quote with the reason: "hidden from visitors on the page" or "copied from the requirement".
3. As the client, **Request changes**, **Draft from the report**, send.
4. As the operator, submit **v2, complete**. All four criteria are met, with quotes.
5. As the client, type a name and **Sign off and release payment**. Open the receipt.
6. As the operator, **Open a chargeback with a signed webhook**, review the drafted evidence and approve it. The dispute screen shows sign-off, chargeback, evidence and outcome.

## The evidence rule

Every quote the checker cites is verified in code (`src/lib/ai/evidence.ts`) and survives only if:

- it is at least 20 characters, so a lone word cannot prove a criterion;
- it is not the requirement itself: quoting the criterion back does not prove it was met;
- it appears word for word in text a visitor can see on a delivered page, in a delivered file or in the repository. The scope is never a source, and page titles and tool headers are never quotable;
- it is not hidden from visitors. Signoff reads inline styles, `<style>` blocks and same-origin linked stylesheets, with CSS comments and escapes resolved, and treats as hidden: `display:none`, `visibility:hidden`, opacity under 0.05, text under 4 pixels, transparent text, clipping, a 1-pixel box with overflow hidden, off-screen positioning or translation, `scale(0)`, a large negative text indent, and text coloured like its background where both colours are stated. It matches tag, class, id, attribute and compound selectors with descendant and child combinators. Image alt text, `aria-label`, closed `<dialog>` and `<details>` bodies, and `<canvas>`, `<video>`, `<audio>`, `<noembed>` and `<noframes>` content are never visible text either. Uploaded HTML files go through the same reader;
- it shares at least one key word with the criterion.

And a "met" needs its quotes, together, to contain the specific numbers and names the criterion states, such as a time, a price or an address. A file the freelancer uploads can prove what a document says, but never what a live page shows: criteria about a page, site or form need a link.

Removed quotes are kept and shown on the report with the reason. A "met" with no surviving quote becomes "needs a person". Text from the freelancer's own notes is shown as a claim, and a "met" resting only on notes goes to a person. Hidden text, requirement sentences pasted onto the page, and instructions aimed at the checker are listed on the report as tampering. The instruction detector undoes look-alike letters, zero-width characters and width variants before matching.

## Safety model

- **The checker has no payment tools.** Its tools only read: `read_url`, `read_file`, `github_repo`, `github_file`. Nothing under `src/lib/ai/` can reach the payment rail. Money moves only from a request a person's click made: the client funding, signing off or declining, or the operator approving dispute evidence.
- **What it reads is data, not instructions.** The prompts say so, document boundaries are escaped so a page cannot fake a new document, and the evidence rule means the model cannot invent support for a verdict.
- **No requests to private addresses.** `read_url` reaches only hosts listed in the delivery. IP literals, including bracketed IPv6 and IPv4-mapped forms, are checked before connecting, and DNS answers are checked at connect time, so loopback, private, link-local, cloud metadata, NAT64 and 6to4 addresses are refused even after a redirect or a DNS rebind. Redirects are followed by hand and re-checked. Size and time are capped.
- **GitHub reads** are limited to public repositories listed in the delivery. A server token is sent only after the repository is confirmed public without it.
- **Money moves once.** Releasing and voiding first claim the milestone with a compare-and-set (`releasing`, `voiding`), then call Braintree, then settle the claim, so a sign-off and a decline racing each other cannot both reach Braintree. The signed record is written inside the claim.
- **Secrets.** A production server refuses to start with the development session secret or the public demo passcode. Client links are signed with a per-project secret the operator can rotate to revoke old links.
- **Caps.** Daily limits on AI checks, AI drafts, AI change notes and page reads, per demo workspace, per visitor address (demo workspaces from one address share one budget, and one address can start 8 a day), and for the whole server. The last fifth of the day's AI checks is kept for workspaces that have not had one yet, so a first-time visitor is the last to lose the live model. Over a cap, or when the model fails, the scripted checker runs and the report says why. Addresses are only stored as a keyed hash.

## Who holds the money

The hold sits in the freelancer's own Braintree account, so a freelancer could still capture it from the Braintree control panel without the client's sign-off. Signoff does not make cheating impossible. What it gives both sides is an agreed test of done, a record they both signed, and evidence ready for a dispute if either side breaks the deal. A production version would keep the right to capture on a neutral platform account, such as PayPal's marketplace and platform payments, so neither side can move the money alone.

## Agent access over MCP

A freelancer's coding agent can work its side of one project through an MCP endpoint at `/api/mcp` (Streamable HTTP, JSON responses, stateless). The operator creates a token on the project page under **Agent access** and can revoke it there at any time.

| Tool | What it does |
|---|---|
| `list_milestones` | Milestones with their acceptance criteria, amount, state, any change request, and whether a delivery can be submitted |
| `submit_delivery` | Hands in up to 5 links and notes for a funded milestone; the checker starts at once |
| `read_evidence_report` | The checker's verdicts, surviving quotes, removed quotes with reasons and tampering found, or its progress while it runs |

There are no payment tools: an agent cannot fund, release, decline or touch disputes. A token reaches one project only, is stored as a SHA-256 hash, stops working when revoked or when its demo workspace is pruned, and its deliveries go through the same checker, caps and audit timeline as the web form.

```bash
claude mcp add --transport http signoff https://signoff-iota.vercel.app/api/mcp \
  --header "Authorization: Bearer so_agent_..."
# then, in the agent: "List my Signoff milestones, submit https://staging.example.com
#  for the landing page, and tell me what the evidence report says."
```

## AI

Through the Vercel AI SDK. **Google Gemini** is the default: `gemini-3.5-flash-lite`, then `gemini-3.5-flash` and `gemini-3.1-flash-lite` when a model is rate-limited. **Anthropic Claude** (`claude-sonnet-5-5`) is the alternative. With no key, a deterministic scripted checker runs, labelled on every report.

A check reads every link and file once in parallel, lets the model explore further with tools only when the delivery has more to read (a repository, or pages linking to other delivery pages), then judges all criteria in one structured call. One call per check keeps a public demo inside a free-tier quota.

### Evaluation

`pnpm eval` runs 8 deliveries and 31 criteria with known right answers: the two sample versions, the cheat version, a version that hides the missing facts with a linked stylesheet, a version that hides them with alt text, closed elements, a canvas, transparent and tiny text, a prices page with one wrong price and a subjective criterion, a handover PDF uploaded as a file, and this repository on GitHub.

**Latest, 9 November 2026, `google/gemini-3.5-flash-lite`: 31 of 31 correct, 0 wrong, 0 sent to a person.** For comparison, the scripted checker with no AI gets 22 of the 28 offline criteria right, 4 wrong and 2 sent to a person. Full table and timings: [docs/eval-latest.md](docs/eval-latest.md). The sample loop ran five times in a row with v1 failing the same two criteria and v2 passing every time, at about 2 seconds a check.

## Run it

Requirements: Node 22 or newer, pnpm.

```bash
pnpm install
cp .env.example .env.local   # optional
pnpm dev
```

Open http://localhost:3000. Locally, sign in with the passcode `signoff-demo` and click **Load sample project**, or set `DEMO_MODE=true` to get the public-demo flow.

- **With no keys** the app runs on the test rail and the scripted checker. The whole loop works, including disputes.
- **With Braintree sandbox keys** (`BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, `BRAINTREE_PRIVATE_KEY`) the client page shows the Braintree Drop-in with PayPal and cards. Create a free sandbox at https://sandbox.braintreegateway.com. Test card `4111 1111 1111 1111`; dispute test card `4023 8984 9398 8028`.
- **With `GOOGLE_GENERATIVE_AI_API_KEY`** (a free key from Google AI Studio works) the planner and checker use Gemini.

Hosting: [docs/deploy.md](docs/deploy.md) has the environment variables and the steps for Vercel with a hosted libSQL database, and where to point the Braintree webhook.

## Tests

```bash
pnpm test        # unit and service tests, including tests/unit/review-1.test.ts for every finding of the first security review
pnpm test:e2e    # Playwright: the whole loop in demo mode, workspace isolation, the new-project flow, and no sideways scroll at 390 px
pnpm typecheck && pnpm lint && pnpm build
pnpm eval        # the evaluation set, with the model in your environment

# Live checks, opt in:
set -a; . ./.env.local; set +a
LIVE_AI=1 pnpm vitest run tests/unit/live-ai.test.ts
LIVE_BRAINTREE=1 pnpm vitest run tests/unit/live-braintree.test.ts
E2E_BASE_URL=https://signoff-iota.vercel.app pnpm test:e2e
```

## Architecture

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

Stack: Next.js 16, TypeScript strict, Tailwind with shadcn/ui, AG Grid Community, Drizzle on libSQL (Turso when hosted), Zod, Vercel AI SDK, Vitest, Playwright, GitHub Actions.

## Known limits

- Not yet run against the Braintree sandbox; see the status above. What the Drop-in's PayPal button does on a sandbox not linked to a PayPal test account is unverified.
- Hidden text set by JavaScript (including text a script removes on load), by stylesheets from another origin or `@import`, by pseudo-class or sibling selectors, by text over an image or gradient, or by stacking one element over another is not detected, and neither is a server that shows the checker a different page from visitors; a headless browser would catch most of these.
- The instruction detector is a pattern list: it catches common phrasings and disguises, not every paraphrase. The evidence rule, not the detector, is what stops a steered model from passing work.
- Client links do not expire; the operator can replace a link to revoke the old one.
- The test rail's dispute outcome follows Braintree's sandbox convention: evidence containing `compelling_evidence` wins. A real dispute is decided by the card issuer.
- The Gemini free tier allows few requests per minute and about 20 a day on `gemini-3.5-flash`. A busy public demo needs a paid key, or it falls back to the scripted checker and says so.
- Login attempts are limited per address per day; there is no account lockout beyond that.

## Licence

MIT. See [LICENSE](LICENSE).

# Requirements checklist

Every rule and submission requirement from the PayPal AI Hackathon official rules, and where this repository meets it. Status: **Met**, **Partly met** or **Open** (a later session).

## Payment rail

Signoff runs on **Braintree, a PayPal service**. The official rules, section 4, Project Requirements, What to Create:

> "This includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet, Simility, Swift Financial, and others."

PayPal does not open accounts in Pakistan, where the builder lives, so PayPal REST sandbox credentials were unavailable. Clients pay with a PayPal account through Braintree's PayPal integration, or with a card.

## Project requirements (rules section 4)

| Requirement | Status | Where |
|---|---|---|
| Integrates the PayPal developer platform using the free sandbox | Met | Braintree sandbox, run live on 10 November 2026: hold, release, partial release, void, retries, decline, webhook signatures, the dispute card through to evidence finalized (`tests/unit/live-braintree.test.ts`, 8 of 9 cases; the ninth is PayPal, below), and the full loop on the host with the real Drop-in (`tests/e2e/loop.spec.ts` against production). `/api/health` reports `"rail":"sandbox"`. PayPal through Braintree is not available: the sandbox needs a linked PayPal sandbox account (`PAYPAL_SANDBOX_ACCOUNT_NOT_LINKED`) |
| Integrates an AI tool, model or platform | Met | Gemini (default) and Claude through the Vercel AI SDK, `src/lib/ai/`. Live Gemini evaluation: 31 of 31 correct on 8 deliveries, `docs/eval-latest.md` |
| PayPal integration central to the project | Met | Holds, release, partial release, void, expiry, webhooks, reconcile, dispute evidence: README "Payment rail" |
| AI meaningful, not decorative | Met | Planner with verified citations; checker agent with read-only tools; evidence rule enforced in code; tampering findings; change-note drafting. Lint forbids the AI code from importing the payment rail |
| Working prototype | Met | Live demo (README); `pnpm dev`; Playwright tests in `tests/e2e/loop.spec.ts` |
| Sufficiently documented | Met | `README.md`, `docs/deploy.md`, `docs/eval-latest.md` |
| Newly created during the submission period | Met | A new project, started 9 November 2026; the first commit is `cb2c029` on that day. Stated at the top of the README |
| Third-party SDKs used under their terms | Met | Braintree SDKs (MIT), AI SDK (Apache-2.0), AG Grid Community (MIT), ipaddr.js (MIT). The Gemini free tier may use prompts to improve Google's products, so the public demo asks visitors not to paste real client documents |
| Installs and runs as depicted | Met | Hosted on the Braintree sandbox; installs with no keys run on the test rail |

## Submission requirements

| Requirement | Status | Where |
|---|---|---|
| Text description of features | Open | Devpost form, a later session. README "The loop" is the source |
| Functional demo: setup and run instructions | Met | README "Run it". Runs with no keys at all |
| Hosted demo URL | Met | README, first lines. One click gives each judge a private workspace |
| Identify AI tools and how they are used | Met | README "AI" and "The evidence rule" |
| Public repository on GitHub | Met | https://github.com/kaifahmed0341/signoff |
| All source, assets and instructions in the repo | Met | Sample deliverables in `public/samples/`, migrations in `drizzle/`, evaluation in `src/lib/eval/` |
| Open source licence visible in the About section | Met | `LICENSE` (MIT); GitHub detects it |
| Demo video under 3 minutes, on YouTube, public | Open | A later session. The front page shows its link once `DEMO_VIDEO_URL` is set |
| Video shows the project working on its device | Open | A later session |
| No third-party trademarks or copyrighted material without permission | Met in the app | The sample business is fictional; no logos beyond what Braintree's Drop-in renders; one plain text line names Braintree and PayPal |
| English | Met | All materials |
| No harmful code | Met | The cheat pages in `public/samples/` are labelled test fixtures: they address an instruction to Signoff's own checker on purpose, to show it is caught (README, "Architecture") |
| Testing access free of charge until judging ends | Met | Public demo with no sign-up; local run with no keys. Per-address caps (25 workspaces, 120 AI checks a day) leave room for judges on one office address; what must stay alive through 15 December is in `docs/deploy.md`, "Keep alive through judging" |
| Test credentials or sandbox details | Met | README: no sign-up on the demo, local passcode, sandbox signup, test cards |

## Judging criteria

| Criterion | How Signoff addresses it |
|---|---|
| Technological implementation | Authorization, release, partial release, void, expiry, signed webhooks, reconcile that flags mismatches, Disputes API; claim states so racing clicks cannot split app and rail; an AI agent with read-only tools and code-verified evidence; a 31-criterion evaluation on 8 deliveries; unit, regression, browser and live tests |
| Design | Front page, operator console, client page that works at phone width, evidence report with removed quotes and tampering findings, one-view dispute story, receipt, AG Grid ledger and audit timeline |
| Potential impact | Freelancers and small agencies who lose deposits or chase invoices, with a sourced number on the front page; an honest statement of the trust model and what a production version would add |
| Innovation | Acceptance decided by evidence a client can read, with quotes the AI cannot invent or hide, and the same signed record reused to defend chargebacks |
| Presentation | Open: the video. The two-minute demo script is in the README, including the cheat that gets caught |

## Sponsor tools

- **AG Grid** (Community): the dashboard ledger and the audit timeline, themed, with custom cell renderers, quick filter and pagination. The AG Grid prize page asks for polish such as custom widgets and theming and mentions AG Studio and its agent framework; we did not adopt AG Studio.
- **Render**: not used. The demo is hosted on Vercel with a Turso database.

## Security reviews

Two external reviews read the repository and the hosted demo (at `b8afbfc` and `3121fa1`). Every high and medium finding of both has a regression test, named by finding id, in `tests/unit/review-1.test.ts` and `tests/unit/review-2.test.ts`. Findings not fixed are listed in the README under "Known limits".

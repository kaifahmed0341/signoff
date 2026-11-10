# Requirements checklist

Every rule and submission requirement from the PayPal AI Hackathon official rules, and where this repository meets it. Status: **Met**, **Partly met** or **Open** (a later session).

## Payment rail

Signoff runs on **Braintree, a PayPal service**. The official rules, section 4, Project Requirements, What to Create:

> "This includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet, Simility, Swift Financial, and others."

PayPal does not open accounts in Pakistan, where the builder lives, so PayPal REST sandbox credentials were unavailable. Clients pay with a PayPal account through Braintree's PayPal integration, or with a card.

## Project requirements (rules section 4)

| Requirement | Status | Where |
|---|---|---|
| Integrates the PayPal developer platform using the free sandbox | Met | Braintree sandbox, run live on 10 November 2026: hold, release, partial release, void, retries, decline, webhook signatures, a chargeback after sign-off answered with evidence and ruled won with one sandbox test value and lost with the other (`tests/unit/live-braintree.test.ts`, 9 of 10 cases, run log in `docs/live-braintree-run.txt`; the tenth is PayPal, below), and the full loop on the host with the real Drop-in (`tests/e2e/loop.spec.ts` against production). `/api/health` reports `"rail":"sandbox"`. PayPal through Braintree is not available: the sandbox needs a linked PayPal sandbox account (`PAYPAL_SANDBOX_ACCOUNT_NOT_LINKED`) |
| Integrates an AI tool, model or platform | Met | Gemini (default) and Claude through the Vercel AI SDK, `src/lib/ai/`. Live Gemini evaluation: 79 of 80 criteria correct on 20 deliveries, 77 of 77 on the 19 a model answered; prompt injection counted apart, 33 of 34 on 9 deliveries; keyword baseline 53 of 77. `docs/eval-latest.md` |
| PayPal integration central to the project | Met | Holds, release, partial release, void, expiry, webhooks, reconcile, dispute evidence: README "Payment rail" |
| AI meaningful, not decorative | Met | Planner with verified citations; checker agent with read-only tools; evidence rule enforced in code; tampering findings; change-note drafting. Lint forbids the AI code from importing the payment rail directly |
| Working prototype | Met | Live demo (README); `pnpm dev`; Playwright tests in `tests/e2e/loop.spec.ts` |
| Sufficiently documented | Met | `README.md`, `docs/deploy.md`, `docs/eval-latest.md` |
| Newly created during the submission period | Met | A new project, started 9 November 2026; the first commit is `cb2c029` on that day. Stated at the top of the README |
| Third-party SDKs used under their terms | Met | Braintree SDKs (MIT), AI SDK (Apache-2.0), AG Grid Community (MIT), ipaddr.js (MIT). The Gemini free tier may use prompts to improve Google's products, so the public demo asks visitors not to paste real client documents |
| Installs and runs as depicted | Met | Hosted on the Braintree sandbox; installs with no keys run on the test rail |

## Submission requirements

| Requirement | Status | Where |
|---|---|---|
| Text description of features | Met | The Devpost text; README "The loop" is the source |
| Functional demo: setup and run instructions | Met | README "Run it". Runs with no keys at all |
| Hosted demo URL | Met | README, first lines. One click gives each judge a private workspace |
| Identify AI tools and how they are used | Met | README "AI" and "The evidence rule" |
| Public repository on GitHub | Met | https://github.com/kaifahmed0341/signoff |
| All source, assets and instructions in the repo | Met | Sample deliverables in `public/samples/`, migrations in `drizzle/`, evaluation in `src/lib/eval/` |
| Open source licence visible in the About section | Met | `LICENSE` (MIT); GitHub detects it |
| Demo video under 3 minutes, on YouTube, public | Open until uploaded | The video is cut (2:47); the link goes on the Devpost form, and the front page shows it once `DEMO_VIDEO_URL` is set |
| Video shows the project working on its device | Met in the cut | Recorded on the hosted demo against the live Braintree sandbox |
| No third-party trademarks or copyrighted material without permission | Met in the app | The sample business is fictional; no logos beyond what Braintree's Drop-in renders; one plain text line names Braintree and PayPal |
| English | Met | All materials |
| No harmful code | Met | The cheat pages in `public/samples/` are labelled test fixtures: they address an instruction to Signoff's own checker on purpose, to show it is caught (README, "Architecture") |
| Testing access free of charge until judging ends | Met | Public demo with no sign-up; local run with no keys. One address may start 1,000 workspaces a day and use the whole server's AI budget, so judges on one office address are never the limit; the server-wide caps (3,000 workspaces, 400 AI checks a day) and 15 checks per workspace protect the quota, and a visitor over a workspace cap sees a labelled read-only finished run instead of a refusal; what must stay alive through 15 December is in `docs/deploy.md`, "Keep alive through judging" |
| Test credentials or sandbox details | Met | README: no sign-up on the demo, local passcode, sandbox signup, test cards |

## Judging criteria

| Criterion | How Signoff addresses it |
|---|---|
| Technological implementation | Authorization, release, partial release, void, expiry, signed webhooks, reconcile that flags mismatches, Disputes API; claim states so racing clicks cannot split app and rail; an AI agent with read-only tools and code-verified evidence; an 80-criterion evaluation on 20 deliveries with a keyword baseline; unit, regression, browser and live tests |
| Design | Front page, operator console, client page that works at phone width, evidence report with removed quotes and tampering findings, one-view dispute story, receipt, AG Grid money view with an AG Charts chart, ledger and audit timeline |
| Potential impact | Freelancers and small agencies whose clients dispute a charge for accepted work, with no tracking number to show the bank; sourced 2025 figures on the front page; an honest statement of the trust model and what a production version would add |
| Innovation | Acceptance decided by evidence a client can read, with quotes the AI cannot invent or hide, and the same signed record reused to defend chargebacks |
| Presentation | The video (2:47), and the README's judge path, which walks the same loop on the hosted demo, including the cheat that gets caught |

## Sponsor tools

- **AG Grid** (Community): the dashboard ledger and the audit timeline, themed, with custom cell renderers, quick filter and pagination. The AG Grid prize page asks for polish such as custom widgets and theming and mentions AG Studio and its agent framework; we did not adopt AG Studio.
- **Render**: not used. The demo is hosted on Vercel with a Turso database.

## Security reviews

Two external reviews read the repository and the hosted demo (at `b8afbfc` and `3121fa1`). Every high and medium finding of both has a regression test, named by finding id, in `tests/unit/review-1.test.ts` and `tests/unit/review-2.test.ts`. Findings not fixed are listed in the README under "Known limits".

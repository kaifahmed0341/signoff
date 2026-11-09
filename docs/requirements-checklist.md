# Requirements checklist

Every rule and submission requirement from the PayPal AI Hackathon official rules, and where this repository meets it. Status: **Met**, **Partly met** or **Open** (work for a later session).

## Payment rail

Signoff runs on **Braintree, a PayPal service**. The official rules, section 4, Project Requirements, What to Create:

> "This includes all the services provided by PayPal such as Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet, Simility, Swift Financial, and others."

PayPal does not open accounts in Pakistan, where the builder lives, so PayPal REST sandbox credentials were unavailable. Clients still pay with a PayPal account through Braintree's PayPal integration, or with a card.

## Project requirements (rules section 4)

| Requirement | Status | Where |
|---|---|---|
| Build an application that integrates the PayPal developer platform using the free sandbox | Partly met | Braintree sandbox rail in `src/lib/payments/braintree-rail.ts`, live checks in `tests/unit/live-braintree.test.ts`. **Not yet run against the sandbox: keys pending.** |
| Integrate an AI tool, model or platform | Met | Gemini (default) and Claude via the Vercel AI SDK: `src/lib/ai/`. Live Gemini run passed (`tests/unit/live-ai.test.ts`) |
| PayPal integration central to the project | Met | Holds, release, partial release, void, expiry, webhooks, reconcile, dispute evidence: README "Payment rail" table |
| AI meaningful, not decorative | Met | Planner with verified citations, checker agent with tools, evidence rule enforced in code, change-note drafting |
| Working prototype | Met | `pnpm dev`; Playwright test `tests/e2e/loop.spec.ts` runs the whole loop in a browser |
| Sufficiently documented | Met | `README.md` |
| Newly created during the submission period | Met | Repository history starts 9 Nov 2026 |
| Third-party SDKs used under their terms | Met | Braintree SDKs (MIT), AI SDK (Apache-2.0), AG Grid Community (MIT) |
| Functionality: installs and runs as depicted | Met on the test rail; Partly met on the sandbox | Same as the first row |

## Submission requirements

| Requirement | Status | Where |
|---|---|---|
| Text description of features | Open | Devpost form, later session. README "The loop" is the source |
| Functional demo: setup and run instructions in the repo | Met | README "Run it" and "The two-minute demo". Runs with no keys at all |
| Hosted demo URL (alternative) | Open | Optional. Render is a natural host (sponsor) |
| Identify AI tools and how they are used | Met | README "Tools used" and "AI design" |
| Public repository on GitHub | Met | https://github.com/kaifahmed0341/signoff |
| All source, assets and instructions in the repo | Met | Sample deliverables in `public/samples/`, migrations in `drizzle/` |
| Open source licence visible in the About section | Met | `LICENSE` (MIT) at the root |
| Demo video under 3 minutes, on YouTube, public | Open | Later session |
| Video shows the project working on its device | Open | Later session |
| No third-party trademarks or copyrighted material without permission | Met in the app | Sample business is fictional; no logos beyond what Braintree's Drop-in renders; test buttons use plain text |
| English | Met | All materials |
| Testing access free of charge until judging ends | Met | Runs locally with no keys; demo passcode documented |
| Test credentials or sandbox details | Met | README: demo passcode, sandbox signup, test cards |

## Judging criteria

| Criterion | How Signoff addresses it |
|---|---|
| Technological implementation | Authorization, release, partial release, void, expiry, webhooks with signature checks, reconcile, Disputes API; an AI agent with tools, structured verdicts and code-verified evidence; state machine with compare-and-set; tests at three levels |
| Design | Operator console, client share page, evidence report, receipt, AG Grid ledger and audit timeline. Screens in `test-results/screens/` after `pnpm test:e2e` |
| Potential impact | Freelancers and small agencies who lose deposits or chase invoices; clients who will not prepay strangers |
| Innovation | Acceptance decided by evidence a client can read, with quotes the AI cannot invent, and the same signed record reused to defend chargebacks |
| Presentation | Open: video in a later session. The two-minute demo script is in the README |

## Sponsor tools

- **AG Grid** (Community): ledger on the dashboard and the audit timeline. The AG Grid prize page asks for polish such as custom widgets, theming and layout, and mentions AG Studio and its agent framework. We use a themed grid with custom cell renderers; we did not adopt AG Studio.
- **Render**: not used yet. Its prize asks for deployment on Render and use of Render Workflows. A later session could host the demo there without changing the product.
- No other sponsor tools. We did not bend the product for a sponsor.

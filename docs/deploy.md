# Deploying Signoff

Signoff runs on any Node host. These are the exact steps for Vercel with a hosted libSQL database (Turso), which is how the public demo runs.

Public demo: https://signoff-iota.vercel.app (health: https://signoff-iota.vercel.app/api/health). It runs on Vercel with a Turso database in AWS US East, Gemini, and the test rail until Braintree sandbox keys are added.

## What the app needs from the host

- **No local disk.** All state lives in the database: projects, checks and their progress, usage counters, and the test rail's transactions. Set `DATABASE_URL` to a hosted libSQL database. A `file:` URL only works on a single long-running server.
- **No memory shared between requests.** Every request reads what it needs from the database, so any number of serverless instances can serve the app.
- **Long-running checks.** A check takes 10 to 60 seconds. The server action that submits a delivery returns at once and keeps the check running with Next's `after()`. The project page sets `maxDuration = 300`, so the function may run for up to five minutes. Progress is written to the database and the page polls it. A check that never finishes is marked failed after six minutes, and the operator can run it again.
- **Uploads.** Server actions accept up to 4 MB (`experimental.serverActions.bodySizeLimit`), under Vercel's 4.5 MB request cap. The form allows 3 files of 1 MB each.
- **Migrations.** `next.config.ts` ships the `drizzle/` folder with every function. The app migrates on first use; run `pnpm db:migrate` against a new database before sending traffic.

## Environment variables

| Name | Required | Value |
|---|---|---|
| `APP_URL` | yes | The public URL, for example `https://signoff-demo.vercel.app`. Used for client links and for the sample deliverables. |
| `DATABASE_URL` | yes | `libsql://<db>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN` | yes | A Turso auth token for that database |
| `SESSION_SECRET` | yes | At least 32 random characters: `openssl rand -base64 48`. A production server refuses to start with the development default. |
| `DEMO_MODE` | for a public demo | `true`: every visitor gets a private workspace with one click, and passcode sign-in is off unless you set your own passcode. |
| `OPERATOR_PASSCODE` | for a self-hosted install | Your passcode. A production server refuses the public default unless `DEMO_MODE=true`. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | for the AI checker | A Gemini API key. Without it the scripted checker runs, and every report says so. |
| `GOOGLE_MODEL`, `GOOGLE_FALLBACK_MODELS` | no | Defaults: `gemini-3.5-flash-lite`, then `gemini-3.5-flash,gemini-3.1-flash-lite` when the main model is rate-limited. |
| `ANTHROPIC_API_KEY`, `AI_PROVIDER` | no | Use Claude instead: `AI_PROVIDER=anthropic`. |
| `BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, `BRAINTREE_PRIVATE_KEY` | for real payments | Braintree sandbox keys. Without them the app uses the built-in test rail and says so in the header and on the client page. |
| `BRAINTREE_MERCHANT_ACCOUNT_ID` | no | A specific merchant account, for a non-default currency. |
| `CURRENCY` | no | Default `USD`. Match the Braintree merchant account. |
| `DEMO_VIDEO_URL` | no | Shows a "Watch the demo" button on the front page. |
| `LIMIT_*` | no | Daily caps. Defaults: per demo workspace 15 AI checks, 10 AI drafts, 10 AI change notes, 150 page reads; per visitor address 120 AI checks and 25 new workspaces (judges may share one office address), and ten workspaces' worth of drafts, notes and reads; for the whole server 400 checks, 300 drafts, 150 notes, 5,000 reads. The last fifth of the day's checks is kept for first-time visitors. Every cap resets at 00:00 UTC, and a visitor who hits one is told which cap and when it resets. Keep the global check cap under your model provider's daily quota. |
| `GITHUB_TOKEN` | no | Raises GitHub rate limits. Use a token with no scopes; it is only sent for repositories already confirmed public. |

## Steps with the Vercel CLI

```bash
# 1. Database
turso db create signoff --location <region>
turso db show signoff --url            # DATABASE_URL
turso db tokens create signoff         # DATABASE_AUTH_TOKEN
DATABASE_URL=... DATABASE_AUTH_TOKEN=... pnpm db:migrate

# 2. Project
vercel link --yes --project signoff

# 3. Environment, production. Pipe values in so they never appear in your shell history.
printf %s "$DATABASE_URL"        | vercel env add DATABASE_URL production
printf %s "$DATABASE_AUTH_TOKEN" | vercel env add DATABASE_AUTH_TOKEN production
openssl rand -base64 48 | tr -d '\n' | vercel env add SESSION_SECRET production
printf %s "$GEMINI_KEY"          | vercel env add GOOGLE_GENERATIVE_AI_API_KEY production
printf %s "true"                 | vercel env add DEMO_MODE production
printf %s "https://<your-url>"   | vercel env add APP_URL production

# 4. Deploy
vercel deploy --prod

# 5. Check
curl https://<your-url>/api/health
E2E_BASE_URL=https://<your-url> pnpm test:e2e
```

`/api/health` reports the payment rail, the AI provider and model, whether the database is reachable, and warnings such as a development secret. It never returns keys.

## Braintree webhooks

In the Braintree control panel, open **Settings, Webhooks**, add `https://<your-url>/api/webhooks/braintree`, and subscribe to:

- Transaction: settled, settlement declined, disbursed
- Dispute: opened, under review, won, lost, accepted, expired

The handler verifies every signature with the Braintree SDK, deduplicates events, and re-reads the transaction or dispute from Braintree rather than trusting the payload. Without a public webhook URL, **Reconcile with Braintree** on a project pulls the same state.

## Gemini quotas

On the free tier this project's key allows 500 requests a day and 15 a minute on each of `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`, and 20 a day on `gemini-3.5-flash`. That is why the lite model is the default. A check uses one model call, plus a few more only when the delivery links to further pages or is a repository. When a model is rate-limited the checker waits if Google asks for a short pause, then tries the next model in `GOOGLE_FALLBACK_MODELS`, and only then falls back to the scripted checker, saying why on the report. The global cap of 400 checks a day keeps the demo inside the two lite models' combined quota with room for drafts and change notes.

## Keep alive through judging

Judging runs from 1 to 15 December 2026, until 08:00 Pacific on the 15th. Until then these must stay alive and unchanged:

- the Vercel project `signoff` and its production deployment at https://signoff-iota.vercel.app, with the same environment variables;
- the Turso database in `DATABASE_URL` (check the free plan's rules on inactive databases, and open the app at least weekly);
- the Gemini key in `GOOGLE_GENERATIVE_AI_API_KEY`, and the Braintree sandbox keys once they are set.

Do not rotate a key, rename the project or deploy a breaking change to `main` in that window. Check https://signoff-iota.vercel.app/api/health reports `"status":"ok"`.

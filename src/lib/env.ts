import { z } from "zod";

/**
 * All configuration comes from one env file (.env.local). Every value has a
 * safe default so `pnpm dev` works before any credential exists: payments run
 * against the built-in fake rail and the AI runs in scripted mode.
 */
const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("file:./data/signoff.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  OPERATOR_PASSCODE: z.string().min(4).default("signoff-demo"),
  SESSION_SECRET: z.string().min(16).default("dev-only-session-secret-change-me"),

  // Payments run on Braintree, a PayPal service. "fake" uses an in-process
  // stand-in so the app and the tests run with no account.
  BRAINTREE_ENVIRONMENT: z.enum(["fake", "sandbox", "production"]).optional(),
  BRAINTREE_MERCHANT_ID: z.string().optional(),
  BRAINTREE_PUBLIC_KEY: z.string().optional(),
  BRAINTREE_PRIVATE_KEY: z.string().optional(),
  BRAINTREE_MERCHANT_ACCOUNT_ID: z.string().optional(),
  /** Show PayPal in the Drop-in. Braintree's sandbox needs a linked PayPal sandbox account for it; off by default. */
  BRAINTREE_PAYPAL_ENABLED: z.enum(["true", "false", "1", "0"]).default("false").transform((v) => v === "true" || v === "1"),
  CURRENCY: z.string().length(3).default("USD"),

  // AI
  AI_PROVIDER: z.enum(["auto", "google", "anthropic", "scripted"]).default("auto"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().default("gemini-3.5-flash-lite"),
  /** Tried in order when the main Gemini model is rate-limited; each model has its own free-tier quota. */
  GOOGLE_FALLBACK_MODELS: z.string().default("gemini-3.5-flash,gemini-3.1-flash-lite"),
  GITHUB_TOKEN: z.string().optional(),

  // Public demo: each visitor gets a private workspace with one click.
  DEMO_MODE: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  DEMO_VIDEO_URL: z.string().url().optional(),
  /**
   * Test-only. When set, a request carrying it in the x-signoff-e2e header may start a demo
   * workspace without counting against the per-address workspace limit, so the production
   * browser tests can run repeatedly. Every other cap still applies. Unset means no bypass.
   */
  E2E_BYPASS_TOKEN: z.string().min(32).optional(),
  REPO_URL: z.string().url().default("https://github.com/kaifahmed0341/signoff"),

  // Daily caps. Per-workspace caps apply to demo workspaces; global caps to the whole server.
  LIMIT_AI_CHECKS_PER_WORKSPACE: z.coerce.number().int().positive().default(15),
  LIMIT_AI_CHECKS_GLOBAL: z.coerce.number().int().positive().default(400),
  LIMIT_AI_PLANS_PER_WORKSPACE: z.coerce.number().int().positive().default(10),
  LIMIT_AI_PLANS_GLOBAL: z.coerce.number().int().positive().default(300),
  LIMIT_AI_CHECKS_PER_ADDRESS: z.coerce.number().int().positive().default(120),
  LIMIT_AI_NOTES_PER_WORKSPACE: z.coerce.number().int().positive().default(10),
  LIMIT_AI_NOTES_GLOBAL: z.coerce.number().int().positive().default(150),
  LIMIT_WORKSPACES_PER_ADDRESS: z.coerce.number().int().positive().default(25),
  LIMIT_FETCHES_PER_WORKSPACE: z.coerce.number().int().positive().default(150),
  LIMIT_FETCHES_GLOBAL: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export const DEV_SESSION_SECRET = "dev-only-session-secret-change-me";
export const DEMO_PASSCODE = "signoff-demo";

/**
 * Refuses to run a production server with the public development defaults:
 * with them, anyone could forge sessions, client links and signed acceptance
 * records, or sign in with the documented passcode.
 */
export function assertSafeForProduction(e: Env, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== "production") return;
  if (e.SESSION_SECRET === DEV_SESSION_SECRET || e.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters in production. Generate one with: openssl rand -base64 48");
  }
  if (!e.DEMO_MODE && e.OPERATOR_PASSCODE === DEMO_PASSCODE) {
    throw new Error("OPERATOR_PASSCODE is still the public demo value. Set your own, or set DEMO_MODE=true for a public demo with per-visitor workspaces.");
  }
}

export function env(): Env {
  if (!cached) {
    const raw: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(process.env)) raw[k] = v === "" ? undefined : v;
    const parsed = schema.parse(raw);
    assertSafeForProduction(parsed);
    cached = parsed;
  }
  return cached;
}

/** Test hook: override env values for one test run. */
export function setEnvForTests(overrides: Partial<Env>) {
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  cached = { ...schema.parse({}), ...defined };
}

/** Which payment rail the app talks to. Defaults to the sandbox once keys exist. */
export function railMode(e: Env = env()): "fake" | "sandbox" | "production" {
  if (e.BRAINTREE_ENVIRONMENT) return e.BRAINTREE_ENVIRONMENT;
  return e.BRAINTREE_MERCHANT_ID && e.BRAINTREE_PUBLIC_KEY && e.BRAINTREE_PRIVATE_KEY ? "sandbox" : "fake";
}

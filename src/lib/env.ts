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
  CURRENCY: z.string().length(3).default("USD"),

  // AI
  AI_PROVIDER: z.enum(["auto", "google", "anthropic", "scripted"]).default("auto"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().default("gemini-3.5-flash"),
  GITHUB_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const raw: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(process.env)) raw[k] = v === "" ? undefined : v;
    cached = schema.parse(raw);
  }
  return cached;
}

/** Test hook: override env values for one test run. */
export function setEnvForTests(overrides: Partial<Env>) {
  cached = { ...schema.parse({}), ...overrides };
}

/** Which payment rail the app talks to. Defaults to the sandbox once keys exist. */
export function railMode(e: Env = env()): "fake" | "sandbox" | "production" {
  if (e.BRAINTREE_ENVIRONMENT) return e.BRAINTREE_ENVIRONMENT;
  return e.BRAINTREE_MERCHANT_ID && e.BRAINTREE_PUBLIC_KEY && e.BRAINTREE_PRIVATE_KEY ? "sandbox" : "fake";
}

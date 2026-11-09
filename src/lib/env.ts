import { z } from "zod";

/**
 * All configuration comes from one env file (.env.local). Every value has a
 * safe default so `pnpm dev` works before any credential exists: PayPal runs
 * against the built-in fake server and the AI runs in scripted mode.
 */
const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("file:./data/signoff.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  OPERATOR_PASSCODE: z.string().min(4).default("signoff-demo"),
  SESSION_SECRET: z.string().min(16).default("dev-only-session-secret-change-me"),

  // PayPal
  PAYPAL_MODE: z.enum(["fake", "sandbox", "live"]).default("fake"),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_CURRENCY: z.string().length(3).default("USD"),

  // AI
  AI_PROVIDER: z.enum(["auto", "anthropic", "google", "scripted"]).default("auto"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().default("gemini-2.5-flash"),
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

export function paypalBaseUrl(e: Env = env()): string {
  if (e.PAYPAL_MODE === "live") return "https://api-m.paypal.com";
  if (e.PAYPAL_MODE === "sandbox") return "https://api-m.sandbox.paypal.com";
  return `${e.APP_URL}/api/fake-paypal`;
}

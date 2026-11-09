import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { env } from "../env";

export type ResolvedModel = { model: LanguageModel; label: string } | { model: null; label: string };

const g = globalThis as unknown as { __signoffModelOverride?: ResolvedModel };

/**
 * Google Gemini is the default provider, Anthropic the alternative. With no
 * key at all the app falls back to the scripted checker, which is labelled as
 * such everywhere it shows up.
 */
export function resolveModel(): ResolvedModel {
  if (g.__signoffModelOverride) return g.__signoffModelOverride;
  const e = env();
  const want = e.AI_PROVIDER;
  const google = () => ({ model: createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY })(e.GOOGLE_MODEL), label: `google/${e.GOOGLE_MODEL}` });
  const anthropic = () => ({ model: createAnthropic({ apiKey: e.ANTHROPIC_API_KEY })(e.ANTHROPIC_MODEL), label: `anthropic/${e.ANTHROPIC_MODEL}` });
  if (want === "scripted") return { model: null, label: "scripted" };
  if (want === "google" && e.GOOGLE_GENERATIVE_AI_API_KEY) return google();
  if (want === "anthropic" && e.ANTHROPIC_API_KEY) return anthropic();
  if (e.GOOGLE_GENERATIVE_AI_API_KEY) return google();
  if (e.ANTHROPIC_API_KEY) return anthropic();
  return { model: null, label: "scripted" };
}

/** Test hook. */
export function setModelForTests(m: ResolvedModel | undefined) {
  g.__signoffModelOverride = m;
}

/** Shared call options. Low thinking keeps a check under a minute on Gemini. */
export const providerOptions = {
  google: { thinkingConfig: { thinkingLevel: "low" as const } },
  anthropic: {},
};

/** Extra Gemini models to try, in order, when the main one is rate-limited or down. Each has its own quota. */
export function fallbackModels(): { model: LanguageModel; label: string }[] {
  if (g.__signoffModelOverride) return [];
  const e = env();
  if (!e.GOOGLE_GENERATIVE_AI_API_KEY || resolveModel().label.startsWith("anthropic/")) return [];
  const google = createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY });
  return e.GOOGLE_FALLBACK_MODELS.split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== e.GOOGLE_MODEL)
    .map((id) => ({ model: google(id), label: `google/${id}` }));
}

function statusOf(err: unknown): number | undefined {
  const e = err as { statusCode?: number; lastError?: { statusCode?: number }; errors?: { statusCode?: number }[] };
  return e?.statusCode ?? e?.lastError?.statusCode ?? e?.errors?.at(-1)?.statusCode;
}

/** Seconds the provider asked us to wait, if it said and it is short enough to be worth it. */
export function retryAfterSeconds(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([\d.]+)s/i);
  return m ? Number(m[1]) : null;
}

export function isRetryable(err: unknown): boolean {
  const s = statusOf(err);
  const msg = err instanceof Error ? err.message : String(err);
  return s === 429 || s === 503 || s === 500 || /RESOURCE_EXHAUSTED|quota|overloaded|unavailable/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `call` with the main model; on a rate limit or outage waits once if the
 * provider asks for a short pause, then moves to the next model in the chain.
 * Throws the last error if every model fails.
 */
export async function withModelFallback<T>(
  primary: { model: LanguageModel; label: string },
  call: (model: LanguageModel) => Promise<T>,
  opts: { maxWaitSeconds?: number } = {},
): Promise<{ value: T; label: string }> {
  const chain = [primary, ...fallbackModels()];
  let last: unknown;
  for (const m of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { value: await call(m.model), label: m.label };
      } catch (err) {
        last = err;
        if (!isRetryable(err)) throw err;
        const wait = retryAfterSeconds(err);
        if (attempt === 0 && wait !== null && wait <= (opts.maxWaitSeconds ?? 20)) {
          await sleep(Math.ceil(wait * 1000) + 250);
          continue;
        }
        break;
      }
    }
  }
  throw last;
}

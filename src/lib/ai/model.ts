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

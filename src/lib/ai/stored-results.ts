import type { RawEvidence, VerdictValue } from "./evidence";
import stored from "./stored-sample-results.json";

/**
 * Keeps the hosted demo working through the judging period when the free
 * Gemini quota runs out. For the bundled sample deliveries only, and only when
 * the live model is out of quota, the checker replays the live model's own
 * result for that exact sample, recorded by scripts/capture-sample-results.mts.
 * The replayed quotes go through the evidence rule again against the page as it
 * is read now, and the report says it is a stored result and gives its date.
 * A user's own delivery never gets a stored result: it gets the scripted
 * checker, as before.
 */

export type StoredSampleResult = {
  version: string;
  path: string;
  model: string;
  date: string;
  results: { criterion: string; verdict: VerdictValue; reasoning: string; evidence: string[] }[];
};

export const STORED_SAMPLE_RESULTS = stored as StoredSampleResult[];

/**
 * True when an error from the model means the live model cannot answer now: quota or rate limit used up,
 * or the provider overloaded or timing out (Gemini's 503 "high demand"). Used only to unlock a stored sample result.
 */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err as { statusCode?: number }).statusCode ?? ""} ${err.name}` : String(err);
  return /quota|rate limit|rate-limit|\b429\b|exhausted|too many requests|\b503\b|overloaded|high demand|unavailable|timed? ?out|timeout|aborted/i.test(msg);
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The stored result for this delivery, or null. It matches only the bundled
 * sample project, a delivery that is exactly one bundled sample link with no
 * files, and criteria that are exactly the sample's.
 */
export function storedResultFor(input: {
  isSample: boolean;
  links: string[];
  fileCount: number;
  criteria: string[];
  appOrigin: string;
  why: string;
}): { label: string; reason: string; results: { criterionId: string; verdict: VerdictValue; reasoning: string; evidence: RawEvidence[] }[] } | null {
  if (!input.isSample || input.fileCount > 0 || input.links.length !== 1) return null;
  const s = STORED_SAMPLE_RESULTS.find((r) => input.links[0] === `${input.appOrigin}/samples/${r.path}/index.html`);
  if (!s || s.results.length !== input.criteria.length) return null;
  const results = input.criteria.map((text, i) => {
    const r = s.results.find((x) => x.criterion === text);
    return r ? { criterionId: `c${i + 1}`, verdict: r.verdict, reasoning: r.reasoning, evidence: r.evidence.map((quote) => ({ source: input.links[0], quote })) } : null;
  });
  if (results.some((r) => r === null)) return null;
  return {
    label: `${s.model}, stored result of ${longDate(s.date)}`,
    reason: `${input.why}, so this sample delivery shows the live model's stored result for it, from ${longDate(s.date)}. Its quotes were checked again against the page`,
    results: results as NonNullable<(typeof results)[number]>[],
  };
}

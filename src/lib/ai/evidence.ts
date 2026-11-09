/**
 * Evidence must be real. Every quote the AI cites is checked here, in code,
 * against the exact text the tools returned (or the scope). Anything that does
 * not appear word for word is dropped and counted, never shown as evidence.
 */

export const MIN_QUOTE_CHARS = 8;

export function normalizeText(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type CorpusEntry = { source: string; text: string };

/** Returns the source whose text contains the quote, or null. Whitespace and quote styles are normalized; words and case are not. */
export function findQuote(quote: string, corpus: CorpusEntry[], preferredSource?: string): string | null {
  const q = normalizeText(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  const ordered = preferredSource
    ? [...corpus.filter((c) => c.source === preferredSource), ...corpus.filter((c) => c.source !== preferredSource)]
    : corpus;
  for (const c of ordered) if (normalizeText(c.text).includes(q)) return c.source;
  return null;
}

export type RawEvidence = { source: string; quote: string };
export type VerifiedEvidence = { source: string; quote: string };

export function verifyEvidence(items: RawEvidence[], corpus: CorpusEntry[]): { kept: VerifiedEvidence[]; dropped: RawEvidence[] } {
  const kept: VerifiedEvidence[] = [];
  const dropped: RawEvidence[] = [];
  for (const it of items) {
    const source = findQuote(it.quote, corpus, it.source);
    if (source) kept.push({ source, quote: normalizeText(it.quote) });
    else dropped.push(it);
  }
  return { kept, dropped };
}

export type VerdictValue = "met" | "not_met" | "needs_person";

/**
 * Apply the evidence rule to one verdict: a "met" with no surviving quote is
 * not trusted and goes to a person.
 */
export function enforceEvidenceRule(
  verdict: VerdictValue,
  kept: VerifiedEvidence[],
  droppedCount: number,
): { verdict: VerdictValue; note: string | null } {
  if (verdict === "met" && kept.length === 0) {
    return {
      verdict: "needs_person",
      note:
        droppedCount > 0
          ? `The checker said this was met, but ${droppedCount} quote(s) it gave could not be found in anything it read, so they were removed. A person should look.`
          : "The checker said this was met but gave no quote to back it up. A person should look.",
    };
  }
  if (droppedCount > 0) return { verdict, note: `${droppedCount} quote(s) were removed because they did not appear word for word in the material.` };
  return { verdict, note: null };
}

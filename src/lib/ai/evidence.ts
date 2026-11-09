/**
 * Evidence must be real. Every quote the AI cites is checked here, in code,
 * against what the delivery actually shows. A quote survives only if:
 * - it is at least MIN_QUOTE_CHARS long, so a lone word cannot prove a criterion;
 * - it is not the requirement itself (the criterion or its scope sentence);
 * - it appears word for word in text a visitor can see on a delivered page,
 *   in a delivered file, or in the repository. Hidden page text never counts.
 * - it shares at least one key word with the criterion.
 * Removed quotes are kept with the reason, and the report shows them.
 * Text from the freelancer's own notes is a claim, not proof: it is shown,
 * but a "met" that rests only on notes goes to a person.
 */

export const MIN_QUOTE_CHARS = 20;

export function normalizeText(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a corpus entry is. Only "page", "deliverable_file" and "repository" can carry a verdict. */
export type SourceKind = "page" | "deliverable_file" | "notes_file" | "repository";

export type CorpusEntry = { source: string; text: string; kind?: SourceKind; hidden?: string[] };

export type RawEvidence = { source: string; quote: string };
export type VerifiedEvidence = { source: string; quote: string; kind: SourceKind };
export type DroppedEvidence = { source: string; quote: string; reason: string };

const STOP = new Set(
  "the a an and or of to in on for with from by is are be can has have that this these those page each every at least one their its it as must should will was were which into about than then there here".split(" "),
);

function stems(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .toLowerCase()
      .replace(/[^a-z0-9$@ ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => (w.length > 4 ? w.slice(0, 4) : w)),
  );
}

export type Requirement = { text: string; sourceQuote: string };

/**
 * True when the quote is the requirement restated (all or nearly all of it)
 * rather than content the delivery shows. A page that pastes the criterion
 * sentence in does not prove the criterion; a fact the criterion also names,
 * such as an address, still counts.
 */
export function copiesRequirement(quote: string, req: Requirement): boolean {
  const q = normalizeText(quote).toLowerCase().replace(/[.!]+$/, "");
  for (const r of [req.text, req.sourceQuote]) {
    const t = normalizeText(r).toLowerCase().replace(/[.!]+$/, "");
    if (!t) continue;
    if (t.includes(q) && q.length >= Math.max(MIN_QUOTE_CHARS, t.length * 0.8)) return true;
    if (q.includes(t) && t.length >= MIN_QUOTE_CHARS) return true;
  }
  return false;
}

/** Returns the visible source holding the quote, preferring the one the model named. */
export function findQuote(quote: string, corpus: CorpusEntry[], preferredSource?: string): CorpusEntry | null {
  const q = normalizeText(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  const ordered = preferredSource ? [...corpus.filter((c) => c.source === preferredSource), ...corpus.filter((c) => c.source !== preferredSource)] : corpus;
  for (const c of ordered) if (normalizeText(c.text).includes(q)) return c;
  return null;
}

function inHidden(quote: string, corpus: CorpusEntry[]): boolean {
  const q = normalizeText(quote);
  return corpus.some((c) => (c.hidden ?? []).some((h) => normalizeText(h).includes(q)));
}

export function verifyEvidence(items: RawEvidence[], corpus: CorpusEntry[], req?: Requirement): { kept: VerifiedEvidence[]; dropped: DroppedEvidence[] } {
  const kept: VerifiedEvidence[] = [];
  const dropped: DroppedEvidence[] = [];
  const reqStems = req ? stems(`${req.text} ${req.sourceQuote}`) : null;
  for (const it of items) {
    const q = normalizeText(it.quote ?? "");
    const drop = (reason: string) => dropped.push({ source: it.source, quote: q.slice(0, 300), reason });
    if (q.length < MIN_QUOTE_CHARS) {
      drop(`too short to prove anything (under ${MIN_QUOTE_CHARS} characters)`);
      continue;
    }
    if (req && copiesRequirement(q, req)) {
      drop("copied from the requirement, not from the delivery");
      continue;
    }
    const hit = findQuote(q, corpus, it.source);
    if (!hit) {
      drop(inHidden(q, corpus) ? "hidden from visitors on the page" : "not found in anything the checker read");
      continue;
    }
    if (reqStems && reqStems.size > 0 && ![...stems(q)].some((w) => reqStems.has(w))) {
      drop("does not mention anything the criterion asks for");
      continue;
    }
    kept.push({ source: hit.source, quote: q, kind: hit.kind ?? "page" });
  }
  return { kept, dropped };
}

export type VerdictValue = "met" | "not_met" | "needs_person";

/**
 * Apply the evidence rule to one verdict: a "met" needs at least one surviving
 * quote from the delivery itself. Quotes from the freelancer's notes alone
 * send it to a person.
 */
export function enforceEvidenceRule(verdict: VerdictValue, kept: VerifiedEvidence[], dropped: DroppedEvidence[] | number): { verdict: VerdictValue; note: string | null } {
  const droppedCount = typeof dropped === "number" ? dropped : dropped.length;
  const proof = kept.filter((k) => k.kind !== "notes_file");
  if (verdict === "met" && proof.length === 0) {
    if (kept.length > 0) {
      return { verdict: "needs_person", note: "Only the freelancer's own notes support this. Notes are a claim, not proof, so a person should look." };
    }
    return {
      verdict: "needs_person",
      note:
        droppedCount > 0
          ? `The checker said this was met, but all ${droppedCount} of its quote(s) were removed, so a person should look.`
          : "The checker said this was met but gave no quote to back it up. A person should look.",
    };
  }
  if (droppedCount > 0) return { verdict, note: `${droppedCount} quote(s) were removed. See why below.` };
  return { verdict, note: null };
}

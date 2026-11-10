/**
 * Evidence must be real. Every quote the AI cites is checked here, in code,
 * against what the delivery actually shows. A quote survives only if:
 * - it is at least MIN_QUOTE_CHARS long, so a lone word cannot prove a criterion,
 *   or at least MIN_SHORT_QUOTE_CHARS when it shows every value the criterion names;
 * - it is not the requirement itself (the criterion or its scope sentence);
 * - it appears word for word in text a visitor can see on a delivered page,
 *   in a delivered file, or in the repository. Hidden page text never counts.
 * - it, or the heading just above it, shares at least one key word with the criterion.
 * And a "met" needs its quotes, together, to contain the specific numbers and
 * names the criterion states (a time, a price, an address).
 * Removed quotes are kept with the reason, and the report shows them.
 * Text from the freelancer's own notes is a claim, not proof: it is shown,
 * but a "met" that rests only on notes goes to a person.
 */

export const MIN_QUOTE_CHARS = 20;
/**
 * A shorter quote, down to this length, still counts when the criterion names
 * specific values and the quote, two words or more, shows every one of them: "Two-hour hire: $35"
 * proves "lists two-hour hire at $35". A lone word or number never does.
 */
export const MIN_SHORT_QUOTE_CHARS = 8;

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
export function findQuote(quote: string, corpus: CorpusEntry[], preferredSource?: string, minChars = MIN_QUOTE_CHARS): CorpusEntry | null {
  const q = normalizeText(quote);
  if (q.length < minChars) return null;
  const ordered = preferredSource ? [...corpus.filter((c) => c.source === preferredSource), ...corpus.filter((c) => c.source !== preferredSource)] : corpus;
  for (const c of ordered) if (normalizeText(c.text).includes(q)) return c;
  return null;
}

/** Up to 60 characters of text just before the quote in its source: usually the heading above a list. */
export function headingBefore(text: string, quote: string): string {
  const t = normalizeText(text);
  const at = t.indexOf(normalizeText(quote));
  return at > 0 ? t.slice(Math.max(0, at - 60), at) : "";
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
    const shortButExact = !!req && q.length >= MIN_SHORT_QUOTE_CHARS && q.split(" ").length >= 2 && specifics(req.text).length > 0 && missingSpecifics(req.text, [q]).length === 0;
    if (q.length < MIN_QUOTE_CHARS && !shortButExact) {
      drop(`too short to prove anything (under ${MIN_QUOTE_CHARS} characters)`);
      continue;
    }
    if (req && copiesRequirement(q, req)) {
      drop("copied from the requirement, not from the delivery");
      continue;
    }
    const hit = findQuote(q, corpus, it.source, shortButExact ? MIN_SHORT_QUOTE_CHARS : MIN_QUOTE_CHARS);
    if (!hit) {
      drop(inHidden(q, corpus) ? "hidden from visitors on the page" : "not found in anything the checker read");
      continue;
    }
    // A list often sits under the heading that says what it is ("Three focus channels", then the channels), so the words just before the quote count too.
    if (reqStems && reqStems.size > 0 && ![...stems(`${headingBefore(hit.text, q)} ${q}`)].some((w) => reqStems.has(w))) {
      drop("does not mention anything the criterion asks for");
      continue;
    }
    kept.push({ source: hit.source, quote: q, kind: hit.kind ?? "page" });
  }
  return { kept, dropped };
}

export type VerdictValue = "met" | "not_met" | "needs_person";

/**
 * True when a criterion is about a live page, site or app rather than a
 * document. A file the freelancer uploads can prove what a document says; it
 * cannot prove what a live page shows. That needs a link to the page.
 */
export function aboutPage(criterion: string): boolean {
  // A criterion about a document ("the 6-page strategy PDF lists...") is about the file, not a live page.
  if (/\b(document|pdf|docx?|report|deck|slides?|spreadsheet|handover|brochure|guide|strategy)\b/i.test(criterion)) return false;
  return /\b(page|pages|site|website|web site|homepage|landing|screen|app|button|form|visitors?|browser|menu|navigation|header|footer|mobile)\b/i.test(criterion);
}

/**
 * Apply the evidence rule to one verdict: a "met" needs at least one surviving
 * quote from the delivery itself. Quotes from the freelancer's notes alone
 * send it to a person.
 */
const COMMON_CAPS = new Set([
  "The", "A", "An", "Visitors", "Visitor", "Users", "User", "Each", "Every", "All", "It", "This", "That", "Page", "Site", "Our", "Your",
  // Generic abbreviations name a kind of thing, not a specific value.
  "URL", "URLs", "PDF", "API", "APIs", "HTML", "CSS", "ID", "IDs", "FAQ", "SEO", "UI", "UX", "CTA", "CI", "CD", "CMS", "SSL", "DNS", "HTTP", "HTTPS", "JSON", "CSV", "README",
]);

/**
 * The specific values a criterion names: numbers, times and prices, and
 * capitalised names that are not the first word. A "met" must show them.
 */
export function specifics(criterion: string): string[] {
  const out = new Set<string>();
  for (const m of criterion.matchAll(/\d+(?:[:.,]\d+)*/g)) out.add(m[0]);
  const words = criterion.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i > 0 && /^\p{Lu}[\p{L}'-]+$/u.test(w) && !COMMON_CAPS.has(w)) out.add(w);
  });
  return [...out];
}

/** Specific values the criterion names that none of the quotes contain. */
export function missingSpecifics(criterion: string, quotes: string[]): string[] {
  const hay = normalizeText(quotes.join(" ")).toLowerCase();
  return specifics(criterion).filter((v) => !hay.includes(v.toLowerCase()));
}

export function enforceEvidenceRule(
  verdict: VerdictValue,
  kept: VerifiedEvidence[],
  dropped: DroppedEvidence[] | number,
  opts: { pageCriterion?: boolean; criterion?: string } = {},
): { verdict: VerdictValue; note: string | null } {
  const droppedCount = typeof dropped === "number" ? dropped : dropped.length;
  const proof = kept.filter((k) => k.kind !== "notes_file" && !(opts.pageCriterion && k.kind === "deliverable_file"));
  if (verdict === "met" && proof.length > 0 && opts.criterion) {
    const missing = missingSpecifics(opts.criterion, proof.map((k) => k.quote));
    if (missing.length) {
      return { verdict: "needs_person", note: `The checker called this met, but its quotes do not show ${missing.map((m) => `"${m}"`).join(", ")}, which the criterion names, so a person should look.` };
    }
  }
  if (verdict === "met" && proof.length === 0) {
    if (kept.some((k) => k.kind === "deliverable_file") && opts.pageCriterion) {
      return { verdict: "needs_person", note: "The checker called this met, but only an uploaded file supports it, and a file is the freelancer's own copy, not the live page. A person should check the live page." };
    }
    if (kept.length > 0) {
      return { verdict: "needs_person", note: "The checker called this met, but only the freelancer's own notes support it. Notes are a claim, not proof, so a person should look." };
    }
    return {
      verdict: "needs_person",
      note:
        droppedCount > 0
          ? `The checker called this met, but all ${droppedCount} of its quote(s) were removed, so a person should look.`
          : "The checker called this met but gave no quote to back it up. A person should look.",
    };
  }
  if (droppedCount > 0) return { verdict, note: `${droppedCount} quote(s) were removed. See why below.` };
  return { verdict, note: null };
}

// ------------------------------------------------------------ person-judged criteria

/**
 * Scope lines about taste or feel ("modern", "mobile friendly", "calm and
 * professional") are what clients argue about later, so the planner never
 * drops them. It keeps each one as a criterion with this prefix, and the
 * checker always sends such a criterion to a person.
 */
export const PERSON_PREFIX = "For a person to judge: ";

export function isPersonCriterion(text: string): boolean {
  return normalizeText(text).toLowerCase().startsWith(PERSON_PREFIX.trim().toLowerCase());
}

export function asPersonCriterion(text: string): string {
  const t = normalizeText(text);
  return isPersonCriterion(t) ? t : `${PERSON_PREFIX}${t}`;
}

/** Words that mark a line as a matter of taste or of how something feels to use, not a fact the checker can read. */
export const SUBJECTIVE =
  /\b(modern|mobile[- ]friendly|responsive|user[- ]friendly|easy to use|intuitive|looks?|feels?|professional|calm|clean|trustworthy|on[- ]brand|polished|beautiful|attractive|elegant|stylish|premium|sleek|tone|template|nice)\b/i;

const PERSON_REASONING = "The scope asks for this, and it is a matter of judgement, not a fact on the page, so the checker does not decide it. A person should look at the delivery.";

const GENERIC_STEMS = new Set(["page", "show", "list", "site", "webs", "visi", "incl", "name", "disp", "link", "deli", "cont", "has", "give"]);

/**
 * On a "not met", a quote is not evidence for anything. It can only show what
 * the delivery has instead (a different phone number, "schedule coming soon").
 * Keep it only when it bears on the criterion: it contains one of the values
 * the criterion names, or shares two of its key words beyond page and site.
 */
export function bearsOn(quote: string, criterion: string): boolean {
  const q = normalizeText(quote).toLowerCase();
  if (specifics(criterion).some((v) => q.includes(v.toLowerCase()))) return true;
  const c = new Set([...stems(criterion)].filter((w) => !GENERIC_STEMS.has(w)));
  return [...stems(quote)].filter((w) => c.has(w)).length >= 2;
}

/**
 * The verdict a report shows, after the evidence rule. When the code changes
 * the model's verdict, the model's own sentence is replaced by the reason, so
 * a client never reads "the delivery covers everything" above "needs a person".
 */
export function finalizeVerdict(input: {
  criterion: string;
  verdict: VerdictValue;
  reasoning: string;
  kept: VerifiedEvidence[];
  dropped: DroppedEvidence[];
  pageCriterion?: boolean;
}): { verdict: VerdictValue; reasoning: string; note: string | null; evidence: VerifiedEvidence[]; dropped: DroppedEvidence[] } {
  let kept = input.kept;
  const dropped = [...input.dropped];
  if (isPersonCriterion(input.criterion)) {
    return { verdict: "needs_person", reasoning: PERSON_REASONING, note: null, evidence: kept, dropped };
  }
  if (input.verdict === "not_met") {
    const off = kept.filter((k) => !bearsOn(k.quote, input.criterion));
    for (const k of off) dropped.push({ source: k.source, quote: k.quote, reason: "does not mention what the criterion asks for, so it is not shown" });
    kept = kept.filter((k) => !off.includes(k));
    const enforced = enforceEvidenceRule("not_met", kept, input.dropped.length);
    return { verdict: "not_met", reasoning: input.reasoning, note: enforced.note, evidence: kept, dropped };
  }
  const enforced = enforceEvidenceRule(input.verdict, kept, dropped, { pageCriterion: input.pageCriterion, criterion: input.criterion });
  if (enforced.verdict !== input.verdict) {
    // The model's sentence argued for the verdict the code just refused. Show the reason instead.
    return { verdict: enforced.verdict, reasoning: enforced.note ?? "The evidence check did not accept the checker's verdict. A person should look.", note: null, evidence: kept, dropped };
  }
  return { verdict: enforced.verdict, reasoning: input.reasoning, note: enforced.note, evidence: kept, dropped };
}

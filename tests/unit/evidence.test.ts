import { describe, expect, it } from "vitest";
import { MIN_QUOTE_CHARS, copiesRequirement, enforceEvidenceRule, findQuote, normalizeText, verifyEvidence } from "@/lib/ai/evidence";
import { htmlToText } from "@/lib/ai/tools/html-text";

const corpus = [
  { source: "https://a.example/", text: "Saturday wheel-throwing class,   start time 10:00\nStudio address: 14 Kiln Lane, Portland", kind: "page" as const, hidden: ["Hand-building class on Monday at 9:00"] },
  { source: "https://b.example/", text: "Find the studio at 14 Kiln Lane, Portland, near the river", kind: "page" as const },
  { source: "file:notes.txt", text: "The waitlist signup form is on the landing page", kind: "notes_file" as const },
];
const req = { text: "The page shows the studio address: 14 Kiln Lane, Portland.", sourceQuote: "The page shows the studio address: 14 Kiln Lane, Portland." };

describe("evidence verification", () => {
  it("accepts a quote that appears word for word, ignoring whitespace runs", () => {
    expect(findQuote("Saturday wheel-throwing class, start time 10:00", corpus)?.source).toBe("https://a.example/");
  });
  it("normalizes curly quotes but not words", () => {
    expect(normalizeText("it\u2019s  here")).toBe("it's here");
    expect(findQuote("Saturday pottery class, start time 10:00", corpus)).toBeNull();
  });
  it("rejects quotes under the minimum length, with the reason", () => {
    const { kept, dropped } = verifyEvidence([{ source: "https://a.example/", quote: "Saturday" }], corpus, req);
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/too short/);
    expect(MIN_QUOTE_CHARS).toBeGreaterThanOrEqual(20);
  });
  it("re-attributes a real quote to the delivery source that actually contains it", () => {
    const { kept } = verifyEvidence([{ source: "made-up-source", quote: "near the river" + "" }, { source: "made-up", quote: "at 14 Kiln Lane, Portland, near the river" }], corpus, req);
    expect(kept.map((k) => k.source)).toEqual(["https://b.example/"]);
  });
  it("drops invented quotes, with the reason", () => {
    const { kept, dropped } = verifyEvidence([{ source: "https://a.example/", quote: "Opening hours: 9 to 5 daily at the studio" }], corpus, req);
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/not found/);
  });
  it("drops a quote of the requirement itself", () => {
    expect(copiesRequirement("The page shows the studio address: 14 Kiln Lane, Portland.", req)).toBe(true);
    expect(copiesRequirement("14 Kiln Lane, Portland", req)).toBe(false);
    const { dropped } = verifyEvidence([{ source: "x", quote: "The page shows the studio address: 14 Kiln Lane, Portland." }], [...corpus, { source: "copy", text: req.text, kind: "page" as const }], req);
    expect(dropped[0].reason).toMatch(/copied from the requirement/);
  });
  it("drops text that is hidden from visitors", () => {
    const { dropped } = verifyEvidence([{ source: "https://a.example/", quote: "Hand-building class on Monday at 9:00" }], corpus, { text: "The page lists the Monday hand-building class", sourceQuote: "Monday hand-building class" });
    expect(dropped[0].reason).toMatch(/hidden from visitors/);
  });
  it("drops a real quote that has nothing to do with the criterion", () => {
    const { dropped } = verifyEvidence([{ source: "https://a.example/", quote: "Saturday wheel-throwing class, start time 10:00" }], corpus, req);
    expect(dropped[0].reason).toMatch(/does not mention/);
  });
  it("turns a met verdict with no surviving quote into needs_person", () => {
    expect(enforceEvidenceRule("met", [], 2).verdict).toBe("needs_person");
    expect(enforceEvidenceRule("met", [{ source: "s", quote: "q", kind: "page" }], 0)).toEqual({ verdict: "met", note: null });
    expect(enforceEvidenceRule("not_met", [], 0).verdict).toBe("not_met");
  });
  it("does not let the freelancer's notes alone carry a met", () => {
    const r = enforceEvidenceRule("met", [{ source: "file:notes.txt", quote: "The waitlist signup form is on the landing page", kind: "notes_file" }], 0);
    expect(r.verdict).toBe("needs_person");
    expect(r.note).toMatch(/notes/);
  });
});

describe("html to text", () => {
  it("keeps visible text and form controls, drops scripts", () => {
    const { title, text } = htmlToText(`<html><head><title>T &amp; Co</title></head><body><script>alert(1)</script><h1>Hello</h1><p>Join: <input type="email" placeholder="Your email"> <button>Go</button></p></body></html>`);
    expect(title).toBe("T & Co");
    expect(text).toContain("Hello");
    expect(text).toContain("[email field: Your email]");
    expect(text).toContain("[button: Go]");
    expect(text).not.toContain("alert");
  });
  it("keeps hidden text apart from visible text", () => {
    const { text, hidden } = htmlToText(`<main><h1>Larkspur Pottery Studio</h1><p style="display:none">Saturday class start time 10:00</p><div hidden>Studio address 14 Kiln Lane</div><span style="opacity: 0">secret</span><p>Visible</p></main>`);
    expect(text).toBe("Larkspur Pottery Studio\nVisible");
    expect(hidden).toEqual(["Saturday class start time 10:00", "Studio address 14 Kiln Lane", "secret"]);
  });
  it("keeps table rows on one line", () => {
    expect(htmlToText("<table><tr><td>Wheel</td><td>$240</td></tr></table>").text).toBe("Wheel | $240");
  });
});

describe("uploaded files", () => {
  it("extracts quotable text from the sample PDF", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileToText } = await import("@/lib/services/files");
    const f = await fileToText("handover.pdf", "application/pdf", new Uint8Array(await readFile("public/samples/eval/handover.pdf")));
    expect(f.mime).toBe("application/pdf");
    expect(normalizeText(f.text)).toContain("The site is hosted on Northwind Pages, on the Starter plan.");
  });
});

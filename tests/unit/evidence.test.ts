import { describe, expect, it } from "vitest";
import { enforceEvidenceRule, findQuote, normalizeText, verifyEvidence } from "@/lib/ai/evidence";
import { htmlToText } from "@/lib/ai/tools/html-text";

const corpus = [
  { source: "https://a.example/", text: "Saturday wheel-throwing class,   start time 10:00\nStudio address: 14 Kiln Lane" },
  { source: "scope", text: "The page shows the studio address: 14 Kiln Lane, Portland." },
];

describe("evidence verification", () => {
  it("accepts a quote that appears word for word, ignoring whitespace runs", () => {
    expect(findQuote("Saturday wheel-throwing class, start time 10:00", corpus)).toBe("https://a.example/");
  });
  it("normalizes curly quotes but not words", () => {
    expect(normalizeText("it’s  here")).toBe("it's here");
    expect(findQuote("Saturday pottery class, start time 10:00", corpus)).toBeNull();
  });
  it("rejects quotes that are too short to mean anything", () => {
    expect(findQuote("10:00", corpus)).toBeNull();
  });
  it("re-attributes a real quote to the source that actually contains it", () => {
    const { kept } = verifyEvidence([{ source: "made-up-source", quote: "14 Kiln Lane, Portland" }], corpus);
    expect(kept).toEqual([{ source: "scope", quote: "14 Kiln Lane, Portland" }]);
  });
  it("drops invented quotes", () => {
    const { kept, dropped } = verifyEvidence([{ source: "https://a.example/", quote: "Opening hours: 9 to 5 daily" }], corpus);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
  it("turns a met verdict with no surviving quote into needs_person", () => {
    expect(enforceEvidenceRule("met", [], 2).verdict).toBe("needs_person");
    expect(enforceEvidenceRule("met", [{ source: "s", quote: "q" }], 0)).toEqual({ verdict: "met", note: null });
    expect(enforceEvidenceRule("not_met", [], 0).verdict).toBe("not_met");
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
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { htmlToText } from "@/lib/ai/tools/html-text";
import { hidingReason, matches, normalizeColor, parseCss, parseSelector } from "@/lib/ai/tools/css-hidden";
import { readUrl, type ToolContext } from "@/lib/ai/tools";
import { startStaticServer } from "./helpers";

const page = (css: string, body: string) => htmlToText(`<html><head><style>${css}</style></head><body>${body}</body></html>`);

describe("hiding techniques from a <style> block", () => {
  const cases: [string, string, string][] = [
    ["display none", ".a { display: none }", "display none"],
    ["visibility hidden", ".a { visibility: hidden }", "visibility hidden"],
    ["zero opacity", ".a { opacity: 0 }", "zero opacity"],
    ["zero font size", ".a { font-size: 0px }", "zero font size"],
    ["clip rect", ".a { position: absolute; clip: rect(0, 0, 0, 0) }", "clipped"],
    ["clip-path inset", ".a { clip-path: inset(50%) }", "clipped"],
    ["one pixel box", ".a { width: 1px; height: 1px; overflow: hidden }", "zero-size box"],
    ["off-screen left", ".a { position: absolute; left: -9999px }", "positioned off screen"],
    ["off-screen top in em", ".a { position: fixed; top: -100em }", "positioned off screen"],
    ["translate away", ".a { transform: translateX(-10000px) }", "moved off screen"],
    ["negative text indent", ".a { text-indent: -9999px }", "negative text indent"],
    ["colour like background", "body { background: #FFFFFF } .a { color: white }", "text coloured like its background"],
  ];
  for (const [name, css, reason] of cases) {
    it(`hides text with ${name}`, () => {
      const r = page(css, `<p>Visible line</p><p class="a">Secret line</p>`);
      expect(r.text).toBe("Visible line");
      expect(r.hidden).toEqual(["Secret line"]);
      expect(r.hiddenReasons).toEqual([reason]);
    });
  }

  it("leaves normal styling alone", () => {
    const r = page("p { color: #333; background: #fff; position: absolute; left: 10px; text-indent: 2em; opacity: 0.9 }", "<p>Visible line</p>");
    expect(r.text).toBe("Visible line");
    expect(r.hidden).toEqual([]);
  });

  it("ignores print-only rules", () => {
    const r = page("@media print { .a { display: none } }", `<p class="a">Shown on screen</p>`);
    expect(r.text).toBe("Shown on screen");
  });

  it("applies screen media queries", () => {
    const r = page("@media screen and (min-width: 1px) { .a { display: none } }", `<p class="a">Secret</p>`);
    expect(r.hidden).toEqual(["Secret"]);
  });

  it("lets a more specific or later rule win", () => {
    expect(page(".a { display: none } #b { display: block }", `<p class="a" id="b">Shown</p>`).text).toBe("Shown");
    expect(page(".a { display: none } .a { display: block }", `<p class="a">Shown</p>`).text).toBe("Shown");
    expect(page("#b { display: block } .a { display: none }", `<p class="a" id="b">Shown</p>`).text).toBe("Shown");
  });
});

describe("selectors", () => {
  const sel = (s: string) => parseSelector(s)!;
  const el = (tag: string, id: string | null = null, classes: string[] = [], attrs: Record<string, string> = {}) => ({ tag, id, classes, attrs });
  it("matches tag, class, id, attribute and compounds", () => {
    expect(matches(sel("p"), [el("p")])).toBe(true);
    expect(matches(sel(".x"), [el("p", null, ["x", "y"])])).toBe(true);
    expect(matches(sel("#k"), [el("p", "k")])).toBe(true);
    expect(matches(sel("div.note#k.y"), [el("div", "k", ["note", "y"])])).toBe(true);
    expect(matches(sel("div.note#k.y"), [el("div", "k", ["note"])])).toBe(false);
    expect(matches(sel("[data-x]"), [el("p", null, [], { "data-x": "1" })])).toBe(true);
    expect(matches(sel('[data-x="2"]'), [el("p", null, [], { "data-x": "1" })])).toBe(false);
  });
  it("matches descendant and child combinators", () => {
    const path = [el("main"), el("div", null, ["schedule"]), el("p", null, ["later"])];
    expect(matches(sel("main .later"), path)).toBe(true);
    expect(matches(sel("main > .later"), path)).toBe(false);
    expect(matches(sel(".schedule > .later"), path)).toBe(true);
    expect(matches(sel("main .schedule > p.later"), path)).toBe(true);
    expect(matches(sel("section .later"), path)).toBe(false);
  });
  it("skips selectors it does not understand rather than guessing", () => {
    expect(parseSelector("a:hover")).toBeNull();
    expect(parseSelector("p::before")).toBeNull();
    expect(parseSelector("h1 + p")).toBeNull();
    expect(parseCss("a:hover, .ok { display: none }")).toHaveLength(1);
  });
  it("normalises colours", () => {
    expect(normalizeColor("#FFF")).toBe("#ffffff");
    expect(normalizeColor("rgb(255, 255, 255)")).toBe("#ffffff");
    expect(normalizeColor("white")).toBe("#ffffff");
    expect(hidingReason({ display: "block" })).toBeNull();
  });
});

describe("the stylesheet cheat sample, through the read_url tool", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => ({ server, origin } = await startStaticServer()));
  afterAll(() => server.close());

  it("reads the linked stylesheet and finds every hidden block", async () => {
    const link = `${origin}/samples/eval/css-cheat/index.html`;
    const ctx: ToolContext = { links: [link], files: [], records: [], selfOrigin: origin };
    await readUrl(ctx, link);
    const r = ctx.records[0];
    expect(r.ok).toBe(true);
    expect(r.quotable).not.toMatch(/10:00|Mill Lane|AI checker/);
    expect(r.quotable).toContain("Saturday sourdough (schedule coming soon)");
    expect(r.hiddenReasons).toEqual(
      expect.arrayContaining(["negative text indent", "positioned off screen", "clipped", "zero opacity", "zero font size", "text coloured like its background"]),
    );
    expect(r.hidden).toHaveLength(6);
  });
});

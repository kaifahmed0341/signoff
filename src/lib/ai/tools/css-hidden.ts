/**
 * Finds text a stylesheet hides from visitors. This is not a CSS engine: it
 * reads rules from <style> blocks and linked stylesheets, matches simple
 * selectors against an element's ancestry, and recognises the common ways of
 * hiding text:
 *
 *   display:none, visibility:hidden or collapse, opacity:0, font-size:0,
 *   clip:rect(0...) or clip-path:inset(50%+), a 0 or 1 pixel box with
 *   overflow hidden, off-screen positioning (position absolute or fixed with
 *   left, top, right or a translate of -500px or more), text-indent of -500px
 *   or less, and text coloured the same as its background where both are stated.
 *
 * Selectors understood: tag, .class, #id, [attr] and [attr=value], and
 * compounds of these (div.note#x), joined by descendant or child combinators,
 * in comma lists. Rules with pseudo-classes, pseudo-elements, or sibling
 * combinators are skipped. @media print and other non-screen media are
 * skipped; other at-rule blocks are read as if they apply.
 */

export type Decls = Record<string, string>;
type Simple = { tag?: string; id?: string; classes: string[]; attrs: { name: string; value?: string }[] };
type Selector = { parts: Simple[]; combinators: (" " | ">")[] };
export type CssRule = { selectors: Selector[]; decls: Decls; order: number; specificity: number };

export type ElementInfo = { tag: string; id: string | null; classes: string[]; attrs: Record<string, string> };

const MAX_CSS_CHARS = 400_000;

// ------------------------------------------------------------------ parsing

function parseDecls(body: string): Decls {
  const out: Decls = {};
  for (const part of body.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const name = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).replace(/!important/i, "").trim().toLowerCase();
    if (name && value) out[name] = value;
  }
  return out;
}

function parseSimple(s: string): Simple | null {
  if (!s || /[:~+]/.test(s)) return null;
  const out: Simple = { classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:=\s*["']?([^"'\]]*)["']?\s*)?\]|(\*)/g;
  let consumed = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index !== consumed) return null;
    consumed = re.lastIndex;
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push({ name: m[4].toLowerCase(), value: m[5] });
  }
  return consumed === s.length ? out : null;
}

export function parseSelector(text: string): Selector | null {
  const tokens = text.trim().replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean);
  const parts: Simple[] = [];
  const combinators: (" " | ">")[] = [];
  let pending: " " | ">" = " ";
  for (const t of tokens) {
    if (t === ">") {
      pending = ">";
      continue;
    }
    const simple = parseSimple(t);
    if (!simple) return null;
    if (parts.length) combinators.push(pending);
    parts.push(simple);
    pending = " ";
  }
  return parts.length ? { parts, combinators } : null;
}

function specificityOf(sel: Selector): number {
  let s = 0;
  for (const p of sel.parts) s += (p.id ? 100 : 0) + (p.classes.length + p.attrs.length) * 10 + (p.tag ? 1 : 0);
  return s;
}

/** Parses CSS text into rules, skipping blocks for non-screen media. */
export function parseCss(css: string, startOrder = 0): CssRule[] {
  const rules: CssRule[] = [];
  let order = startOrder;
  const text = css.slice(0, MAX_CSS_CHARS).replace(/\/\*[\s\S]*?\*\//g, " ");
  const walk = (src: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim();
      // Find the matching close brace.
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) {
        const at = prelude.toLowerCase();
        const skip = /^@(font-face|keyframes|-webkit-keyframes|page|counter-style|property)/.test(at) || (/^@media/.test(at) && !/screen|all|width|height|prefers|orientation|hover|pointer/.test(at) && /print|speech/.test(at));
        if (!skip) walk(body);
      } else {
        const decls = parseDecls(body);
        const selectors = prelude.split(",").map(parseSelector).filter((s): s is Selector => s !== null);
        if (selectors.length && Object.keys(decls).length) {
          for (const s of selectors) rules.push({ selectors: [s], decls, order: order++, specificity: specificityOf(s) });
        }
      }
      i = j;
    }
  };
  walk(text);
  return rules;
}

// ------------------------------------------------------------------ matching

function matchesSimple(s: Simple, el: ElementInfo): boolean {
  if (s.tag && s.tag !== el.tag) return false;
  if (s.id && s.id !== el.id) return false;
  for (const c of s.classes) if (!el.classes.includes(c)) return false;
  for (const a of s.attrs) {
    if (!(a.name in el.attrs)) return false;
    if (a.value !== undefined && el.attrs[a.name] !== a.value) return false;
  }
  return true;
}

/** True when the selector matches the last element of `path` (ancestors first). */
export function matches(sel: Selector, path: ElementInfo[]): boolean {
  const n = sel.parts.length;
  if (!path.length || !matchesSimple(sel.parts[n - 1], path[path.length - 1])) return false;
  let pi = path.length - 2;
  for (let k = n - 2; k >= 0; k--) {
    const comb = sel.combinators[k];
    if (comb === ">") {
      if (pi < 0 || !matchesSimple(sel.parts[k], path[pi])) return false;
      pi--;
    } else {
      while (pi >= 0 && !matchesSimple(sel.parts[k], path[pi])) pi--;
      if (pi < 0) return false;
      pi--;
    }
  }
  return true;
}

/** The declarations that apply to the last element of `path`: matched rules by specificity and order, then the inline style. */
export function computedDecls(rules: CssRule[], path: ElementInfo[], inline: string | null): Decls {
  const hits = rules.filter((r) => r.selectors.some((s) => matches(s, path))).sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const out: Decls = {};
  for (const r of hits) Object.assign(out, r.decls);
  if (inline) Object.assign(out, parseDecls(inline));
  return out;
}

// ------------------------------------------------------------------ hiding

function px(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().match(/^(-?\d*\.?\d+)(px|em|rem|vw|vh|%)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "px";
  if (unit === "em" || unit === "rem") return n * 16;
  if (unit === "vw" || unit === "vh" || unit === "%") return n * 10;
  return n;
}

const OFFSCREEN = -500;

/** Why these declarations hide the element's own content, or null if they do not. */
export function hidingReason(d: Decls): string | null {
  if (d.display === "none") return "display none";
  if (d.visibility === "hidden" || d.visibility === "collapse") return "visibility hidden";
  if (d.opacity !== undefined && Number(d.opacity) === 0) return "zero opacity";
  if (d["font-size"] !== undefined && px(d["font-size"]) === 0) return "zero font size";
  if (d.clip && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(d.clip)) return "clipped";
  if (d["clip-path"] && /inset\(\s*(50|[5-9]\d|100)%|circle\(\s*0/.test(d["clip-path"])) return "clipped";
  const w = px(d.width);
  const h = px(d.height);
  if (d.overflow === "hidden" && ((w !== null && w <= 1) || (h !== null && h <= 1))) return "zero-size box";
  if (d.position === "absolute" || d.position === "fixed") {
    for (const side of ["left", "top", "right"]) {
      const v = px(d[side]);
      if (v !== null && v <= OFFSCREEN) return "positioned off screen";
    }
  }
  const t = d.transform?.match(/translate[xy]?\(\s*(-?\d+)px/);
  if (t && Number(t[1]) <= OFFSCREEN) return "moved off screen";
  const indent = px(d["text-indent"]);
  if (indent !== null && indent <= OFFSCREEN) return "negative text indent";
  return null;
}

const NAMED: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", navy: "#000080", maroon: "#800000", purple: "#800080", teal: "#008080", orange: "#ffa500", beige: "#f5f5dc",
  ivory: "#fffff0", linen: "#faf0e6", snow: "#fffafa", whitesmoke: "#f5f5f5", transparent: "transparent",
};

/** Normalises a CSS colour to #rrggbb where it can, for comparing text with background. */
export function normalizeColor(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${m[1].split("").map((c) => c + c).join("")}`;
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return `#${m[1]}`;
  m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

/** The background colour a rule states, from background-color or a colour inside the background shorthand. */
export function backgroundOf(d: Decls): string | null {
  if (d["background-color"]) return normalizeColor(d["background-color"]);
  if (!d.background) return null;
  for (const token of d.background.split(/\s+(?![^(]*\))/)) {
    const c = normalizeColor(token);
    if (c) return c;
  }
  return null;
}

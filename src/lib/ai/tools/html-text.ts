/**
 * Turn HTML into readable lines the checker can quote, and keep text a
 * visitor cannot see apart from text they can.
 *
 * Removed entirely: scripts, styles, comments, templates, the <head>.
 * Kept apart as hidden: elements with the `hidden` attribute, and elements an
 * inline style, a <style> block or a linked stylesheet hides (see
 * css-hidden.ts for the techniques and selectors understood). Hidden text is
 * never evidence; the checker reports it as a finding instead.
 * aria-hidden content is visible on screen, so it stays visible.
 * Form controls become short bracketed notes so "has an email signup form"
 * can be checked and quoted.
 */

import { backgroundOf, computedDecls, hidingReason, normalizeColor, parseCss, type CssRule, type ElementInfo } from "./css-hidden";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", copy: "(c)" };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BLOCK_END = /^(p|div|section|article|header|footer|main|nav|li|h[1-6]|tr|form|ul|ol|table|label|dd|dt|blockquote|address|aside|figure|figcaption)$/;

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function hasBooleanAttr(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}(\\s|=|/?>|$)`, "i").test(tag);
}

/** Hidden by its own attributes alone (the hidden attribute or an inline style), without any stylesheet. */
export function isHiddenTag(tag: string): boolean {
  if (hasBooleanAttr(tag, "hidden")) return true;
  return hidingReason(computedDecls([], [{ tag: "x", id: null, classes: [], attrs: {} }], attr(tag, "style"))) !== null;
}

function inlineNote(tag: string, name: string): string {
  if (name === "input") {
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (type === "hidden") return " ";
    const label = attr(tag, "placeholder") ?? attr(tag, "aria-label") ?? attr(tag, "name") ?? "";
    return ` [${type} field: ${label}] `;
  }
  if (name === "img") {
    const alt = attr(tag, "alt");
    return alt ? ` [image: ${alt}] ` : " ";
  }
  if (name === "br" || name === "hr") return "\n";
  return " ";
}

function tidy(s: string): string {
  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim().replace(/\s*\|$/, "").replace(/^\|\s*/, ""))
    .filter(Boolean)
    .join("\n");
}

export type PageText = {
  title: string | null;
  text: string;
  /** Blocks of text a visitor cannot see. */
  hidden: string[];
  /** Why each hidden block is hidden, in the same order. */
  hiddenReasons: string[];
  /** Stylesheet links on the page, for the caller to fetch and pass back in. */
  stylesheets: string[];
};

function allAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\s([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

/** Linked stylesheets in the page head or body: <link rel="stylesheet" href>. Print-only sheets are skipped. */
export function stylesheetLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = allAttrs(m[0]);
    if (!/(^|\s)stylesheet(\s|$)/i.test(a.rel ?? "") || !a.href) continue;
    if (a.media && /print|speech/i.test(a.media) && !/screen|all/i.test(a.media)) continue;
    out.push(a.href);
  }
  return out;
}

type Indexed = { byKey: Map<string, CssRule[]>; any: CssRule[] };

function indexRules(rules: CssRule[]): Indexed {
  const byKey = new Map<string, CssRule[]>();
  const any: CssRule[] = [];
  for (const r of rules) {
    const last = r.selectors[0].parts[r.selectors[0].parts.length - 1];
    const key = last.id ? `#${last.id}` : last.classes[0] ? `.${last.classes[0]}` : last.tag ? last.tag : null;
    if (!key) any.push(r);
    else byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return { byKey, any };
}

function candidates(ix: Indexed, el: ElementInfo): CssRule[] {
  const out = [...ix.any, ...(ix.byKey.get(el.tag) ?? [])];
  if (el.id) out.push(...(ix.byKey.get(`#${el.id}`) ?? []));
  for (const c of el.classes) out.push(...(ix.byKey.get(`.${c}`) ?? []));
  return out;
}

/**
 * HTML to visible text. `extraCss` holds the text of linked stylesheets the
 * caller fetched; <style> blocks in the page are read here.
 */
export function htmlToText(html: string, opts: { extraCss?: string[] } = {}): PageText {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<![^>]*>/g, " ");
  const stylesheets = stylesheetLinks(s);
  const styleBlocks: string[] = [];
  for (const m of s.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)) {
    const media = allAttrs(`<style${m[1]}>`).media;
    if (media && /print|speech/i.test(media) && !/screen|all/i.test(media)) continue;
    styleBlocks.push(m[2]);
  }
  const ix = indexRules(parseCss([...styleBlocks, ...(opts.extraCss ?? [])].join("\n")));

  s = s.replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? tidy(titleMatch[1]).replace(/\n/g, " ") : null;
  s = s.replace(/<head\b[\s\S]*?<\/head\s*>/i, " ");

  // Walk tags, tracking each open element, what it inherits and whether it hides its content.
  type Open = { name: string; info: ElementInfo; hidden: string | null; color: string | null; bg: string | null };
  const stack: Open[] = [];
  const hiddenBlocks: string[] = [];
  const hiddenReasons: string[] = [];
  let visible = "";
  let hiddenBuf = "";
  let hiddenWhy = "";
  const inHidden = () => stack.some((e) => e.hidden);
  const emit = (text: string) => {
    if (inHidden()) hiddenBuf += text;
    else visible += text;
  };
  const flushHidden = () => {
    const t = tidy(hiddenBuf).replace(/\n/g, " ");
    if (t) {
      hiddenBlocks.push(t);
      hiddenReasons.push(hiddenWhy);
    }
    hiddenBuf = "";
  };
  const evaluate = (name: string, tag: string): Omit<Open, "name"> => {
    const attrs = allAttrs(tag);
    const info: ElementInfo = { tag: name, id: attrs.id ?? null, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), attrs };
    const path = [...stack.map((e) => e.info), info];
    const decls = computedDecls(candidates(ix, info), path, attrs.style ?? null);
    const parent = stack[stack.length - 1];
    const color = normalizeColor(decls.color) ?? parent?.color ?? null;
    const ownBg = backgroundOf(decls);
    const bg = ownBg && ownBg !== "transparent" ? ownBg : (parent?.bg ?? null);
    let hidden: string | null = "hidden" in attrs ? "hidden attribute" : hidingReason(decls);
    if (!hidden && color && bg && color === bg) hidden = "text coloured like its background";
    return { info, hidden, color, bg };
  };

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let pendingLink: string | null = null;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    emit(s.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const tag = m[0];
    if (!closing) {
      if (VOID.has(name) || tag.endsWith("/>")) {
        const ev = evaluate(name, tag);
        if (!ev.hidden) emit(inlineNote(tag, name));
        continue;
      }
      const wasHidden = inHidden();
      const ev = evaluate(name, tag);
      stack.push({ name, ...ev });
      if (ev.hidden && !wasHidden) {
        hiddenBuf = "";
        hiddenWhy = ev.hidden;
      }
      if (name === "button") emit(" [button: ");
      if (name === "a") {
        const href = attr(tag, "href");
        pendingLink = href && !href.startsWith("#") && !href.toLowerCase().startsWith("javascript:") ? href : null;
        emit(" ");
      }
    } else {
      const idx = stack.map((e) => e.name).lastIndexOf(name);
      if (idx === -1) continue;
      if (name === "button") emit("] ");
      if (name === "a") {
        emit(pendingLink ? ` (${pendingLink}) ` : " ");
        pendingLink = null;
      }
      if (name === "td" || name === "th") emit(" | ");
      if (BLOCK_END.test(name)) emit("\n");
      const wasHidden = inHidden();
      stack.splice(idx);
      if (wasHidden && !inHidden()) flushHidden();
    }
  }
  emit(s.slice(last));
  if (inHidden()) flushHidden();
  return { title, text: tidy(visible), hidden: hiddenBlocks, hiddenReasons, stylesheets };
}

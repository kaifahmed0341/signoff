/**
 * Turn HTML into readable lines the checker can quote, and keep text a
 * visitor cannot see apart from text they can.
 *
 * Removed entirely: scripts, styles, comments, templates, the <head>.
 * Kept apart as hidden: elements with the `hidden` attribute, or an inline
 * style of display:none, visibility:hidden, opacity:0 or font-size:0. Hidden
 * text is never evidence; the checker reports it as a finding instead.
 * Not detected: text hidden by a stylesheet class, off-screen positioning or
 * matching colours. A headless browser would catch those; see the README's
 * known limits. aria-hidden content is visible on screen, so it stays visible.
 * Form controls become short bracketed notes so "has an email signup form"
 * can be checked and quoted.
 */

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

export function isHiddenTag(tag: string): boolean {
  if (hasBooleanAttr(tag, "hidden")) return true;
  const style = (attr(tag, "style") ?? "").toLowerCase().replace(/\s+/g, "");
  return /display:none|visibility:hidden|visibility:collapse|opacity:0(\.0+)?(;|$|!)|font-size:0(px|em|rem)?(;|$|!)/.test(style);
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

export type PageText = { title: string | null; text: string; hidden: string[] };

export function htmlToText(html: string): PageText {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<![^>]*>/g, " ");
  s = s.replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? tidy(titleMatch[1]).replace(/\n/g, " ") : null;
  s = s.replace(/<head\b[\s\S]*?<\/head\s*>/i, " ");

  // Walk tags, tracking which open elements are hidden.
  const stack: { name: string; hidden: boolean }[] = [];
  const hiddenBlocks: string[] = [];
  let visible = "";
  let hiddenBuf = "";
  const inHidden = () => stack.some((e) => e.hidden);
  const emit = (text: string) => {
    if (inHidden()) hiddenBuf += text;
    else visible += text;
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
        if (!isHiddenTag(tag)) emit(inlineNote(tag, name));
        continue;
      }
      const wasHidden = inHidden();
      const hidden = isHiddenTag(tag);
      stack.push({ name, hidden });
      if (hidden && !wasHidden) hiddenBuf = "";
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
      if (wasHidden && !inHidden()) {
        const t = tidy(hiddenBuf).replace(/\n/g, " ");
        if (t) hiddenBlocks.push(t);
        hiddenBuf = "";
      }
    }
  }
  emit(s.slice(last));
  if (inHidden()) {
    const t = tidy(hiddenBuf).replace(/\n/g, " ");
    if (t) hiddenBlocks.push(t);
  }
  return { title, text: tidy(visible), hidden: hiddenBlocks };
}

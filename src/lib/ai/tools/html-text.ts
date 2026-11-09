/**
 * Turn HTML into readable lines the checker can quote. Scripts, styles and
 * comments are removed. Form controls become short bracketed notes so a
 * criterion like "has an email signup form" can be checked and quoted.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", copy: "(c)" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

export function htmlToText(html: string): { title: string | null; text: string } {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : null;
  s = s.replace(/<head\b[\s\S]*?<\/head>/i, " ");
  s = s.replace(/<input\b[^>]*>/gi, (tag) => {
    const type = attr(tag, "type") ?? "text";
    if (type === "hidden") return " ";
    const label = attr(tag, "placeholder") ?? attr(tag, "aria-label") ?? attr(tag, "name") ?? "";
    return ` [${type} field: ${label}] `;
  });
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attr(tag, "alt");
    return alt ? ` [image: ${alt}] ` : " ";
  });
  s = s.replace(/<button\b[^>]*>([\s\S]*?)<\/button>/gi, (_m, inner: string) => ` [button: ${inner.replace(/<[^>]+>/g, " ").trim()}] `);
  s = s.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (m, inner: string) => {
    const href = attr(m, "href");
    const text = inner.replace(/<[^>]+>/g, " ").trim();
    return href && !href.startsWith("#") && !href.startsWith("javascript:") ? ` ${text} (${href}) ` : ` ${text} `;
  });
  s = s.replace(/<\/(p|div|section|article|header|footer|main|nav|li|h[1-6]|tr|form|ul|ol|table|label|dd|dt|blockquote)>/gi, "\n");
  s = s.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

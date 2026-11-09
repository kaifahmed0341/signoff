import { tool } from "ai";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { htmlToText } from "./html-text";
import type { CorpusEntry, SourceKind } from "../evidence";
import { FetchBlockedError, safeFetch, type FetchPolicy } from "./safe-fetch";

/**
 * The checker's tools. All of them only read. None of them can move money,
 * send messages or write anything; the payment rail is not reachable from
 * here. Every call is recorded so its output becomes the evidence corpus.
 */

const MAX_TOOL_TEXT = 15_000;

/**
 * One read. `output` is what the model sees (with headers such as the page
 * title). `quotable` is the visible content only, the only text a quote can be
 * verified against. `hidden` holds page text a visitor cannot see.
 */
export type ToolRecord = {
  tool: string;
  input: Record<string, unknown>;
  source: string;
  output: string;
  ok: boolean;
  quotable?: string;
  hidden?: string[];
  hiddenReasons?: string[];
  kind?: SourceKind;
};

type ReadResult = { output: string; quotable: string; hidden?: string[]; hiddenReasons?: string[]; kind: SourceKind };

const MAX_STYLESHEETS = 5;
const MAX_STYLESHEET_BYTES = 300_000;

/** Fetches the page's same-origin stylesheets, within the fetch policy and the daily cap. Failures are skipped. */
async function fetchStylesheets(ctx: ToolContext, pageUrl: string, hrefs: string[]): Promise<string[]> {
  const origin = new URL(pageUrl).origin;
  const urls = [...new Set(hrefs.map((h) => { try { return new URL(h, pageUrl); } catch { return null; } }).filter((u): u is URL => !!u && u.origin === origin).map((u) => u.toString()))].slice(0, MAX_STYLESHEETS);
  const out: string[] = [];
  for (const u of urls) {
    if (ctx.allowFetch && (await ctx.allowFetch())) break;
    try {
      const doc = await safeFetch(u, { ...policyFor(ctx), maxBytes: MAX_STYLESHEET_BYTES, timeoutMs: 5_000 });
      if (doc.status < 400 && /css|text\/plain|^$/.test(doc.contentType.toLowerCase().split(";")[0])) out.push(doc.body.toString("utf8"));
    } catch {
      /* a stylesheet that cannot be read just is not used */
    }
  }
  return out;
}

export type ToolContext = {
  links: string[];
  files: { name: string; mime: string; text: string; role?: string }[];
  selfOrigin?: string;
  githubToken?: string;
  records: ToolRecord[];
  /** Called before a read starts, for live progress. */
  onRead?: (label: string) => void | Promise<void>;
  /** Called before a network read; returns a reason when the daily cap is used up. */
  allowFetch?: () => Promise<string | null>;
};

export function policyFor(ctx: ToolContext): FetchPolicy {
  const hosts = new Set<string>();
  for (const l of ctx.links) {
    try {
      const u = new URL(l);
      if (u.hostname !== "github.com") hosts.add(u.hostname);
    } catch {
      /* ignore bad links; the URL tool reports them */
    }
  }
  return { allowedHosts: [...hosts], selfOrigin: ctx.selfOrigin };
}

function clip(s: string): string {
  return s.length > MAX_TOOL_TEXT ? `${s.slice(0, MAX_TOOL_TEXT)}\n[... truncated]` : s;
}

const NETWORK_TOOLS = new Set(["read_url", "github_repo", "github_file"]);

async function record(ctx: ToolContext, toolName: string, input: Record<string, unknown>, source: string, run: () => Promise<ReadResult>): Promise<string> {
  // Each source is read once per check; a repeat request gets the first result.
  const seen = ctx.records.find((r) => r.tool === toolName && r.source === source && r.ok);
  if (seen) return seen.output;
  try {
    await ctx.onRead?.(`${toolName} ${source}`);
    if (NETWORK_TOOLS.has(toolName) && ctx.allowFetch) {
      const blocked = await ctx.allowFetch();
      if (blocked) throw new FetchBlockedError(blocked);
    }
    const r = await run();
    const output = clip(r.output);
    ctx.records.push({ tool: toolName, input, source, output, ok: true, quotable: clip(r.quotable), hidden: r.hidden, hiddenReasons: r.hiddenReasons, kind: r.kind });
    return output;
  } catch (err) {
    const msg = err instanceof FetchBlockedError ? `Blocked: ${err.message}` : `Error: ${err instanceof Error ? err.message : String(err)}`;
    ctx.records.push({ tool: toolName, input, source, output: msg, ok: false });
    return msg;
  }
}

export async function readUrl(ctx: ToolContext, url: string): Promise<string> {
  return record(ctx, "read_url", { url }, url, async () => {
    const doc = await safeFetch(url, policyFor(ctx));
    const ct = doc.contentType.toLowerCase();
    const head = `HTTP ${doc.status} from ${doc.url}`;
    if (ct.includes("pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(doc.body));
      const text = (await extractText(pdf, { mergePages: true })).text;
      return { output: `${head}\n${text}`, quotable: text, kind: "page" };
    }
    if (ct.includes("html") || /^\s*</.test(doc.body.subarray(0, 64).toString())) {
      const html = doc.body.toString("utf8");
      const sheets = await fetchStylesheets(ctx, doc.url, htmlToText(html).stylesheets);
      const { title, text, hidden, hiddenReasons } = htmlToText(html, { extraCss: sheets });
      // The model sees the title as context, but only visible body text can be quoted as evidence.
      const note = hidden.length ? `\n[${hidden.length} block(s) of text on this page are hidden from visitors and were left out]` : "";
      return { output: `${head}\n${title ? `Page title (not page content): ${title}\n` : ""}${text}${note}`, quotable: text, hidden, hiddenReasons, kind: "page" };
    }
    const text = doc.body.toString("utf8");
    return { output: `${head}\n${text}`, quotable: text, kind: "page" };
  });
}

export async function readFile(ctx: ToolContext, name: string): Promise<string> {
  return record(ctx, "read_file", { name }, `file:${name}`, async () => {
    const f = ctx.files.find((x) => x.name === name);
    if (!f) throw new Error(`No uploaded file named ${name}. Files: ${ctx.files.map((x) => x.name).join(", ") || "none"}`);
    const isDeliverable = f.role === "deliverable";
    const label = isDeliverable ? "Delivered file" : "Freelancer's notes. A claim about the work, not proof of it";
    return { output: `[${label}: ${name}]\n${f.text}`, quotable: f.text, kind: isDeliverable ? "deliverable_file" : "notes_file" };
  });
}

export function parseRepo(link: string): { owner: string; repo: string } | null {
  const m = link.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function allowedRepo(ctx: ToolContext, repoUrl: string) {
  const r = parseRepo(repoUrl);
  if (!r) throw new FetchBlockedError(`Not a GitHub repository URL: ${repoUrl}`);
  const listed = ctx.links.map(parseRepo).some((x) => x && x.owner.toLowerCase() === r.owner.toLowerCase() && x.repo.toLowerCase() === r.repo.toLowerCase());
  if (!listed) throw new FetchBlockedError(`${r.owner}/${r.repo} is not a repository listed in this delivery`);
  return r;
}

/**
 * GitHub API call. The server's token (if any) is sent only after the
 * repository was confirmed public without it, so a token that can read private
 * repositories is never spent on one a delivery names.
 */
async function gh(ctx: ToolContext & { repoPublic?: Set<string> }, path: string, repoKey?: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (ctx.githubToken && repoKey && ctx.repoPublic?.has(repoKey)) headers.authorization = `Bearer ${ctx.githubToken}`;
  const doc = await safeFetch(`https://api.github.com${path}`, { allowedHosts: ["api.github.com"] }, { headers });
  if (doc.status >= 400) throw new Error(`GitHub returned ${doc.status} for ${path}`);
  return JSON.parse(doc.body.toString("utf8"));
}

export async function githubRepo(ctx: ToolContext, repoUrl: string): Promise<string> {
  return record(ctx, "github_repo", { repoUrl }, repoUrl, async () => {
    const { owner, repo } = allowedRepo(ctx, repoUrl);
    const key = await confirmPublic(ctx, owner, repo);
    const info = (await gh(ctx, `/repos/${owner}/${repo}`, key)) as { default_branch: string; description: string | null; private: boolean; license?: { spdx_id?: string; name?: string } | null };
    const [commit] = (await gh(ctx, `/repos/${owner}/${repo}/commits?per_page=1`, key)) as { sha: string; commit: { message: string; author: { date: string } } }[];
    const tree = (await gh(ctx, `/repos/${owner}/${repo}/git/trees/${commit.sha}?recursive=1`, key)) as { tree: { path: string; type: string }[] };
    let ci = "No CI runs found for the latest commit.";
    try {
      const runs = (await gh(ctx, `/repos/${owner}/${repo}/commits/${commit.sha}/check-runs?per_page=20`, key)) as { check_runs: { name: string; status: string; conclusion: string | null }[] };
      if (runs.check_runs.length) ci = runs.check_runs.map((r) => `CI check "${r.name}": ${r.status}${r.conclusion ? `, ${r.conclusion}` : ""}`).join("\n");
    } catch {
      /* CI status is optional */
    }
    const files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    const text = [
      `Repository ${owner}/${repo} (default branch ${info.default_branch})`,
      `Description: ${info.description ?? "none"}`,
      info.license?.spdx_id ? `License: ${info.license.name ?? info.license.spdx_id} (SPDX id ${info.license.spdx_id})` : "License: no licence file detected",
      `Latest commit ${commit.sha.slice(0, 7)} on ${commit.commit.author.date}: ${commit.commit.message.split("\n")[0]}`,
      ci,
      `Files (${files.length}):`,
      ...files.slice(0, 300),
    ].join("\n");
    return { output: text, quotable: text, kind: "repository" };
  });
}

export async function githubFile(ctx: ToolContext, repoUrl: string, path: string): Promise<string> {
  return record(ctx, "github_file", { repoUrl, path }, `${repoUrl}/blob/HEAD/${path}`, async () => {
    const { owner, repo } = allowedRepo(ctx, repoUrl);
    const key = await confirmPublic(ctx, owner, repo);
    const safePath = path.split("/").filter((p) => p && p !== "..").map(encodeURIComponent).join("/");
    const f = (await gh(ctx, `/repos/${owner}/${repo}/contents/${safePath}`, key)) as { content?: string; encoding?: string; type: string };
    if (f.type !== "file" || !f.content) throw new Error(`${path} is not a file`);
    const text = Buffer.from(f.content, (f.encoding as BufferEncoding) ?? "base64").toString("utf8");
    return { output: `[${path}]\n${text}`, quotable: text, kind: "repository" };
  });
}

/** Checks, without any token, that a repository is public. Private or missing repositories are refused. */
async function confirmPublic(ctx: ToolContext & { repoPublic?: Set<string> }, owner: string, repo: string): Promise<string> {
  const key = `${owner}/${repo}`.toLowerCase();
  ctx.repoPublic ??= new Set();
  if (ctx.repoPublic.has(key)) return key;
  const doc = await safeFetch(`https://api.github.com/repos/${owner}/${repo}`, { allowedHosts: ["api.github.com"] }, { headers: { accept: "application/vnd.github+json" } });
  if (doc.status === 404) throw new FetchBlockedError(`${owner}/${repo} is private or does not exist. Only public repositories can be checked.`);
  if (doc.status >= 400) throw new Error(`GitHub returned ${doc.status} for ${owner}/${repo}`);
  const info = JSON.parse(doc.body.toString("utf8")) as { private?: boolean };
  if (info.private) throw new FetchBlockedError(`${owner}/${repo} is private. Only public repositories can be checked.`);
  ctx.repoPublic.add(key);
  return key;
}

/** The visible, quotable text of every successful read, for evidence checks. */
export function corpusOf(ctx: ToolContext): CorpusEntry[] {
  return ctx.records.filter((r) => r.ok).map((r) => ({ source: r.source, text: r.quotable ?? r.output, kind: r.kind ?? "page", hidden: r.hidden }));
}

/** AI SDK tool definitions bound to one check's context. */
export function checkerTools(ctx: ToolContext) {
  return {
    read_url: tool({
      description: "Read a web page or PDF from the delivery. Only hosts listed in the delivery are reachable. Returns visible text.",
      inputSchema: z.object({ url: z.string().describe("Absolute http(s) URL") }),
      execute: async ({ url }) => readUrl(ctx, url),
    }),
    read_file: tool({
      description: "Read the text of a file the freelancer uploaded with the delivery.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => readFile(ctx, name),
    }),
    github_repo: tool({
      description: "Summarize a public GitHub repository listed in the delivery: latest commit, CI status and file list.",
      inputSchema: z.object({ repoUrl: z.string() }),
      execute: async ({ repoUrl }) => githubRepo(ctx, repoUrl),
    }),
    github_file: tool({
      description: "Read one file from a public GitHub repository listed in the delivery.",
      inputSchema: z.object({ repoUrl: z.string(), path: z.string() }),
      execute: async ({ repoUrl, path }) => githubFile(ctx, repoUrl, path),
    }),
  };
}

/** Read everything the delivery points at, in parallel, before any model call. */
export async function gatherBaseline(ctx: ToolContext) {
  await Promise.all([
    ...ctx.links.map((link) => (parseRepo(link) ? githubRepo(ctx, link) : readUrl(ctx, link))),
    ...ctx.files.map((f) => readFile(ctx, f.name)),
  ]);
}

/**
 * True when the delivery has more the model could usefully read: a repository
 * (files beyond the summary) or pages linking to other pages on a delivery host.
 */
export function needsExploration(ctx: ToolContext): boolean {
  if (ctx.links.some((l) => parseRepo(l))) return true;
  const hosts = new Set(policyFor(ctx).allowedHosts);
  const read = new Set(ctx.records.map((r) => r.source));
  for (const r of ctx.records.filter((x) => x.ok && x.tool === "read_url")) {
    for (const m of r.output.matchAll(/\((https?:\/\/[^\s)]+|\/[^\s)]*|[^\s()]+\.html?(?:[?#][^\s)]*)?)\)/g)) {
      try {
        const u = new URL(m[1], r.source);
        u.hash = "";
        if ((hosts.has(u.hostname) || (ctx.selfOrigin && u.origin === ctx.selfOrigin && u.pathname.startsWith("/samples/"))) && !read.has(u.toString())) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

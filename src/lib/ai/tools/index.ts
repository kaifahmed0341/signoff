import { tool } from "ai";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { htmlToText } from "./html-text";
import { FetchBlockedError, safeFetch, type FetchPolicy } from "./safe-fetch";

/**
 * The checker's tools. All of them only read. None of them can move money,
 * send messages or write anything; the payment rail is not reachable from
 * here. Every call is recorded so its output becomes the evidence corpus.
 */

const MAX_TOOL_TEXT = 15_000;

export type ToolRecord = { tool: string; input: Record<string, unknown>; source: string; output: string; ok: boolean };

export type ToolContext = {
  links: string[];
  files: { name: string; mime: string; text: string }[];
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

async function record(ctx: ToolContext, toolName: string, input: Record<string, unknown>, source: string, run: () => Promise<string>): Promise<string> {
  // Each source is read once per check; a repeat request gets the first result.
  const seen = ctx.records.find((r) => r.tool === toolName && r.source === source && r.ok);
  if (seen) return seen.output;
  try {
    await ctx.onRead?.(`${toolName} ${source}`);
    if (NETWORK_TOOLS.has(toolName) && ctx.allowFetch) {
      const blocked = await ctx.allowFetch();
      if (blocked) throw new FetchBlockedError(blocked);
    }
    const output = clip(await run());
    ctx.records.push({ tool: toolName, input, source, output, ok: true });
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
    let body: string;
    if (ct.includes("pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(doc.body));
      body = (await extractText(pdf, { mergePages: true })).text;
    } else if (ct.includes("html") || /^\s*</.test(doc.body.subarray(0, 64).toString())) {
      const { title, text } = htmlToText(doc.body.toString("utf8"));
      body = `${title ? `Page title: ${title}\n` : ""}${text}`;
    } else {
      body = doc.body.toString("utf8");
    }
    return `HTTP ${doc.status} from ${doc.url}\n${body}`;
  });
}

export async function readFile(ctx: ToolContext, name: string): Promise<string> {
  return record(ctx, "read_file", { name }, `file:${name}`, async () => {
    const f = ctx.files.find((x) => x.name === name);
    if (!f) throw new Error(`No uploaded file named ${name}. Files: ${ctx.files.map((x) => x.name).join(", ") || "none"}`);
    return f.text;
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

async function gh(ctx: ToolContext, path: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (ctx.githubToken) headers.authorization = `Bearer ${ctx.githubToken}`;
  const doc = await safeFetch(`https://api.github.com${path}`, { allowedHosts: ["api.github.com"] }, { headers });
  if (doc.status >= 400) throw new Error(`GitHub returned ${doc.status} for ${path}`);
  return JSON.parse(doc.body.toString("utf8"));
}

export async function githubRepo(ctx: ToolContext, repoUrl: string): Promise<string> {
  return record(ctx, "github_repo", { repoUrl }, repoUrl, async () => {
    const { owner, repo } = allowedRepo(ctx, repoUrl);
    const info = (await gh(ctx, `/repos/${owner}/${repo}`)) as { default_branch: string; description: string | null; private: boolean; license?: { spdx_id?: string } | null };
    const [commit] = (await gh(ctx, `/repos/${owner}/${repo}/commits?per_page=1`)) as { sha: string; commit: { message: string; author: { date: string } } }[];
    const tree = (await gh(ctx, `/repos/${owner}/${repo}/git/trees/${commit.sha}?recursive=1`)) as { tree: { path: string; type: string }[] };
    let ci = "No CI runs found for the latest commit.";
    try {
      const runs = (await gh(ctx, `/repos/${owner}/${repo}/commits/${commit.sha}/check-runs?per_page=20`)) as { check_runs: { name: string; status: string; conclusion: string | null }[] };
      if (runs.check_runs.length) ci = runs.check_runs.map((r) => `CI check "${r.name}": ${r.status}${r.conclusion ? `, ${r.conclusion}` : ""}`).join("\n");
    } catch {
      /* CI status is optional */
    }
    const files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    return [
      `Repository ${owner}/${repo} (default branch ${info.default_branch})`,
      `Description: ${info.description ?? "none"}`,
      `License: ${info.license?.spdx_id ?? "none"}`,
      `Latest commit ${commit.sha.slice(0, 7)} on ${commit.commit.author.date}: ${commit.commit.message.split("\n")[0]}`,
      ci,
      `Files (${files.length}):`,
      ...files.slice(0, 300),
    ].join("\n");
  });
}

export async function githubFile(ctx: ToolContext, repoUrl: string, path: string): Promise<string> {
  return record(ctx, "github_file", { repoUrl, path }, `${repoUrl}/blob/HEAD/${path}`, async () => {
    const { owner, repo } = allowedRepo(ctx, repoUrl);
    const safePath = path.split("/").filter((p) => p && p !== "..").map(encodeURIComponent).join("/");
    const f = (await gh(ctx, `/repos/${owner}/${repo}/contents/${safePath}`)) as { content?: string; encoding?: string; type: string };
    if (f.type !== "file" || !f.content) throw new Error(`${path} is not a file`);
    return Buffer.from(f.content, (f.encoding as BufferEncoding) ?? "base64").toString("utf8");
  });
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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { workspaces } from "@/lib/db/schema";
import type { DB } from "@/lib/db";
import { runCheck } from "@/lib/ai/checker";
import { handleMcp } from "@/lib/mcp/server";
import { FAKE_NONCES, type FakeRail } from "@/lib/payments/fake-rail";
import { createSampleProject, sampleLinks } from "@/lib/sample";
import { createAgentToken, projectForToken, revokeAgentToken } from "@/lib/services/mcp-tokens";
import { fundMilestone, getMilestone, projectMilestones } from "@/lib/services/milestones";
import { OWNER_WORKSPACE_ID as OWNER, pruneDemoWorkspaces, DEMO_RETENTION_MS } from "@/lib/services/workspaces";
import { freshWorld, startStaticServer } from "./helpers";

let server: Server;
let origin: string;
beforeAll(async () => ({ server, origin } = await startStaticServer()));
afterAll(() => server.close());

let db: DB;
let rail: FakeRail;
let demo: { id: string };
beforeEach(async () => {
  ({ db, rail, demo } = await freshWorld({ APP_URL: origin, AI_PROVIDER: "scripted" }));
});

/**
 * The same steps as src/app/api/mcp/route.ts, as a fetch function the SDK
 * client can use. Scheduled work (the checker) is collected so tests can await it.
 */
function mcpFetch(pending: Promise<unknown>[]) {
  return async (_url: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") !== "POST") return new Response(null, { status: 405 });
    const auth = await projectForToken(db, headers.get("authorization"));
    if (!auth) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "unauthorized" } }, { status: 401 });
    const out = await handleMcp({ db, project: auth.project, tokenLabel: auth.token.label, schedule: (w) => void pending.push(w()), runCheck }, JSON.parse(String(init?.body)));
    if (out === null) return new Response(null, { status: 202 });
    return Response.json(out);
  };
}

async function connect(token: string, pending: Promise<unknown>[] = []) {
  const transport = new StreamableHTTPClientTransport(new URL("http://signoff.test/api/mcp"), {
    fetch: mcpFetch(pending) as never,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

const json = (r: unknown) => (r as { structuredContent?: unknown }).structuredContent as Record<string, unknown>;

describe("MCP endpoint for a freelancer's coding agent", () => {
  it("speaks MCP to the official SDK client and offers no payment tools", async () => {
    const p = await createSampleProject(db, OWNER);
    const { token } = await createAgentToken(db, p.id, "Claude Code");
    const client = await connect(token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_milestones", "read_evidence_report", "submit_delivery"]);
    for (const t of tools) expect(`${t.name} ${t.description}`).not.toMatch(/\b(release|capture|void|refund|fund_|pay_|dispute)\w*\(/i);
    await client.close();
  });

  it("lists milestones, submits a delivery, and reads the evidence report", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const { token } = await createAgentToken(db, p.id, "Claude Code");
    const pending: Promise<unknown>[] = [];
    const client = await connect(token, pending);

    const list = json(await client.callTool({ name: "list_milestones", arguments: {} }));
    const ms = list.milestones as { id: string; can_submit: boolean; acceptance_criteria: string[] }[];
    expect(ms).toHaveLength(2);
    expect(ms[0].can_submit).toBe(true);
    expect(ms[1].can_submit).toBe(false);
    expect(ms[0].acceptance_criteria).toHaveLength(4);

    const sub = await client.callTool({ name: "submit_delivery", arguments: { milestone_id: m.id, links: sampleLinks(2), notes: "Done by the agent" } });
    expect(sub.isError).toBeFalsy();
    expect((await getMilestone(db, m.id)).state).toBe("checking");
    await Promise.all(pending);

    const rep = json(await client.callTool({ name: "read_evidence_report", arguments: { milestone_id: m.id } }));
    const check = rep.check as { status: string; criteria: { verdict: string; evidence: unknown[] }[] };
    expect(check.status).toBe("done");
    expect(check.criteria.every((c) => c.verdict === "met" && c.evidence.length > 0)).toBe(true);
    expect((await getMilestone(db, m.id)).state).toBe("in_review");
    await client.close();
  });

  it("refuses a delivery for a milestone the client has not funded, and gives a reason", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    const { token } = await createAgentToken(db, p.id, "agent");
    const client = await connect(token);
    const r = await client.callTool({ name: "submit_delivery", arguments: { milestone_id: m.id, links: sampleLinks(2) } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/once the client has funded it/);
    await client.close();
  });

  it("reaches only the token's own project", async () => {
    const mine = await createSampleProject(db, OWNER);
    const other = await createSampleProject(db, demo.id);
    const [otherM] = await projectMilestones(db, other.id);
    await fundMilestone(db, rail, otherM.id, { nonce: FAKE_NONCES.card });
    const { token } = await createAgentToken(db, mine.id, "agent");
    const client = await connect(token);
    for (const [name, args] of [["read_evidence_report", { milestone_id: otherM.id }], ["submit_delivery", { milestone_id: otherM.id, links: sampleLinks(2) }]] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toMatch(/No milestone with that id in this project/);
    }
    expect((await getMilestone(db, otherM.id)).state).toBe("funded");
    await client.close();
  });

  it("rejects missing, malformed, unknown and revoked tokens, and tokens of pruned workspaces", async () => {
    const p = await createSampleProject(db, demo.id);
    const { token, row } = await createAgentToken(db, p.id, "agent");
    expect(await projectForToken(db, null)).toBeNull();
    expect(await projectForToken(db, `Bearer ${token.slice(0, -2)}xx`)).toBeNull();
    expect(await projectForToken(db, token)).toBeNull(); // no "Bearer"
    expect(await projectForToken(db, `Bearer ${token}`)).not.toBeNull();
    await revokeAgentToken(db, p.id, row.id);
    expect(await projectForToken(db, `Bearer ${token}`)).toBeNull();

    const { token: t2 } = await createAgentToken(db, p.id, "agent 2");
    await db.update(workspaces).set({ lastSeenAt: new Date(0) }).where(eq(workspaces.id, demo.id));
    await pruneDemoWorkspaces(db, Date.now() + DEMO_RETENTION_MS);
    expect(await projectForToken(db, `Bearer ${t2}`)).toBeNull();
  });

  it("the route answers 401 without a valid token and 405 to GET", async () => {
    const { POST, GET } = await import("@/app/api/mcp/route");
    const res = await POST(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    expect((await GET()).status).toBe(405);
  });

  it("handles unknown methods and bad requests as JSON-RPC errors", async () => {
    const p = await createSampleProject(db, OWNER);
    const ctx = { db, project: p, tokenLabel: "t", schedule: () => undefined, runCheck };
    expect(await handleMcp(ctx, { jsonrpc: "2.0", id: 1, method: "resources/list" })).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcp(ctx, { id: 1, method: "tools/list" })).toMatchObject({ error: { code: -32600 } });
    expect(await handleMcp(ctx, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { projects, workspaces } from "@/lib/db/schema";
import { createSampleProject } from "@/lib/sample";
import { getOwnedProject, projectMilestones } from "@/lib/services/milestones";
import { consume } from "@/lib/services/usage";
import { DEMO_RETENTION_MS, createDemoWorkspace, pruneDemoWorkspaces } from "@/lib/services/workspaces";
import { parseSession, sessionValue } from "@/lib/web/auth";
import { loadDashboard } from "@/lib/web/views";
import { GET as health } from "@/app/api/health/route";
import { needsExploration, type ToolContext } from "@/lib/ai/tools";
import { env } from "@/lib/env";
import { freshWorld } from "./helpers";

let db: DB;
let owner: { id: string; kind: string };
let demo: { id: string; kind: string };
beforeEach(async () => {
  ({ db, owner, demo } = await freshWorld({ LIMIT_AI_CHECKS_PER_WORKSPACE: 2, LIMIT_AI_CHECKS_GLOBAL: 3 }));
});

describe("workspaces", () => {
  it("keeps each workspace's projects private", async () => {
    const other = await createDemoWorkspace(db);
    const mine = await createSampleProject(db, demo.id);
    await createSampleProject(db, other.id);
    const dash = await loadDashboard(db, demo.id);
    expect(dash.projects.map((p) => p.id)).toEqual([mine.id]);
    expect(dash.milestones.every((m) => m.projectId === mine.id)).toBe(true);
    await expect(getOwnedProject(db, other.id, mine.id)).rejects.toThrow(/not found/);
  });

  it("prunes demo workspaces unused for 30 days, with their projects, and never the owner", async () => {
    const p = await createSampleProject(db, demo.id);
    await createSampleProject(db, owner.id);
    await db.update(workspaces).set({ lastSeenAt: new Date(0) });
    const removed = await pruneDemoWorkspaces(db, Date.now() + DEMO_RETENTION_MS);
    expect(removed).toBe(1);
    expect(await db.select().from(projects).where(eq(projects.id, p.id))).toHaveLength(0);
    expect(await projectMilestones(db, p.id)).toHaveLength(0);
    expect((await db.select().from(workspaces)).map((w) => w.kind)).toEqual(["owner"]);
  });
});

describe("sessions", () => {
  it("round-trips a signed workspace id and rejects tampering and age", () => {
    const v = sessionValue("ws_abc");
    expect(parseSession(v)).toBe("ws_abc");
    expect(parseSession(v.replace("ws_abc", "ws_xyz"))).toBeNull();
    expect(parseSession("garbage")).toBeNull();
    expect(parseSession(sessionValue("ws_abc", 0))).toBeNull();
  });
});

describe("daily caps", () => {
  it("applies per-workspace caps to demo workspaces and a global cap to all", async () => {
    expect((await consume(db, demo, "ai_check")).ok).toBe(true);
    expect((await consume(db, demo, "ai_check")).ok).toBe(true);
    const third = await consume(db, demo, "ai_check");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toMatch(/demo workspace has used its 2 AI checks/);
    // The refused call did not count globally, so the owner still has one global unit left.
    expect((await consume(db, owner, "ai_check")).ok).toBe(true);
    const g = await consume(db, owner, "ai_check");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toMatch(/daily limit of 3 AI checks for this server/);
  });

  it("starts fresh the next day", async () => {
    await consume(db, demo, "ai_check");
    await consume(db, demo, "ai_check");
    expect((await consume(db, demo, "ai_check")).ok).toBe(false);
    expect((await consume(db, demo, "ai_check", Date.now() + 86_400_000)).ok).toBe(true);
  });
});

describe("health", () => {
  it("reports the rail, the AI provider and the database without secrets", async () => {
    const res = await health();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rail).toBe("fake");
    expect(body.database.reachable).toBe(true);
    const text = JSON.stringify(body);
    const e = env();
    for (const secret of [e.SESSION_SECRET, e.OPERATOR_PASSCODE]) expect(text).not.toContain(secret);
  });
});

describe("exploration decision", () => {
  const base = (records: ToolContext["records"], links = ["https://site.example/"]): ToolContext => ({ links, files: [], records });
  it("explores repositories and pages that link to other delivery pages", () => {
    expect(needsExploration(base([], ["https://github.com/a/b"]))).toBe(true);
    expect(needsExploration(base([{ tool: "read_url", input: {}, source: "https://site.example/", output: "Prices (/prices)", ok: true }]))).toBe(true);
  });
  it("skips exploration for a self-contained page or off-delivery links", () => {
    expect(needsExploration(base([{ tool: "read_url", input: {}, source: "https://site.example/", output: "Hello\nOther (https://elsewhere.example/x)", ok: true }]))).toBe(false);
  });
});

describe("judging-period limits", () => {
  it("one office address can start 25 workspaces and run 120 AI checks a day by default", async () => {
    const { limits } = await import("@/lib/services/usage");
    const { setEnvForTests } = await import("@/lib/env");
    setEnvForTests({}); // the defaults, as on the host
    expect(env().LIMIT_WORKSPACES_PER_ADDRESS).toBeGreaterThanOrEqual(25);
    expect(limits("ai_check").perAddress).toBeGreaterThanOrEqual(120);
    expect(limits("ai_check").global).toBe(400);
  });

  it("says when a cap resets, in plain words", async () => {
    const { resetPhrase } = await import("@/lib/services/usage");
    const t = Date.UTC(2026, 11, 3, 19, 0, 0);
    expect(resetPhrase(t)).toBe("the limit resets at 00:00 UTC, in 5 hours");
    expect(resetPhrase(Date.UTC(2026, 11, 3, 23, 45, 0))).toBe("the limit resets at 00:00 UTC, in 15 minutes");
    const ws = await createDemoWorkspace(db, Date.now(), "addr");
    for (let i = 0; i < 15; i++) await consume(db, ws, "ai_check");
    const r = await consume(db, ws, "ai_check");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/resets at 00:00 UTC, in \d+ (hours?|minutes?)/);
  });
});

describe("safety model", () => {
  it("no file under src/lib/ai imports the payment rail or a payment SDK", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    await walk("src/lib/ai");
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(await readFile(f, "utf8"), f).not.toMatch(/from\s+["'](?:[./]+|@\/lib\/)payments|from\s+["']braintree/);
  });
});

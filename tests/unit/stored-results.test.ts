/** Stored live results stand in for the bundled sample deliveries only, and only when the live model is out of quota. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { checks, verdicts } from "@/lib/db/schema";
import { runCheck } from "@/lib/ai/checker";
import { setModelForTests, setOverloadRetryForTests } from "@/lib/ai/model";
import { finalizePlan, scriptedPlan } from "@/lib/ai/planner";
import { STORED_SAMPLE_RESULTS, isQuotaError, storedResultFor } from "@/lib/ai/stored-results";
import { FAKE_NONCES, type FakeRail } from "@/lib/payments/fake-rail";
import { SAMPLE_SCOPE, createSampleProject, sampleLinks, type SampleVersion } from "@/lib/sample";
import { submitDelivery } from "@/lib/services/deliveries";
import { OWNER_WORKSPACE_ID as OWNER } from "@/lib/services/workspaces";
import { createProject, fundMilestone, latestCheck, projectMilestones, sendProject } from "@/lib/services/milestones";
import type { DB } from "@/lib/db";
import { freshWorld, startStaticServer } from "./helpers";

let server: Server;
let origin: string;
beforeAll(async () => ({ server, origin } = await startStaticServer()));
afterAll(() => server.close());

let db: DB;
let rail: FakeRail;
beforeEach(async () => {
  ({ db, rail } = await freshWorld({ APP_URL: origin, AI_PROVIDER: "scripted" }));
});

const failingWith = (message: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error(message);
    },
  });

async function funded(sample: boolean) {
  const p = sample
    ? await createSampleProject(db, OWNER)
    : await (async () => {
        const own = await createProject(db, { workspaceId: OWNER, name: "My own site", clientName: "My client", scope: SAMPLE_SCOPE, currency: "USD", milestones: finalizePlan(scriptedPlan(SAMPLE_SCOPE), SAMPLE_SCOPE, "scripted").milestones });
        await sendProject(db, own.id);
        return own;
      })();
  const [m] = await projectMilestones(db, p.id);
  await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
  return m;
}

async function check(sample: boolean, version: SampleVersion, error: string, files: { name: string; mime: string; text: string }[] = []) {
  const m = await funded(sample);
  const d = await submitDelivery(db, m.id, { links: sampleLinks(version), notes: "", files });
  setModelForTests({ label: "google/gemini-3.5-flash-lite", model: failingWith(error) });
  await runCheck(db, m.id, d);
  const c = (await latestCheck(db, m.id))!;
  const [row] = await db.select().from(checks).where(eq(checks.id, c.id));
  const vs = await db.select().from(verdicts).where(eq(verdicts.checkId, c.id));
  return { row, vs };
}

describe("stored sample results", () => {
  it("are recorded from the live model for all three sample deliveries", () => {
    expect(STORED_SAMPLE_RESULTS.map((s) => s.path).sort()).toEqual(["sample-v1", "sample-v1-cheat", "sample-v2"]);
    for (const s of STORED_SAMPLE_RESULTS) expect(s.model).not.toBe("scripted");
  });

  it("stand in for the sample's v2 when the model is out of quota, labelled with the date, quotes re-verified", async () => {
    const { row, vs } = await check(true, 2, "429 Resource has been exhausted (e.g. check quota).");
    expect(row.model).toMatch(/stored result of \d+ \w+ 2026/);
    expect(row.fallbackReason).toMatch(/out of quota.*stored result/);
    expect(row.summary).toMatch(/4 of 4 criteria met/);
    expect(vs.every((v) => v.verdict === "met" && v.evidence.length > 0)).toBe(true);
  });

  it("keep the tampering findings on the cheat, which are read from the page each time", async () => {
    const { row, vs } = await check(true, "cheat", "Quota exceeded for metric generate_content_free_tier_requests");
    expect(row.model).toMatch(/stored result/);
    expect(row.findings!.some((f) => f.kind === "injected_instruction")).toBe(true);
    expect(vs.filter((v) => v.verdict === "not_met")).toHaveLength(2);
  });

  it("F1: Gemini's 503 high demand counts as out of quota, after one short retry", async () => {
    const overload = Object.assign(new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."), { statusCode: 503 });
    expect(isQuotaError(overload)).toBe(true);
    setOverloadRetryForTests(0);
    let calls = 0;
    const m = await funded(true);
    const d = await submitDelivery(db, m.id, { links: sampleLinks("cheat"), notes: "", files: [] });
    setModelForTests({
      label: "google/gemini-3.5-flash-lite",
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          throw overload;
        },
      }),
    });
    await runCheck(db, m.id, d);
    const c = (await latestCheck(db, m.id))!;
    const [row] = await db.select().from(checks).where(eq(checks.id, c.id));
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(row.model).toMatch(/stored result/);
    expect(row.fallbackReason).toMatch(/overloaded right now/);
  });

  it("never stand in for a user's own project, even with the same links and criteria", async () => {
    const { row } = await check(false, 2, "429 Too Many Requests");
    expect(row.model).toBe("scripted");
  });

  it("never stand in when the failure is not about quota, or when files are attached", async () => {
    expect((await check(true, 2, "Invalid JSON in response")).row.model).toBe("scripted");
    expect((await check(true, 2, "429 Too Many Requests", [{ name: "extra.txt", mime: "text/plain", text: "more" }])).row.model).toBe("scripted");
  });

  it("match only the exact sample link and the sample's own criteria", () => {
    const base = { isSample: true, fileCount: 0, appOrigin: origin, why: "Out of quota" };
    const crit = STORED_SAMPLE_RESULTS.find((s) => s.path === "sample-v2")!.results.map((r) => r.criterion);
    expect(storedResultFor({ ...base, links: [`${origin}/samples/sample-v2/index.html`], criteria: crit })).not.toBeNull();
    expect(storedResultFor({ ...base, links: [`${origin}/samples/sample-v2/index.html?x=1`], criteria: crit })).toBeNull();
    expect(storedResultFor({ ...base, links: [`${origin}/samples/sample-v2/index.html`], criteria: [...crit.slice(0, 3), "Something else."] })).toBeNull();
    expect(isQuotaError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isQuotaError(new Error("Invalid JSON in response"))).toBe(false);
  });
});

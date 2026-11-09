import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { verdicts } from "@/lib/db/schema";
import { planFromScope } from "@/lib/ai/planner";
import { runCheck } from "@/lib/ai/checker";
import { resolveModel } from "@/lib/ai/model";
import { createSampleProject, sampleLinks, SAMPLE_SCOPE } from "@/lib/sample";
import { submitDelivery } from "@/lib/services/deliveries";
import { fundMilestone, latestCheck, projectMilestones } from "@/lib/services/milestones";
import { FAKE_NONCES } from "@/lib/payments/fake-rail";
import { OWNER_WORKSPACE_ID as OWNER } from "@/lib/services/workspaces";
import { freshWorld, startStaticServer } from "./helpers";

/**
 * Runs the real model. Opt in with LIVE_AI=1 and a key in the environment:
 *   LIVE_AI=1 pnpm vitest run tests/unit/live-ai.test.ts
 */
const run = process.env.LIVE_AI === "1";

describe.runIf(run)("live model", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => ({ server, origin } = await startStaticServer()));
  afterAll(() => server.close());

  it("plans the sample scope with verified quotes", async () => {
    await freshWorld({ APP_URL: origin, GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
    expect(resolveModel().model).not.toBeNull();
    const plan = await planFromScope(SAMPLE_SCOPE);
    console.log(resolveModel().label, JSON.stringify(plan, null, 2));
    expect(plan.milestones.length).toBeGreaterThanOrEqual(2);
    expect(plan.milestones[0].amountCents).toBe(45000);
  }, 120_000);

  it("checks v1 and v2 of the sample deliverable", async () => {
    const { db, rail } = await freshWorld({ APP_URL: origin, GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    for (const v of [1, 2] as const) {
      const d = await submitDelivery(db, m.id, { links: sampleLinks(v), notes: "", files: [] });
      await runCheck(db, m.id, d);
      const c = await latestCheck(db, m.id);
      const vs = await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id));
      console.log(`v${v}`, c!.status, c!.error, c!.summary, JSON.stringify(vs.map((x) => [x.verdict, x.reasoning, x.evidence, x.note]), null, 1));
      expect(c!.status).toBe("done");
      if (v === 1) {
        expect(vs.some((x) => x.verdict !== "met")).toBe(true);
        const { requestChanges } = await import("@/lib/services/milestones");
        await requestChanges(db, m.id, "Fix the Saturday time and address");
      } else {
        expect(vs.filter((x) => x.verdict === "met").length).toBeGreaterThanOrEqual(3);
      }
    }
  }, 240_000);
});

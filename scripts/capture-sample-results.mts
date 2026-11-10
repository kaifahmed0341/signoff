/**
 * Records the live model's result on each bundled sample delivery, for the
 * checker to replay when the model is out of quota (src/lib/ai/stored-results.ts).
 *
 *   set -a; . ./.env.local; set +a
 *   pnpm tsx scripts/capture-sample-results.mts
 *
 * Three model calls. Refuses to write anything if a check did not come from
 * the live model.
 */
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { checks, verdicts } from "../src/lib/db/schema";
import { runCheck } from "../src/lib/ai/checker";
import { FAKE_NONCES } from "../src/lib/payments/fake-rail";
import { createSampleProject, sampleLinks, type SampleVersion } from "../src/lib/sample";
import { submitDelivery } from "../src/lib/services/deliveries";
import { fundMilestone, latestCheck, milestoneCriteria, projectMilestones } from "../src/lib/services/milestones";
import type { StoredSampleResult } from "../src/lib/ai/stored-results";
import { freshWorld, startStaticServer } from "../tests/unit/helpers";

const { server, origin } = await startStaticServer();
const world = await freshWorld({ APP_URL: origin, GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY, GOOGLE_MODEL: process.env.GOOGLE_MODEL || undefined, AI_PROVIDER: "auto" });
const out: StoredSampleResult[] = [];
for (const version of [1, "cheat", 2] as SampleVersion[]) {
  const p = await createSampleProject(world.db, world.owner.id);
  const [m] = await projectMilestones(world.db, p.id);
  await fundMilestone(world.db, world.rail, m.id, { nonce: FAKE_NONCES.card });
  const links = sampleLinks(version);
  const d = await submitDelivery(world.db, m.id, { links, notes: "", files: [] });
  await runCheck(world.db, m.id, d);
  const c = (await latestCheck(world.db, m.id))!;
  const [row] = await world.db.select().from(checks).where(eq(checks.id, c.id));
  if (row.status !== "done" || row.fallbackReason || row.model === "scripted") throw new Error(`v${version}: not a live result (${row.model}, ${row.fallbackReason ?? row.error})`);
  const vs = await world.db.select().from(verdicts).where(eq(verdicts.checkId, c.id));
  const crit = await milestoneCriteria(world.db, m.id);
  out.push({
    version: String(version),
    path: new URL(links[0]).pathname.split("/")[2],
    model: row.model,
    date: new Date().toISOString().slice(0, 10),
    results: crit.map((cr) => {
      const v = vs.find((x) => x.criterionId === cr.id)!;
      return { criterion: cr.text, verdict: v.verdict as StoredSampleResult["results"][number]["verdict"], reasoning: v.reasoning, evidence: v.evidence.map((e) => e.quote) };
    }),
  });
  console.log(`v${version}: ${row.model}: ${out.at(-1)!.results.map((r) => r.verdict).join(", ")}`);
  await new Promise((r) => setTimeout(r, 6000));
}
writeFileSync("src/lib/ai/stored-sample-results.json", `${JSON.stringify(out, null, 2)}\n`);
console.log("Wrote src/lib/ai/stored-sample-results.json");
server.close();
process.exit(0);

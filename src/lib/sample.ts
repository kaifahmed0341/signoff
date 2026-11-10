import type { DB } from "./db";
import { finalizePlan, scriptedPlan } from "./ai/planner";
import { env } from "./env";
import { createProject, sendProject } from "./services/milestones";

/** A fictional bakery and the fictional two-person agency building its site. The sample deliverables live in public/samples/. */
export const SAMPLE_SCOPE = `Quarrymoor Bakehouse: new website

Quarrymoor is a small bakery that runs weekend baking classes. We have hired Tidewell Studio, a two-person web agency, to build the site. We want a one-page site that tells people when classes run and lets them join the waitlist, followed by a page with class prices. Total budget $1,050.

Milestone 1: Landing page ($450, due in 5 days)
The landing page introduces the bakery and its weekly classes.
- The page headline is Quarrymoor Bakehouse.
- The page lists the Saturday sourdough class with its start time of 10:00.
- The page shows the bakery address: 14 Mill Lane, Portland.
- Visitors can join the waitlist through an email signup form.

Milestone 2: Class prices page ($600, due in 12 days)
A second page with prices for every class.
- The prices page lists the sourdough course price of $240.
- The prices page lists the pastry course price of $180.
- The prices page links back to the landing page.
`;

export type SampleVersion = 1 | 2 | "cheat";

/** v1 misses two criteria; "cheat" is v1 plus hidden text, a pasted requirement and an injected instruction; v2 passes. */
export function sampleLinks(version: SampleVersion): string[] {
  const path = version === "cheat" ? "sample-v1-cheat" : `sample-v${version}`;
  return [`${new URL(env().APP_URL).origin}/samples/${path}/index.html`];
}

export async function createSampleProject(db: DB, workspaceId: string) {
  const planned = finalizePlan(scriptedPlan(SAMPLE_SCOPE), SAMPLE_SCOPE, "scripted");
  const project = await createProject(db, {
    workspaceId,
    name: "Quarrymoor Bakehouse website",
    clientName: "Quarrymoor Bakehouse",
    clientEmail: null,
    scope: SAMPLE_SCOPE,
    currency: env().CURRENCY,
    isSample: true,
    milestones: planned.milestones,
  });
  await sendProject(db, project.id);
  return project;
}

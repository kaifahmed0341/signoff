import type { DB } from "./db";
import { finalizePlan, scriptedPlan } from "./ai/planner";
import { env } from "./env";
import { createProject, sendProject } from "./services/milestones";

/** A fictional studio. The two sample deliverables live in public/samples/. */
export const SAMPLE_SCOPE = `Larkspur Pottery Studio: new website

Larkspur is a small pottery studio. We want a one-page site that tells people when classes run and lets them join the waitlist, followed by a page with class prices. Total budget $1,050.

Milestone 1: Landing page ($450, due in 5 days)
The landing page introduces the studio and its weekly classes.
- The page headline names the studio: Larkspur Pottery Studio.
- The page lists the Saturday wheel-throwing class with its start time of 10:00.
- The page shows the studio address: 14 Kiln Lane, Portland.
- Visitors can join the waitlist through an email signup form.

Milestone 2: Class prices page ($600, due in 12 days)
A second page with prices for every class.
- The prices page lists the wheel-throwing course price of $240.
- The prices page lists the hand-building course price of $180.
- The prices page links back to the landing page.
`;

export function sampleLinks(version: 1 | 2): string[] {
  return [`${new URL(env().APP_URL).origin}/samples/larkspur-v${version}/index.html`];
}

export async function createSampleProject(db: DB) {
  const planned = finalizePlan(scriptedPlan(SAMPLE_SCOPE), SAMPLE_SCOPE, "scripted");
  const project = await createProject(db, {
    name: "Larkspur Pottery Studio website",
    clientName: "Larkspur Pottery Studio",
    clientEmail: null,
    scope: SAMPLE_SCOPE,
    currency: env().CURRENCY,
    isSample: true,
    milestones: planned.milestones,
  });
  await sendProject(db, project.id);
  return project;
}

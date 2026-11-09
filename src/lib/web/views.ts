import { asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { checks, criteria, deliveries, deliveryFiles, disputes, milestones, projects, toolCalls, verdicts } from "../db/schema";
import { timeline } from "../services/audit";
import { getProject, projectMilestones } from "../services/milestones";

export type ProjectView = Awaited<ReturnType<typeof loadProjectView>>;
export type MilestoneView = ProjectView["milestones"][number];

export async function loadProjectView(db: DB, projectId: string) {
  const project = await getProject(db, projectId);
  const ms = await projectMilestones(db, projectId);
  const ids = ms.map((m) => m.id);
  const crit = ids.length ? await db.select().from(criteria).where(inArray(criteria.milestoneId, ids)).orderBy(asc(criteria.position)) : [];
  const dels = ids.length ? await db.select().from(deliveries).where(inArray(deliveries.milestoneId, ids)).orderBy(desc(deliveries.version)) : [];
  const chks = ids.length ? await db.select().from(checks).where(inArray(checks.milestoneId, ids)).orderBy(desc(checks.startedAt)) : [];
  const disp = ids.length ? await db.select().from(disputes).where(inArray(disputes.milestoneId, ids)).orderBy(desc(disputes.createdAt)) : [];
  const latestChecks = ids.map((id) => chks.find((c) => c.milestoneId === id)).filter((c) => c !== undefined);
  const cids = latestChecks.map((c) => c.id);
  const vds = cids.length ? await db.select().from(verdicts).where(inArray(verdicts.checkId, cids)) : [];
  const tcs = cids.length ? await db.select().from(toolCalls).where(inArray(toolCalls.checkId, cids)).orderBy(asc(toolCalls.position)) : [];
  const dids = dels.map((d) => d.id);
  const files = dids.length ? await db.select({ id: deliveryFiles.id, deliveryId: deliveryFiles.deliveryId, name: deliveryFiles.name, mime: deliveryFiles.mime }).from(deliveryFiles).where(inArray(deliveryFiles.deliveryId, dids)) : [];
  const events = await timeline(db, projectId);

  return {
    project,
    events,
    milestones: ms.map((m) => {
      const check = chks.find((c) => c.milestoneId === m.id) ?? null;
      const delivery = dels.find((d) => d.milestoneId === m.id) ?? null;
      return {
        ...m,
        criteria: crit.filter((c) => c.milestoneId === m.id),
        delivery,
        deliveryCount: dels.filter((d) => d.milestoneId === m.id).length,
        files: delivery ? files.filter((f) => f.deliveryId === delivery.id) : [],
        check,
        verdicts: check ? vds.filter((v) => v.checkId === check.id) : [],
        toolCalls: check ? tcs.filter((t) => t.checkId === check.id) : [],
        disputes: disp.filter((d) => d.milestoneId === m.id),
      };
    }),
  };
}

export async function loadDashboard(db: DB) {
  const ps = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const ms = await db.select().from(milestones);
  const disp = await db.select().from(disputes);
  return { projects: ps, milestones: ms, disputes: disp };
}

export async function milestoneProject(db: DB, milestoneId: string) {
  const [m] = await db.select({ projectId: milestones.projectId }).from(milestones).where(eq(milestones.id, milestoneId));
  return m?.projectId ?? null;
}

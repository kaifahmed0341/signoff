import { and, eq, lt, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { fakeTransactions, fakeDisputes, usageCounters, workspaces, type Workspace } from "../db/schema";
import { newId } from "./ids";

export const OWNER_WORKSPACE_ID = "ws_owner";
export const DEMO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export async function getWorkspace(db: DB, id: string): Promise<Workspace | null> {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return w ?? null;
}

export async function ensureOwnerWorkspace(db: DB): Promise<Workspace> {
  const w = await getWorkspace(db, OWNER_WORKSPACE_ID);
  if (w) return w;
  await db.insert(workspaces).values({ id: OWNER_WORKSPACE_ID, kind: "owner", createdAt: new Date(), lastSeenAt: new Date() }).onConflictDoNothing();
  return (await getWorkspace(db, OWNER_WORKSPACE_ID))!;
}

export async function createDemoWorkspace(db: DB, now = Date.now()): Promise<Workspace> {
  await pruneDemoWorkspaces(db, now);
  const id = newId("ws");
  await db.insert(workspaces).values({ id, kind: "demo", createdAt: new Date(now), lastSeenAt: new Date(now) });
  return (await getWorkspace(db, id))!;
}

/** Marks a workspace as in use, at most once an hour so page loads stay cheap. */
export async function touchWorkspace(db: DB, w: Workspace, now = Date.now()) {
  if (now - w.lastSeenAt.getTime() < TOUCH_EVERY_MS) return;
  await db.update(workspaces).set({ lastSeenAt: new Date(now) }).where(eq(workspaces.id, w.id));
}

/**
 * Deletes demo workspaces not used for 30 days. Projects, milestones,
 * deliveries, checks and disputes go with them through foreign key cascades.
 * Old usage counters and test-rail rows are cleared at the same time.
 */
export async function pruneDemoWorkspaces(db: DB, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - DEMO_RETENTION_MS);
  const stale = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.kind, "demo"), lt(workspaces.lastSeenAt, cutoff)));
  if (stale.length) await db.delete(workspaces).where(inArray(workspaces.id, stale.map((s) => s.id)));
  const dayCutoff = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db.delete(usageCounters).where(lt(usageCounters.day, dayCutoff));
  const oldTxns = await db.select({ id: fakeTransactions.id }).from(fakeTransactions).where(lt(fakeTransactions.createdAt, now - DEMO_RETENTION_MS - 7 * 86400000));
  if (oldTxns.length) {
    const ids = oldTxns.map((t) => t.id);
    await db.delete(fakeDisputes).where(inArray(fakeDisputes.transactionId, ids));
    await db.delete(fakeTransactions).where(inArray(fakeTransactions.id, ids));
  }
  return stale.length;
}

import { asc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { auditEvents } from "../db/schema";
import { newId } from "./ids";

export type Actor = "operator" | "client" | "checker" | "braintree" | "system";

export async function audit(
  db: DB,
  e: { projectId: string; milestoneId?: string | null; actor: Actor; type: string; message: string; data?: Record<string, unknown> },
) {
  await db.insert(auditEvents).values({
    id: newId("ev"),
    projectId: e.projectId,
    milestoneId: e.milestoneId ?? null,
    actor: e.actor,
    type: e.type,
    message: e.message,
    data: e.data ?? null,
    createdAt: new Date(),
  });
}

export async function timeline(db: DB, projectId: string) {
  return db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId)).orderBy(asc(auditEvents.createdAt));
}

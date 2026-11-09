import { sql } from "drizzle-orm";
import type { DB } from "../db";
import { usageCounters } from "../db/schema";
import { env } from "../env";

export type UsageKind = "ai_check" | "ai_plan" | "fetch";

export function limits(kind: UsageKind): { perWorkspace: number; global: number } {
  const e = env();
  switch (kind) {
    case "ai_check":
      return { perWorkspace: e.LIMIT_AI_CHECKS_PER_WORKSPACE, global: e.LIMIT_AI_CHECKS_GLOBAL };
    case "ai_plan":
      return { perWorkspace: e.LIMIT_AI_PLANS_PER_WORKSPACE, global: e.LIMIT_AI_PLANS_GLOBAL };
    case "fetch":
      return { perWorkspace: e.LIMIT_FETCHES_PER_WORKSPACE, global: e.LIMIT_FETCHES_GLOBAL };
  }
}

export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function bump(db: DB, key: string, day: string, by: number): Promise<number> {
  const rows = await db
    .insert(usageCounters)
    .values({ key, day, count: by })
    .onConflictDoUpdate({ target: usageCounters.key, set: { count: sql`${usageCounters.count} + ${by}` } })
    .returning({ count: usageCounters.count });
  return rows[0].count;
}

export type Consumed = { ok: true } | { ok: false; reason: string };

/**
 * Counts one unit of usage against today's caps. The per-workspace cap applies
 * to demo workspaces; the global cap applies to everything. Over the cap,
 * nothing is spent and the caller falls back or refuses with the reason.
 */
export async function consume(db: DB, workspace: { id: string; kind: string }, kind: UsageKind, now = Date.now()): Promise<Consumed> {
  const day = today(now);
  const { perWorkspace, global } = limits(kind);
  const label = kind === "fetch" ? "page reads" : kind === "ai_plan" ? "AI drafts" : "AI checks";
  const g = await bump(db, `global|${kind}|${day}`, day, 1);
  if (g > global) {
    await bump(db, `global|${kind}|${day}`, day, -1);
    return { ok: false, reason: `The daily limit of ${global} ${label} for this server is used up` };
  }
  if (workspace.kind === "demo") {
    const w = await bump(db, `${workspace.id}|${kind}|${day}`, day, 1);
    if (w > perWorkspace) {
      await bump(db, `${workspace.id}|${kind}|${day}`, day, -1);
      await bump(db, `global|${kind}|${day}`, day, -1);
      return { ok: false, reason: `This demo workspace has used its ${perWorkspace} ${label} for today` };
    }
  }
  return { ok: true };
}

export const LOGIN_FAILURES_PER_DAY = 20;

/** Failed passcode attempts from one address today. Above the limit, sign-in is refused until tomorrow. */
export async function loginFailures(db: DB, ip: string, now = Date.now()): Promise<number> {
  const day = today(now);
  const [row] = await db.select().from(usageCounters).where(sql`${usageCounters.key} = ${`login|${ip}|${day}`}`);
  return row?.count ?? 0;
}

export async function noteLoginFailure(db: DB, ip: string, now = Date.now()): Promise<number> {
  const day = today(now);
  return bump(db, `login|${ip}|${day}`, day, 1);
}

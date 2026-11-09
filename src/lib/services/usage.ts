import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { usageCounters } from "../db/schema";
import { env } from "../env";

export type UsageKind = "ai_check" | "ai_plan" | "ai_note" | "fetch";

export function limits(kind: UsageKind): { perWorkspace: number; perAddress: number; global: number } {
  const e = env();
  switch (kind) {
    case "ai_check":
      return { perWorkspace: e.LIMIT_AI_CHECKS_PER_WORKSPACE, perAddress: e.LIMIT_AI_CHECKS_PER_ADDRESS, global: e.LIMIT_AI_CHECKS_GLOBAL };
    case "ai_plan":
      return { perWorkspace: e.LIMIT_AI_PLANS_PER_WORKSPACE, perAddress: e.LIMIT_AI_PLANS_PER_WORKSPACE * 3, global: e.LIMIT_AI_PLANS_GLOBAL };
    case "ai_note":
      return { perWorkspace: e.LIMIT_AI_NOTES_PER_WORKSPACE, perAddress: e.LIMIT_AI_NOTES_PER_WORKSPACE * 3, global: e.LIMIT_AI_NOTES_GLOBAL };
    case "fetch":
      return { perWorkspace: e.LIMIT_FETCHES_PER_WORKSPACE, perAddress: e.LIMIT_FETCHES_PER_WORKSPACE * 3, global: e.LIMIT_FETCHES_GLOBAL };
  }
}

/** Share of the daily AI check budget kept for workspaces that have not used any yet today. */
export const FIRST_VISIT_RESERVE = 0.2;

const LABEL: Record<UsageKind, string> = { fetch: "page reads", ai_plan: "AI drafts", ai_note: "AI change notes", ai_check: "AI checks" };

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

async function read(db: DB, key: string): Promise<number> {
  const [row] = await db.select().from(usageCounters).where(eq(usageCounters.key, key));
  return row?.count ?? 0;
}

export type Consumed = { ok: true } | { ok: false; reason: string };

/**
 * Counts one unit of usage against today's caps, in this order:
 * - per demo workspace;
 * - per address: demo workspaces created from the same address share one budget,
 *   so clearing cookies to get a fresh workspace does not get fresh caps;
 * - for AI checks, the last fifth of the server's daily budget is kept for
 *   workspaces that have not had an AI check today, so a first-time visitor is
 *   the last to lose the live model;
 * - the server's global cap.
 * Over a cap nothing is spent, and the caller falls back or refuses with the reason.
 */
export async function consume(db: DB, workspace: { id: string; kind: string; ipHash?: string | null }, kind: UsageKind, now = Date.now()): Promise<Consumed> {
  const day = today(now);
  const { perWorkspace, perAddress, global } = limits(kind);
  const label = LABEL[kind];
  const demo = workspace.kind === "demo";
  const keys = { ws: `${workspace.id}|${kind}|${day}`, ip: workspace.ipHash ? `ip:${workspace.ipHash}|${kind}|${day}` : null, global: `global|${kind}|${day}` };

  if (demo) {
    const used = await read(db, keys.ws);
    if (used >= perWorkspace) return { ok: false, reason: `This demo workspace has used its ${perWorkspace} ${label} for today` };
    if (keys.ip && (await read(db, keys.ip)) >= perAddress) return { ok: false, reason: `Demo workspaces from this network have used their ${perAddress} ${label} for today` };
    if (kind === "ai_check" && used > 0 && (await read(db, keys.global)) >= Math.floor(global * (1 - FIRST_VISIT_RESERVE))) {
      return { ok: false, reason: "Most of today's shared AI budget is used, and what is left is kept for first-time visitors" };
    }
  }
  const g = await bump(db, keys.global, day, 1);
  if (g > global) {
    await bump(db, keys.global, day, -1);
    return { ok: false, reason: `The daily limit of ${global} ${label} for this server is used up` };
  }
  if (demo) {
    await bump(db, keys.ws, day, 1);
    if (keys.ip) await bump(db, keys.ip, day, 1);
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

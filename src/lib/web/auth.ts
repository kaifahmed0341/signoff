import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "../db";
import type { Workspace } from "../db/schema";
import { env } from "../env";
import { sign, verifySignature } from "../services/ids";
import { getWorkspace, touchWorkspace } from "../services/workspaces";

/**
 * The operator session is a signed cookie naming a workspace. Self-hosted
 * installs sign in with a passcode to the one owner workspace. The public demo
 * gives each visitor a private demo workspace with one click.
 */
const COOKIE = "signoff_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

export function passcodeMatches(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(env().OPERATOR_PASSCODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** In demo mode the passcode only works if it was changed from the public default. */
export function passcodeLoginEnabled(): boolean {
  const e = env();
  return !e.DEMO_MODE || e.OPERATOR_PASSCODE !== "signoff-demo";
}

export function sessionValue(workspaceId: string, issued = Date.now()): string {
  const body = `${workspaceId}.${issued}`;
  return `${body}.${sign("operator-session", body)}`;
}

export function parseSession(raw: string | undefined, now = Date.now()): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [workspaceId, issued, sig] = parts;
  if (!verifySignature("operator-session", `${workspaceId}.${issued}`, sig)) return null;
  if (now - Number(issued) > MAX_AGE_S * 1000) return null;
  return workspaceId;
}

export async function startSession(workspaceId: string) {
  (await cookies()).set(COOKIE, sessionValue(workspaceId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentWorkspace(): Promise<Workspace | null> {
  const id = parseSession((await cookies()).get(COOKIE)?.value);
  if (!id) return null;
  const db = await getDb();
  const w = await getWorkspace(db, id);
  if (w) await touchWorkspace(db, w);
  return w;
}

export async function requireWorkspace(): Promise<Workspace> {
  const w = await currentWorkspace();
  if (!w) redirect(env().DEMO_MODE ? "/" : "/login");
  return w;
}

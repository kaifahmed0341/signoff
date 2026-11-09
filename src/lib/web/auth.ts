import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { sign, verifySignature, verifyShareToken } from "../services/ids";

const COOKIE = "signoff_operator";
const MAX_AGE_S = 60 * 60 * 24 * 7;

export function passcodeMatches(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(env().OPERATOR_PASSCODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startOperatorSession() {
  const issued = String(Date.now());
  (await cookies()).set(COOKIE, `${issued}.${sign("operator-session", issued)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function endOperatorSession() {
  (await cookies()).delete(COOKIE);
}

export async function isOperator(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [issued, sig] = raw.split(".");
  if (!issued || !sig || !verifySignature("operator-session", issued, sig)) return false;
  return Date.now() - Number(issued) < MAX_AGE_S * 1000;
}

export async function requireOperator() {
  if (!(await isOperator())) redirect("/login");
}

export function requireShareToken(projectId: string, token: string | null | undefined) {
  if (!token || !verifyShareToken(projectId, token)) throw new Response("This link is not valid", { status: 403 });
}

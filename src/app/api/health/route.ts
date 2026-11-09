import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { env, railMode } from "@/lib/env";
import { resolveModel } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

/** Reports what is live on this server. Never includes keys or ids. */
export async function GET() {
  const e = env();
  let database: "ok" | "error" = "ok";
  try {
    await (await getDb()).run(sql`select 1`);
  } catch {
    database = "error";
  }
  const dbKind = e.DATABASE_URL.startsWith("file:") || e.DATABASE_URL === ":memory:" ? "local-file" : "hosted-libsql";
  const body = {
    status: database === "ok" ? "ok" : "degraded",
    rail: railMode(e),
    ai: { provider: resolveModel().label.split("/")[0], model: resolveModel().label },
    database: { kind: dbKind, reachable: database === "ok" },
    demoMode: e.DEMO_MODE,
    warnings: [
      ...(process.env.VERCEL && dbKind === "local-file" ? ["DATABASE_URL points at a local file; serverless hosts need a hosted libSQL database"] : []),
      ...(e.SESSION_SECRET.startsWith("dev-only") ? ["SESSION_SECRET is the development default"] : []),
    ],
  };
  return Response.json(body, { status: database === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}

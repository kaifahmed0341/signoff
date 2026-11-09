import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { setEnvForTests, type Env } from "@/lib/env";
import { createTestDb } from "@/lib/db";
import { FakeRail, resetFakeRail } from "@/lib/payments/fake-rail";
import { setRailForTests } from "@/lib/payments";
import { setModelForTests } from "@/lib/ai/model";

/** Serves public/ so the sample deliverables are reachable at APP_URL/samples/... */
export async function startStaticServer(): Promise<{ server: Server; origin: string }> {
  const root = path.join(process.cwd(), "public");
  const server = createServer(async (req, res) => {
    const p = path.normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
    try {
      const body = await readFile(path.join(root, p));
      res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

export async function freshWorld(overrides: Partial<Env> = {}) {
  setEnvForTests(overrides);
  resetFakeRail();
  const rail = new FakeRail();
  setRailForTests(rail);
  setModelForTests(undefined);
  const db = await createTestDb();
  return { db, rail };
}

/** Change the last character so the signature is always different. */
export function tamper(signature: string): string {
  const last = signature.slice(-1);
  return signature.slice(0, -1) + (last === "0" ? "1" : "0");
}

/** The evaluation set stays the size the README quotes, its fixtures load, and the deterministic parts hold without a model. */
import { existsSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVAL_CASES, injectionScore, runEvalCase } from "@/lib/eval/cases";
import { freshWorld, startStaticServer } from "./helpers";

let server: Server;
let origin: string;
beforeAll(async () => ({ server, origin } = await startStaticServer()));
afterAll(() => server.close());

describe("evaluation set", () => {
  it("has at least 16 deliveries and 60 criteria, with unique ids", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(16);
    expect(EVAL_CASES.flatMap((c) => c.criteria).length).toBeGreaterThanOrEqual(60);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it("every fixture file exists", () => {
    for (const c of EVAL_CASES) {
      for (const f of c.files ?? []) expect(existsSync(path.join("public", typeof f === "string" ? f : f.path))).toBe(true);
      for (const l of c.links("http://x")) if (l.startsWith("http://x/")) expect(existsSync(path.join("public", l.slice("http://x/".length)))).toBe(true);
    }
  });

  it("without a model, the tampering reader flags every injection except the one in Spanish, and nothing marked not met or a person's call passes", async () => {
    const world = await freshWorld({ APP_URL: origin, AI_PROVIDER: "scripted" });
    const results = [];
    for (const c of EVAL_CASES.filter((x) => !x.network)) results.push(await runEvalCase(world.db, world.rail, world.owner.id, c, origin));
    expect(injectionScore(results).notFlagged).toEqual(["inj-language"]);
    const falsePasses = results.flatMap((r) => r.rows).filter((r) => r.got === "met" && r.expected !== "met");
    expect(falsePasses).toEqual([]);
  }, 60_000);
});

/**
 * Runs the evaluation set and prints a table.
 *
 *   set -a; . ./.env.local; set +a
 *   pnpm eval                       # every case once with the model, then the keyword baseline; writes docs/eval-latest.md and .json
 *   pnpm eval --baseline-only       # only the scripted keyword checker, no AI calls
 *   pnpm eval --sample-runs 5       # the sample loop (v1 then v2) five times, with timings
 *   pnpm eval --offline             # skip the case that needs GitHub
 *   pnpm eval --pause 15            # wait between checks, to stay inside a free-tier quota
 *   pnpm eval --only a,b --no-write # run some cases without replacing docs/eval-latest.md
 *
 * Uses an in-memory database and the test rail. The model comes from the
 * environment like the app (Gemini by default); with no key it runs the
 * scripted checker and says so. The baseline is the same scripted checker the
 * app falls back to: it matches key words and uses no AI.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveModel } from "../src/lib/ai/model";
import { EVAL_CASES, injectionScore, runEvalCase, scoreTable, type EvalCase, type EvalCaseResult } from "../src/lib/eval/cases";
import { freshWorld, startStaticServer } from "../tests/unit/helpers";

const args = process.argv.slice(2);
const sampleRuns = Number(args[args.indexOf("--sample-runs") + 1]) || 0;
const offline = args.includes("--offline");
const baselineOnly = args.includes("--baseline-only");
const pauseSeconds = args.includes("--pause") ? Number(args[args.indexOf("--pause") + 1]) : 0;
const pause = () => new Promise((r) => setTimeout(r, pauseSeconds * 1000));
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

const { server, origin } = await startStaticServer();
const aiEnv = {
  APP_URL: origin,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  GOOGLE_MODEL: process.env.GOOGLE_MODEL || undefined,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  AI_PROVIDER: (process.env.AI_PROVIDER as "auto") || "auto",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
};

function print(results: EvalCaseResult[]) {
  for (const r of results) {
    const flag = r.injection ? `, injection ${r.injectionFlagged ? "flagged" : "NOT flagged"}` : "";
    console.log(`${r.caseId}  (${r.seconds.toFixed(1)} s, ${r.model}${r.fallbackReason ? `, FALLBACK: ${r.fallbackReason}` : ""}${flag})`);
    for (const row of r.rows) console.log(`  ${row.correct ? "ok   " : row.got === "needs_person" ? "PERSON" : "WRONG"} expected ${row.expected.padEnd(12)} got ${row.got.padEnd(12)} ${row.criterion}`);
  }
}

async function runAll(cases: EvalCase[], env: NonNullable<Parameters<typeof freshWorld>[0]>, label: string): Promise<{ model: string; results: EvalCaseResult[] }> {
  const world = await freshWorld(env);
  const model = resolveModel().label;
  console.log(`\n== ${label}: ${model}\n`);
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    results.push(await runEvalCase(world.db, world.rail, world.owner.id, c, origin));
    if (env.AI_PROVIDER !== "scripted") await pause();
  }
  print(results);
  return { model, results };
}

if (sampleRuns) {
  const world = await freshWorld(aiEnv);
  console.log(`Model: ${resolveModel().label}\n`);
  for (let i = 1; i <= sampleRuns; i++) {
    const v1 = await runEvalCase(world.db, world.rail, world.owner.id, byId("landing-v1"), origin);
    await pause();
    const v2 = await runEvalCase(world.db, world.rail, world.owner.id, byId("landing-v2"), origin);
    await pause();
    const fmt = (r: EvalCaseResult) => r.rows.map((x) => (x.got === "met" ? "M" : x.got === "not_met" ? "N" : "P")).join("");
    const ok = v1.rows.every((x) => x.correct) && v2.rows.every((x) => x.correct);
    console.log(`run ${i}: v1 ${fmt(v1)} (${v1.seconds.toFixed(1)} s, ${v1.model})  v2 ${fmt(v2)} (${v2.seconds.toFixed(1)} s, ${v2.model})  ${ok ? "as expected" : "MISMATCH"}${v1.fallbackReason || v2.fallbackReason ? `  fallback: ${v1.fallbackReason ?? v2.fallbackReason}` : ""}`);
  }
  console.log("\nExpected: v1 MNNM, v2 MMMM (M met, N not met, P needs a person)");
  server.close();
  process.exit(0);
}

const selected = EVAL_CASES.filter((c) => !(offline && c.network) && !(only && !only.includes(c.id)));
// The baseline never reads GitHub, so it is scored on the cases that need no network.
const baselineCases = selected.filter((c) => !c.network);

const ai = baselineOnly ? null : await runAll(selected, aiEnv, "Checker");
const base = await runAll(baselineCases, { APP_URL: origin, AI_PROVIDER: "scripted" }, "Keyword baseline");

function answeredBy(results: EvalCaseResult[]): string {
  const counts = new Map<string, string[]>();
  for (const r of results) counts.set(r.model, [...(counts.get(r.model) ?? []), r.caseId]);
  return [...counts].map(([m, ids]) => `\`${m}\` on ${ids.length}${ids.length < results.length / 2 ? ` (${ids.join(", ")})` : ""}`).join(", ");
}

const line = (name: string, s: ReturnType<typeof scoreTable>) => `${name}: ${s.correct} of ${s.total} criteria correct across ${s.deliveries} deliveries, ${s.wrong} wrong, ${s.toPerson} sent to a person`;
const summary: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10) };
if (ai) {
  const s = scoreTable(ai.results);
  const inj = injectionScore(ai.results);
  const noNet = scoreTable(ai.results.filter((r) => !EVAL_CASES.find((c) => c.id === r.caseId)?.network));
  console.log(`\n${line("Checker", s)}`);
  console.log(`Prompt injection: ${inj.correct} of ${inj.total} criteria correct on ${inj.deliveries} deliveries; the instruction was flagged on ${inj.flagged} of ${inj.deliveries} reports${inj.notFlagged.length ? ` (not flagged: ${inj.notFlagged.join(", ")})` : ""}`);
  console.log(`Checker on the ${noNet.total} criteria that need no network: ${noNet.correct} correct`);
  Object.assign(summary, { model: ai.model, answeredBy: answeredBy(ai.results), fellBack: ai.results.filter((r) => r.fallbackReason).map((r) => r.caseId), checker: s, checkerNoNetwork: noNet, injection: inj });
}
const b = scoreTable(base.results);
console.log(line("Keyword baseline", b));
Object.assign(summary, { baseline: b, baselineInjection: injectionScore(base.results) });

if (!args.includes("--no-write") && ai) {
  const s = scoreTable(ai.results);
  const inj = injectionScore(ai.results);
  const fellBack = ai.results.some((r) => r.fallbackReason);
  const baseRow = (id: string, i: number) => base.results.find((r) => r.caseId === id)?.rows[i]?.got ?? "not run";
  const misses = ai.results.flatMap((r) => r.rows.filter((x) => !x.correct));
  const prevSample = existsSync("docs/eval-latest.md") ? readFileSync("docs/eval-latest.md", "utf8").split(/\n(?=## Sample loop)/)[1] : undefined;
  const md = [
    `# Latest evaluation`,
    ``,
    `Run on ${summary.date} with \`${ai.model}\`${fellBack ? " (some cases fell back to the scripted checker, see the notes)" : ""}. Generated by \`pnpm eval\`.`,
    ``,
    `Models that answered: ${answeredBy(ai.results)}. When the main model is rate-limited, the next model in the chain answers, as it does in the app.`,
    ``,
    `**Checker: ${s.correct} of ${s.total} criteria correct across ${s.deliveries} deliveries, ${s.wrong} wrong, ${s.toPerson} sent to a person when the right answer was met or not met.**`,
    ``,
    `**Prompt injection, counted apart: ${inj.correct} of ${inj.total} criteria correct on ${inj.deliveries} deliveries that carry an instruction aimed at the checker. The report flagged the instruction on ${inj.flagged} of ${inj.deliveries}${inj.notFlagged.length ? `; not flagged: ${inj.notFlagged.join(", ")}` : ""}.**`,
    ``,
    `**Keyword baseline** (the scripted checker the app falls back to, no AI), on the ${b.total} criteria that need no network: ${b.correct} correct, ${b.wrong} wrong, ${b.toPerson} sent to a person.`,
    ``,
    misses.length ? `Misses: ${misses.map((m) => `\`${m.caseId}\` "${m.criterion}" expected ${m.expected}, got ${m.got}`).join("; ")}.` : `No misses.`,
    ``,
    `| Delivery | Group | Criterion | Expected | Checker | Baseline | Result |`,
    `|---|---|---|---|---|---|---|`,
    ...ai.results.flatMap((r) => r.rows.map((x, i) => `| ${r.caseId} | ${r.group}${r.injection ? ", injection" : ""} | ${x.criterion} | ${x.expected} | ${x.got} | ${baseRow(r.caseId, i)} | ${x.correct ? "correct" : x.got === "needs_person" ? "to a person" : "wrong"} |`)),
    ``,
    `| Delivery | Model that answered | Seconds | Injection flagged | Notes |`,
    `|---|---|---|---|---|`,
    ...ai.results.map((r) => `| ${r.caseId} | ${r.model} | ${r.seconds.toFixed(1)} | ${r.injection ? (r.injectionFlagged ? "yes" : "no") : ""} | ${r.fallbackReason ?? ""} |`),
    ``,
    ...(prevSample ? [prevSample.trimEnd(), ``] : []),
  ].join("\n");
  writeFileSync("docs/eval-latest.md", md);
  writeFileSync("docs/eval-latest.json", `${JSON.stringify(summary, null, 2)}\n`);
  console.log("\nWrote docs/eval-latest.md and docs/eval-latest.json");
}
server.close();
process.exit(0);

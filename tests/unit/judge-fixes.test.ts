/**
 * Fixes for what the two judges found on 10 November 2026:
 * J1 the planner dropped subjective scope lines;
 * J2 a downgraded verdict kept the model's approving sentence;
 * J3 a "not met" showed an unrelated quote as if it were evidence.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { verdicts } from "@/lib/db/schema";
import { runCheck, scriptedJudge } from "@/lib/ai/checker";
import { setModelForTests } from "@/lib/ai/model";
import { PERSON_PREFIX, aboutPage, bearsOn, finalizeVerdict, isPersonCriterion, verifyEvidence } from "@/lib/ai/evidence";
import { finalizePlan, scriptedPlan, subjectiveLines, type Plan } from "@/lib/ai/planner";
import { FAKE_NONCES, type FakeRail } from "@/lib/payments/fake-rail";
import { createSampleProject, sampleLinks } from "@/lib/sample";
import { submitDelivery } from "@/lib/services/deliveries";
import { OWNER_WORKSPACE_ID as OWNER } from "@/lib/services/workspaces";
import { fundMilestone, getMilestone, latestCheck, milestoneCriteria, projectMilestones } from "@/lib/services/milestones";
import type { DB } from "@/lib/db";
import { freshWorld, startStaticServer } from "./helpers";

let server: Server;
let origin: string;
beforeAll(async () => ({ server, origin } = await startStaticServer()));
afterAll(() => server.close());

let db: DB;
let rail: FakeRail;
beforeEach(async () => {
  ({ db, rail } = await freshWorld({ APP_URL: origin, AI_PROVIDER: "scripted" }));
});

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const judgeWith = (results: unknown[]) =>
  new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify({ results }) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) });

async function funded() {
  const p = await createSampleProject(db, OWNER);
  const [m] = await projectMilestones(db, p.id);
  await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
  return getMilestone(db, m.id);
}

async function verdictsOf(milestoneId: string) {
  const c = await latestCheck(db, milestoneId);
  const vs = await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id));
  const crit = await milestoneCriteria(db, milestoneId);
  return crit.map((cr) => ({ text: cr.text, ...vs.find((v) => v.criterionId === cr.id)! }));
}

// The judge's own scope, a bookkeeping firm in Leeds, cut down.
const SCOPE = `Hi Dana, here is the plan for Ledgerline Bookkeeping.

Milestone 1: One-page site ($800, due in 14 days)
- The page shows the phone number 0113 496 0123.
- The page lists the three services: payroll, VAT returns and year-end accounts.
Should look modern and trustworthy, not like a template. Mobile friendly.

Milestone 2: Logos ($400, due in 21 days)
- Two logo options delivered as SVG files.
Something calm and professional, we pick one.
`;

describe("J1 subjective scope lines become person-judged criteria, never dropped", () => {
  it("J1: the scripted planner keeps every subjective line, on the milestone it sits under", () => {
    const plan = finalizePlan(scriptedPlan(SCOPE), SCOPE, "scripted");
    const [m1, m2] = plan.milestones;
    const person1 = m1.criteria.filter((c) => isPersonCriterion(c.text)).map((c) => c.text);
    const person2 = m2.criteria.filter((c) => isPersonCriterion(c.text)).map((c) => c.text);
    expect(person1.some((t) => /modern and trustworthy/.test(t))).toBe(true);
    expect(person1.some((t) => /Mobile friendly/.test(t))).toBe(true);
    expect(person2.some((t) => /calm and professional/.test(t))).toBe(true);
    expect(plan.personCriteria).toBe(3);
    // Every added criterion quotes the scope, so the citation still verifies.
    for (const c of [...m1.criteria, ...m2.criteria]) expect(SCOPE.replace(/\s+/g, " ")).toContain(c.sourceQuote);
  });

  it("J1: when a model leaves the lines out, the code adds them back; when it marks one, it is not added twice", () => {
    const fromModel: Plan = {
      projectName: "Ledgerline Bookkeeping",
      milestones: [
        { title: "One-page site", deliverable: "Site", amount: 800, dueInDays: 14, criteria: [
          { text: "The page shows the phone number 0113 496 0123.", sourceQuote: "The page shows the phone number 0113 496 0123.", needsPerson: false },
          { text: "The site looks modern and trustworthy, not like a template.", sourceQuote: "Should look modern and trustworthy, not like a template.", needsPerson: true },
        ] },
        { title: "Logos", deliverable: "Logos", amount: 400, dueInDays: 21, criteria: [
          { text: "Two logo options are delivered as SVG files.", sourceQuote: "Two logo options delivered as SVG files.", needsPerson: false },
        ] },
      ],
    };
    const plan = finalizePlan(fromModel, SCOPE, "mock");
    expect(plan.personAdded).toBe(2);
    const all = plan.milestones.flatMap((m) => m.criteria.map((c) => c.text));
    expect(all.filter((t) => /modern/.test(t))).toHaveLength(1);
    expect(all.find((t) => /modern/.test(t))!.startsWith(PERSON_PREFIX)).toBe(true);
    expect(plan.milestones[0].criteria.some((c) => /Mobile friendly/.test(c.text))).toBe(true);
    expect(plan.milestones[1].criteria.some((c) => /calm and professional/.test(c.text))).toBe(true);
  });

  it("J1: ordinary scope lines and milestone headers are not treated as subjective", () => {
    expect(subjectiveLines("Milestone 1: Modern landing page ($100)\nThe page lists the opening hours.")).toEqual([]);
  });

  it("J1: the checker always sends a person-judged criterion to a person, even when the model says met", () => {
    const r = finalizeVerdict({
      criterion: `${PERSON_PREFIX}Mobile friendly.`,
      verdict: "met",
      reasoning: "The site works well on phones.",
      kept: [{ source: "p", quote: "Book a call from your phone today", kind: "page" }],
      dropped: [],
      pageCriterion: true,
    });
    expect(r.verdict).toBe("needs_person");
    expect(r.reasoning).not.toMatch(/works well/);
    expect(scriptedJudge([{ id: "x", milestoneId: "m", position: 0, text: `${PERSON_PREFIX}Something calm and professional, we pick one.`, sourceQuote: "s", quoteVerified: true }], []).results[0].verdict).toBe("needs_person");
  });
});

describe("J2 a downgraded verdict says why and drops the model's approval", () => {
  it("J2: a hollow PDF the model approved shows the reason, not the model's sentence", () => {
    const approving = "The delivered document is a 6-page PDF strategy covering the target best customers, three focus channels, and a monthly budget section.";
    const r = finalizeVerdict({
      criterion: "The strategy document sets a monthly budget of $1,200 across the three channels.",
      verdict: "met",
      reasoning: approving,
      kept: [{ source: "file:strategy.pdf", quote: "Spend what you can afford each month.", kind: "deliverable_file" }],
      dropped: [],
      pageCriterion: false,
    });
    expect(r.verdict).toBe("needs_person");
    expect(r.reasoning).not.toContain(approving);
    expect(r.reasoning).toMatch(/called this met, but/);
    expect(r.reasoning).toMatch(/"1,200"/);
    expect(r.note).toBeNull();
  });

  it("J2: every downgrade path explains itself", () => {
    const base = { criterion: "The page shows the studio address: 14 Kiln Lane, Portland.", verdict: "met" as const, reasoning: "Looks complete.", pageCriterion: true };
    const allRemoved = finalizeVerdict({ ...base, kept: [], dropped: [{ source: "p", quote: "x".repeat(25), reason: "hidden from visitors on the page" }] });
    expect(allRemoved.reasoning).toMatch(/all 1 of its quote\(s\) were removed/);
    const noQuote = finalizeVerdict({ ...base, kept: [], dropped: [] });
    expect(noQuote.reasoning).toMatch(/gave no quote/);
    const fileOnly = finalizeVerdict({ ...base, kept: [{ source: "file:a.html", quote: "Find us at 14 Kiln Lane, Portland", kind: "deliverable_file" }], dropped: [] });
    expect(fileOnly.reasoning).toMatch(/uploaded file/);
    const notesOnly = finalizeVerdict({ ...base, kept: [{ source: "file:n.txt", quote: "Find us at 14 Kiln Lane, Portland", kind: "notes_file" }], dropped: [] });
    expect(notesOnly.reasoning).toMatch(/notes/);
    for (const r of [allRemoved, noQuote, fileOnly, notesOnly]) {
      expect(r.verdict).toBe("needs_person");
      expect(r.reasoning).not.toMatch(/Looks complete/);
    }
  });

  it("J2: end to end, the saved verdict carries the reason, not the model's approval", async () => {
    const m = await funded();
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    setModelForTests({ label: "mock/test", model: judgeWith([{ criterionId: "c2", verdict: "met", reasoning: "The Saturday class and its start time are listed in full.", evidence: [{ source: sampleLinks(1)[0], quote: "Saturday wheel-throwing (schedule coming soon)" }] }]) });
    await runCheck(db, m.id, d);
    const v = (await verdictsOf(m.id))[1];
    expect(v.verdict).toBe("needs_person");
    expect(v.reasoning).not.toMatch(/listed in full/);
    expect(v.reasoning).toMatch(/"10:00"/);
  });

  it("J2: a criterion about a document is not treated as a live page", () => {
    expect(aboutPage("The 6-page strategy PDF names three focus channels.")).toBe(false);
    expect(aboutPage("The landing page shows the phone number.")).toBe(true);
  });
});

describe("J3 a not-met verdict never shows an unrelated quote as evidence", () => {
  it("J3: the business name is not kept on 'studio address: not met'", () => {
    const r = finalizeVerdict({
      criterion: "The page shows the studio address: 14 Kiln Lane, Portland.",
      verdict: "not_met",
      reasoning: "The page does not show an address.",
      kept: [{ source: "p", quote: "Larkspur Pottery Studio", kind: "page" }],
      dropped: [],
      pageCriterion: true,
    });
    expect(r.verdict).toBe("not_met");
    expect(r.evidence).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/^does not mention/);
  });

  it("J3: a swapped phone number or a 'coming soon' line is kept, as what the page shows instead", () => {
    expect(bearsOn("Call us on 0113 496 0132", "The page shows the phone number 0113 496 0123.")).toBe(true);
    expect(bearsOn("Saturday wheel-throwing (schedule coming soon)", "The page lists the Saturday wheel-throwing class with its start time of 10:00.")).toBe(true);
    expect(bearsOn("Larkspur Pottery Studio", "The page shows the studio address: 14 Kiln Lane, Portland.")).toBe(false);
  });

  it("J3: end to end, the saved not-met verdict has no unrelated quote", async () => {
    const m = await funded();
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    setModelForTests({ label: "mock/test", model: judgeWith([{ criterionId: "c3", verdict: "not_met", reasoning: "No address is shown.", evidence: [{ source: sampleLinks(1)[0], quote: "Larkspur Pottery Studio" }] }]) });
    await runCheck(db, m.id, d);
    const v = (await verdictsOf(m.id))[2];
    expect(v.verdict).toBe("not_met");
    expect(v.evidence).toHaveLength(0);
  });
});

describe("J4 eval misses fixed in the evidence rule (10 November 2026)", () => {
  const page = [{ source: "p", text: "Hire\nTwo-hour hire: $35\nHalf-day hire: $55\nSaturday", kind: "page" as const }];
  it("J4: a short list item that shows every value the criterion names is kept", () => {
    const req = { text: "The page lists two-hour hire at $35.", sourceQuote: "The page lists two-hour hire at $35." };
    expect(verifyEvidence([{ source: "p", quote: "Two-hour hire: $35" }], page, req).kept).toHaveLength(1);
  });
  it("J4: a short quote missing a value, a lone word, and a criterion with no values still need 20 characters", () => {
    const priced = { text: "The page lists half-day hire at $60.", sourceQuote: "x" };
    expect(verifyEvidence([{ source: "p", quote: "Half-day hire: $55" }], page, priced).kept).toHaveLength(0);
    const noValues = { text: "The page lists the hire options.", sourceQuote: "x" };
    expect(verifyEvidence([{ source: "p", quote: "Two-hour hire: $35" }], page, noValues).dropped[0].reason).toMatch(/too short/);
    const day = { text: "The page names Saturday.", sourceQuote: "x" };
    expect(verifyEvidence([{ source: "p", quote: "Saturday" }], page, day).kept).toHaveLength(0);
  });
  it("J4: a list under its heading keeps the key-word link to the criterion", () => {
    const doc = [{ source: "file:s.pdf", text: "Best customers\nSmall businesses.\nThree focus channels\n1. Social media 2. Google 3. Networking", kind: "deliverable_file" as const }];
    const req = { text: "The strategy document names three focus channels.", sourceQuote: "x" };
    expect(verifyEvidence([{ source: "file:s.pdf", quote: "1. Social media 2. Google 3. Networking" }], doc, req).kept).toHaveLength(1);
  });
});

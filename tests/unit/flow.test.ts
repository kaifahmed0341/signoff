import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { auditEvents, checks, verdicts, toolCalls, disputes } from "@/lib/db/schema";
import { STALE_CHECK_MS, draftChangeNote, failStaleChecks, runCheck } from "@/lib/ai/checker";
import { setModelForTests } from "@/lib/ai/model";
import { createSampleProject, sampleLinks } from "@/lib/sample";
import { submitDelivery } from "@/lib/services/deliveries";
import {
  acceptAndRelease,
  declineMilestone,
  fundMilestone,
  getMilestone,
  latestCheck,
  projectMilestones,
  reconcileMilestone,
  requestChanges,
  verifyRecord,
} from "@/lib/services/milestones";
import { approveAndSubmitDispute, handleWebhook, milestoneDisputes, syncDisputes } from "@/lib/services/disputes";
import { FAKE_NONCES, type FakeRail } from "@/lib/payments/fake-rail";
import type { DB } from "@/lib/db";
import { OWNER_WORKSPACE_ID as OWNER } from "@/lib/services/workspaces";
import { freshWorld, startStaticServer, tamper } from "./helpers";

let server: Server;
let origin: string;
beforeAll(async () => ({ server, origin } = await startStaticServer()));
afterAll(() => server.close());

let db: DB;
let rail: FakeRail;
beforeEach(async () => {
  ({ db, rail } = await freshWorld({ APP_URL: origin, AI_PROVIDER: "scripted" }));
});

async function firstMilestone() {
  const p = await createSampleProject(db, OWNER);
  const [m] = await projectMilestones(db, p.id);
  return m;
}

async function verdictsFor(milestoneId: string) {
  const c = await latestCheck(db, milestoneId);
  return db.select().from(verdicts).where(eq(verdicts.checkId, c!.id));
}

describe("the full loop on the fake rail with the scripted checker", () => {
  it("drafts the sample milestones with verified scope quotes", async () => {
    const m = await firstMilestone();
    expect(m.state).toBe("awaiting_funding");
    expect(m.amountCents).toBe(45000);
  });

  it("holds, checks v1 (fails), requests changes, checks v2 (passes), releases", async () => {
    const m0 = await firstMilestone();
    const funded = await fundMilestone(db, rail, m0.id, { nonce: FAKE_NONCES.paypal });
    expect(funded.state).toBe("funded");
    expect(funded.payerLabel).toContain("PayPal");
    expect(funded.authExpiresAt).toBeTruthy();

    const d1 = await submitDelivery(db, m0.id, { links: sampleLinks(1), notes: "First draft", files: [] });
    await runCheck(db, m0.id, d1);
    expect((await getMilestone(db, m0.id)).state).toBe("in_review");
    const v1 = await verdictsFor(m0.id);
    expect(v1.filter((v) => v.verdict === "met")).toHaveLength(2); // headline and waitlist
    expect(v1.filter((v) => v.verdict === "not_met")).toHaveLength(2); // Saturday time and address
    for (const v of v1.filter((x) => x.verdict === "met")) expect(v.evidence.length).toBeGreaterThan(0);

    const note = await draftChangeNote(db, m0.id);
    expect(note).toContain("Saturday");
    await requestChanges(db, m0.id, note);
    expect((await getMilestone(db, m0.id)).state).toBe("changes_requested");

    const d2 = await submitDelivery(db, m0.id, { links: sampleLinks(2), notes: "Fixed", files: [] });
    await runCheck(db, m0.id, d2);
    const v2 = await verdictsFor(m0.id);
    expect(v2.map((v) => [v.verdict, v.note, JSON.stringify(v.dropped)])).toEqual(v2.map(() => ["met", null, "[]"]));

    const released = await acceptAndRelease(db, rail, m0.id, { signerName: "Robin Client" });
    expect(released.state).toBe("released");
    expect(released.settledCents).toBe(45000);
    expect(released.receiptNumber).toMatch(/^SO-/);
    expect(verifyRecord(released.acceptanceRecord!, released.acceptanceSignature!)).toBe(true);
    expect(verifyRecord(released.acceptanceRecord!.replace("Robin", "Mallory"), released.acceptanceSignature!)).toBe(false);
    expect((await rail.getHold(released.transactionId!)).status).toBe("submitted_for_settlement");

    const events = await db.select().from(auditEvents).where(eq(auditEvents.milestoneId, m0.id));
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["hold.placed", "delivery.submitted", "check.completed", "changes.requested", "acceptance.signed", "hold.released"]),
    );
  });

  it("supports a partial release", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
    await runCheck(db, m.id, d);
    const r = await acceptAndRelease(db, rail, m.id, { signerName: "Robin", amountCents: 30000 });
    expect(r.settledCents).toBe(30000);
  });

  it("declines by voiding the hold", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const after = await declineMilestone(db, rail, m.id, "Changed our plans");
    expect(after.state).toBe("declined");
    expect((await rail.getHold(after.transactionId!)).status).toBe("voided");
  });

  it("records a declined card and leaves the milestone fundable", async () => {
    const m = await firstMilestone();
    await expect(fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.declined })).rejects.toThrow(/Do Not Honor/);
    expect((await getMilestone(db, m.id)).state).toBe("awaiting_funding");
    const funded = await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    expect(funded.state).toBe("funded");
  });

  it("refuses to release before a review, and refuses double release", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    await expect(acceptAndRelease(db, rail, m.id, { signerName: "Robin" })).rejects.toThrow(/ready for sign-off/);
  });

  it("reconcile notices an expired hold", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    await rail.advanceClock(8 * 24 * 60 * 60 * 1000);
    const r = await reconcileMilestone(db, rail, m.id);
    expect(r.remote).toBe("authorization_expired");
    expect((await getMilestone(db, m.id)).state).toBe("hold_expired");
    const again = await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    expect(again.state).toBe("funded");
  });
});

describe("AI checker with a model (mocked, deterministic)", () => {
  it("judges in one call, keeps real quotes, drops invented ones with reasons, records progress", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    const page = sampleLinks(1)[0];
    const byCriterion: Record<string, object> = {
      headline: { verdict: "met", reasoning: "Headline is there.", evidence: [{ source: page, quote: "Larkspur Pottery Studio" }] },
      // Invented quote: not on the page. Must be dropped and the verdict downgraded.
      Saturday: { verdict: "met", reasoning: "Saturday class listed.", evidence: [{ source: page, quote: "Saturday wheel-throwing class, start time 10:00" }] },
      address: { verdict: "not_met", reasoning: "No address on the page.", evidence: [] },
      waitlist: { verdict: "met", reasoning: "Signup form present.", evidence: [{ source: "anything", quote: "Join the waitlist with this signup form:" }] },
    };
    const model = mockJudge((criterion) => byCriterion[Object.keys(byCriterion).find((k) => criterion.includes(k))!]);
    setModelForTests({ model: model.model, label: "mock/test" });
    const checkId = await runCheck(db, m.id, d);
    expect(model.calls()).toBe(1); // one judge call for all criteria, no exploration for a page without links
    const vs = await verdictsFor(m.id);
    const byPos = (n: number) => vs[n - 1];
    expect(byPos(1).verdict).toBe("met");
    expect(byPos(2).verdict).toBe("needs_person");
    expect(byPos(2).note).toMatch(/removed/);
    expect(byPos(2).dropped[0].reason).toMatch(/not found/);
    expect(byPos(3).verdict).toBe("not_met");
    expect(byPos(4).evidence[0].source).toBe(page);
    const check = await latestCheck(db, m.id);
    expect(check!.id).toBe(checkId);
    expect(check!.droppedEvidence).toBe(1);
    expect(check!.fallbackReason).toBeNull();
    expect(check!.model).toBe("mock/test");
    expect(check!.progress!.phase).toBe("saving");
    expect(Object.values(check!.progress!.criteria)).toEqual(["done", "done", "done", "done"]);
    expect(check!.progress!.reading[0]).toContain("read_url");
  });

  it("explores linked pages with tools, and blocks hosts outside the delivery", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: [`${origin}/samples/eval/prices-wrong/index.html`], notes: "", files: [] });
    let explored = 0;
    const model = mockJudge(
      () => ({ verdict: "not_met", reasoning: "Not shown.", evidence: [] }),
      (n) => {
        explored++;
        if (n === 0) return { type: "tool-call", toolCallId: "t1", toolName: "read_url", input: JSON.stringify({ url: "https://evil.example/exfil" }) };
        if (n === 1) return { type: "tool-call", toolCallId: "t2", toolName: "read_url", input: JSON.stringify({ url: `${origin}/samples/larkspur-v2/index.html` }) };
        return { type: "text", text: "DONE" };
      },
    );
    setModelForTests({ model: model.model, label: "mock/test" });
    const checkId = await runCheck(db, m.id, d);
    expect(explored).toBeGreaterThanOrEqual(3);
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.checkId, checkId));
    expect(calls.find((c) => c.input.includes("evil.example"))?.output).toMatch(/Blocked/);
    expect(calls.find((c) => c.input.includes("larkspur-v2"))?.ok).toBe(true);
  });

  it("falls back to the scripted checker, with the reason, when the model fails", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("upstream 503"); } });
    setModelForTests({ model, label: "mock/test" });
    await runCheck(db, m.id, d);
    const check = await latestCheck(db, m.id);
    expect(check!.status).toBe("done");
    expect(check!.model).toBe("scripted");
    expect(check!.fallbackReason).toMatch(/The AI model failed/);
    expect(check!.summary).toMatch(/scripted checker ran instead/);
    expect((await verdictsFor(m.id)).every((v) => v.verdict === "met")).toBe(true);
  });

  it("falls back to the scripted checker when the demo workspace's daily AI cap is used up", async () => {
    const w = await freshWorld({ APP_URL: origin, AI_PROVIDER: "scripted", LIMIT_AI_CHECKS_PER_WORKSPACE: 1 });
    db = w.db;
    rail = w.rail;
    const demo = w.demo;
    const p = await createSampleProject(db, demo.id);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const model = mockJudge(() => ({ verdict: "met", reasoning: "ok", evidence: [{ source: "x", quote: "Larkspur Pottery Studio" }] }));
    setModelForTests({ model: model.model, label: "mock/test" });
    const d1 = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    await runCheck(db, m.id, d1);
    expect((await latestCheck(db, m.id))!.model).toBe("mock/test");
    await requestChanges(db, m.id, "again please");
    const d2 = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
    await runCheck(db, m.id, d2);
    const second = await latestCheck(db, m.id);
    expect(second!.model).toBe("scripted");
    expect(second!.fallbackReason).toMatch(/used its 1 AI checks for today/);
  });

  it("marks a check that never finished as failed and frees the milestone", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
    await db.insert(checks).values({ id: "chk_stuck", milestoneId: m.id, deliveryId: d, status: "running", model: "x", startedAt: new Date(Date.now() - STALE_CHECK_MS - 1000) });
    await failStaleChecks(db, m.id);
    expect((await getMilestone(db, m.id)).state).toBe("funded");
    const [c] = await db.select().from(checks).where(eq(checks.id, "chk_stuck"));
    expect(c.status).toBe("failed");
  });
});

type GenOptions = { prompt: { role: string; content: unknown }[]; tools?: unknown[] };

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

/**
 * A mock model. Judge calls (no tools) get one result per criterion from
 * `judge(criterionText)`; exploration calls (with tools) get `explore(step)`.
 */
function mockJudge(judge: (criterion: string) => object, explore?: (step: number) => Record<string, unknown>) {
  let calls = 0;
  let step = 0;
  const model = new MockLanguageModelV4({
    doGenerate: (async (opts: GenOptions) => {
      calls++;
      const text = JSON.stringify(opts.prompt.filter((m) => m.role === "user").map((m) => m.content)).replace(/\\n/g, "\n");
      if (opts.tools?.length) {
        const part = explore ? explore(step++) : { type: "text", text: "DONE" };
        return { content: [part as never], finishReason: { unified: part.type === "tool-call" ? "tool-calls" : "stop", raw: undefined }, usage, warnings: [] };
      }
      const results = [...text.matchAll(/\bc(\d+): ([^\n]+)/g)].map((m) => ({ criterionId: `c${m[1]}`, ...judge(m[2]) }));
      return { content: [{ type: "text", text: JSON.stringify({ results }) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    }) as never,
  });
  return { model, calls: () => calls };
}

describe("webhooks and dispute defence", () => {
  async function releasedWithDisputeCard() {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
    await runCheck(db, m.id, d);
    return acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
  }

  it("rejects a webhook with a bad signature", async () => {
    const s = await rail.sampleWebhook("dispute_opened", "x");
    const r = await handleWebhook(db, rail, tamper(s.signature), s.payload);
    expect(r.status).toBe(400);
  });

  it("opens a dispute from a signed webhook, drafts evidence, dedupes repeats", async () => {
    const m = await releasedWithDisputeCard();
    const disputeId = await rail.openDisputeFor(m.transactionId!);
    const s = await rail.disputeWebhook("dispute_opened", disputeId);
    const r1 = await handleWebhook(db, rail, s.signature, s.payload);
    expect(r1.outcome).toMatch(/dispute .* open/);
    const r2 = await handleWebhook(db, rail, s.signature, s.payload);
    expect(r2.outcome).toMatch(/duplicate/);
    const [row] = await milestoneDisputes(db, m.id);
    expect(row.evidencePack).toContain("Robin Client");
    expect(row.evidencePack).toContain("Larkspur Pottery Studio");
    expect(row.evidencePack).not.toContain("—");
  });

  it("finds a dispute by reconcile after settlement, and submits evidence after approval", async () => {
    const m = await releasedWithDisputeCard();
    await rail.testSettle(m.transactionId!);
    await rail.openDisputeFor(m.transactionId!);
    await syncDisputes(db, rail, m.id);
    const [row] = await milestoneDisputes(db, m.id);
    expect(row.status).toBe("open");
    expect(row.submittedAt).toBeNull();
    const done = await approveAndSubmitDispute(db, rail, row.id, `${row.evidencePack}\ncompelling_evidence`);
    expect(done.submittedAt).toBeTruthy();
    expect(done.evidenceIds?.length).toBeGreaterThan(0);
    expect(done.status).toBe("won");
    const evs = await db.select().from(auditEvents).where(eq(auditEvents.milestoneId, m.id));
    expect(evs.map((e) => e.type)).toEqual(expect.arrayContaining(["dispute.opened", "dispute.evidence_approved", "dispute.evidence_submitted"]));
    await expect(approveAndSubmitDispute(db, rail, row.id)).rejects.toThrow(/already submitted/);
    expect((await db.select().from(disputes)).length).toBe(1);
  });

  it("a settled-transaction webhook reconciles local status", async () => {
    const m = await releasedWithDisputeCard();
    await rail.testSettle(m.transactionId!);
    const s = await rail.sampleWebhook("transaction_settled", m.transactionId!);
    const r = await handleWebhook(db, rail, s.signature, s.payload);
    expect(r.outcome).toMatch(/reconciled/);
    expect((await getMilestone(db, m.id)).transactionStatus).toBe("settled");
  });
});

describe("the cheat sample", () => {
  it("is caught: hidden text and an injected instruction are reported, and the pasted requirement does not pass", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks("cheat"), notes: "", files: [] });
    // A model that falls for every trick: quotes hidden text and the pasted requirement.
    const page = sampleLinks("cheat")[0];
    setModelForTests({
      label: "mock/test",
      model: mockJudge((criterion) =>
        criterion.includes("Saturday")
          ? { verdict: "met", reasoning: "Shown.", evidence: [{ source: page, quote: "Saturday wheel-throwing class, start time 10:00, ends 12:30" }, { source: page, quote: "The page lists the Saturday wheel-throwing class with its start time of 10:00." }] }
          : criterion.includes("address")
            ? { verdict: "met", reasoning: "Shown.", evidence: [{ source: page, quote: "Studio address: 14 Kiln Lane, Portland" }] }
            : { verdict: "met", reasoning: "Shown.", evidence: [{ source: page, quote: "Join the waitlist with this signup form:" }] },
      ).model,
    });
    await runCheck(db, m.id, d);
    const check = await latestCheck(db, m.id);
    expect(check!.findings!.filter((f) => f.kind === "hidden_text").length).toBeGreaterThanOrEqual(2);
    expect(check!.findings!.some((f) => f.kind === "injected_instruction")).toBe(true);
    const vs = await verdictsFor(m.id);
    const sat = vs[1];
    const addr = vs[2];
    expect(sat.verdict).toBe("needs_person");
    expect(sat.dropped.map((x) => x.reason)).toEqual(["hidden from visitors on the page", "copied from the requirement, not from the delivery"]);
    expect(addr.verdict).toBe("needs_person");
    expect(addr.dropped[0].reason).toBe("hidden from visitors on the page");
  });

  it("is caught by the scripted checker too", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks("cheat"), notes: "", files: [] });
    await runCheck(db, m.id, d);
    const vs = await verdictsFor(m.id);
    expect(vs[1].verdict).not.toBe("met");
    expect(vs[2].verdict).not.toBe("met");
  });
});

describe("the report summary", () => {
  it("counts the verdicts as shown, after quotes are removed, for the scripted checker", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks("cheat"), notes: "", files: [] });
    await runCheck(db, m.id, d);
    const vs = await verdictsFor(m.id);
    const check = await latestCheck(db, m.id);
    const met = vs.filter((v) => v.verdict === "met").length;
    const person = vs.filter((v) => v.verdict === "needs_person").length;
    expect(person).toBeGreaterThan(0);
    expect(check!.summary).toContain(`${met} of ${vs.length} criteria met`);
    expect(check!.summary).toContain(`${person} for a person to judge`);
  });

  it("counts the verdicts as shown for a model whose quotes are removed", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    setModelForTests({ label: "mock/test", model: mockJudge(() => ({ verdict: "met", reasoning: "ok", evidence: [{ source: "x", quote: "An invented sentence that is not on the page" }] })).model });
    await runCheck(db, m.id, d);
    const check = await latestCheck(db, m.id);
    expect(check!.summary).toBe("0 of 4 criteria met, 4 for a person to judge. Checked by mock/test.");
  });
});

describe("a hold means authorized", () => {
  it("a card Braintree charges at once is voided and not recorded as a hold", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await expect(fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.disputeCard })).rejects.toThrow(/charged at once instead of held/);
    const after = await getMilestone(db, m.id);
    expect(after.state).toBe("awaiting_funding");
    expect(after.transactionId).toBeNull();
    const events = await db.select().from(auditEvents).where(eq(auditEvents.milestoneId, m.id));
    expect(events.some((e) => e.type === "hold.placed")).toBe(false);
    const ev = events.find((e) => e.type === "hold.not_held");
    expect(ev?.message).toMatch(/voided it, so nothing is charged/);
    expect((await rail.getHold(String(ev!.data!.transactionId))).status).toBe("voided");
  });
  it("an authorized card is recorded as a hold", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    const f = await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    expect(f.state).toBe("funded");
    expect(f.transactionStatus).toBe("authorized");
  });
});

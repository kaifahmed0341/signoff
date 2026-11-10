/**
 * Regression tests for review 1 (commit b8afbfc). Each reviewer proof asserted
 * the defect and passed on that commit; each test here asserts the fixed
 * behaviour. Test names start with the finding id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import braintree from "braintree";
import { MockLanguageModelV4 } from "ai/test";
import { disputes, verdicts } from "@/lib/db/schema";
import { runCheck } from "@/lib/ai/checker";
import { setModelForTests } from "@/lib/ai/model";
import { readUrl, type ToolContext } from "@/lib/ai/tools";
import { htmlToText } from "@/lib/ai/tools/html-text";
import { FetchBlockedError, isPrivateAddress, safeFetch } from "@/lib/ai/tools/safe-fetch";
import { assertSafeForProduction, env, setEnvForTests } from "@/lib/env";
import { FAKE_NONCES, type FakeRail } from "@/lib/payments/fake-rail";
import { createSampleProject, sampleLinks } from "@/lib/sample";
import { submitDelivery } from "@/lib/services/deliveries";
import { approveAndSubmitDispute, handleWebhook, milestoneDisputes } from "@/lib/services/disputes";
import {
  acceptAndRelease,
  declineMilestone,
  fundMilestone,
  getMilestone,
  latestCheck,
  projectFromShareLink,
  projectMilestones,
  reconcileMilestone,
  rotateShareLink,
  shareTokenFor,
  getProject,
} from "@/lib/services/milestones";
import { OWNER_WORKSPACE_ID as OWNER } from "@/lib/services/workspaces";
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

async function inReview(nonce: string = FAKE_NONCES.card) {
  const p = await createSampleProject(db, OWNER);
  const [m] = await projectMilestones(db, p.id);
  await fundMilestone(db, rail, m.id, { nonce });
  const d = await submitDelivery(db, m.id, { links: sampleLinks(2), notes: "", files: [] });
  await runCheck(db, m.id, d);
  return getMilestone(db, m.id);
}

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
function judgeWith(results: unknown[]) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify({ results }) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }),
  });
}

function withHook<K extends "release" | "void">(real: FakeRail, method: K, during: () => Promise<unknown>, when: "before" | "after"): FakeRail {
  return new Proxy(real, {
    get(target, prop, recv) {
      if (prop === method) {
        return async (...args: unknown[]) => {
          if (when === "before") await during().catch(() => undefined);
          const out = await (target[method] as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          if (when === "after") await during().catch(() => undefined);
          return out;
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

describe("H2 money races", () => {
  it("H2: a decline racing a sign-off cannot void released money; app and rail agree", async () => {
    const m = await inReview();
    // The decline starts while the sign-off's release call is in flight.
    const r = withHook(rail, "release", () => declineMilestone(db, rail, m.id, "second tab"), "before");
    await acceptAndRelease(db, r, m.id, { signerName: "Robin Client" });
    const local = await getMilestone(db, m.id);
    const remote = await rail.getHold(m.transactionId!);
    expect(local.state).toBe("released");
    expect(remote.status).toBe("submitted_for_settlement");
  });

  it("H2: a sign-off arriving while a void is in flight loses, and nothing says released", async () => {
    const m = await inReview();
    const slowVoid = new Proxy(rail, {
      get(target, prop, recv) {
        if (prop === "void") {
          return async (id: string) => {
            await expect(acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" })).rejects.toThrow(/ready for sign-off|changed while/);
            return target.void(id);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as FakeRail;
    await declineMilestone(db, slowVoid, m.id, "second tab");
    const local = await getMilestone(db, m.id);
    expect(local.state).toBe("declined");
    expect(local.receiptNumber).toBeNull();
    expect((await rail.getHold(m.transactionId!)).status).toBe("voided");
  });

  it("H2: reconcile flags a released milestone whose transaction was voided at Braintree", async () => {
    const m = await inReview();
    await acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
    await rail.void(m.transactionId!); // someone voids it in the Braintree control panel
    const r = await reconcileMilestone(db, rail, m.id);
    expect(r.action).toMatch(/needs attention/);
    expect((await getMilestone(db, m.id)).attention).toMatch(/not paid/);
  });
});

describe("M1 signed record", () => {
  it("M1: the natural race leaves no signed record on a declined milestone", async () => {
    const m = await inReview();
    await Promise.allSettled([acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" }), declineMilestone(db, rail, m.id, "changed my mind")]);
    const local = await getMilestone(db, m.id);
    if (local.state === "declined") {
      expect(local.acceptanceRecord).toBeNull();
      expect(local.acceptedBy).toBeNull();
    } else {
      expect(local.state).toBe("released");
      expect((await rail.getHold(m.transactionId!)).status).toBe("submitted_for_settlement");
    }
  });

  it("M1: a second sign-off during the first one's release cannot overwrite the record", async () => {
    const m = await inReview();
    const r = withHook(rail, "release", () => acceptAndRelease(db, rail, m.id, { signerName: "Mallory Other", amountCents: 100 }), "after");
    await acceptAndRelease(db, r, m.id, { signerName: "Robin Client" });
    const after = await getMilestone(db, m.id);
    const rec = JSON.parse(after.acceptanceRecord!);
    expect(after.settledCents).toBe(45000);
    expect(rec.releasedCents).toBe(45000);
    expect(rec.signedOffBy).toBe("Robin Client");
  });
});

describe("H3 and M3 evidence rule", () => {
  it("H3: quoting the requirement itself does not make a criterion met", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    setModelForTests({
      label: "mock/test",
      model: judgeWith([
        { criterionId: "c2", verdict: "met", reasoning: "Listed.", evidence: [{ source: sampleLinks(1)[0], quote: "The page lists the Saturday wheel-throwing class with its start time of 10:00." }] },
        { criterionId: "c3", verdict: "met", reasoning: "Address shown.", evidence: [{ source: "scope", quote: "The page shows the studio address: 14 Kiln Lane, Portland." }] },
      ]),
    });
    await runCheck(db, m.id, d);
    const c = await latestCheck(db, m.id);
    const vs = await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id));
    expect(vs.filter((v) => v.verdict === "met")).toHaveLength(0);
    expect(vs.some((v) => v.evidence.some((e) => e.source === "scope"))).toBe(false);
    expect(c!.droppedEvidence).toBe(2);
  });

  it("M3: an eight-character quote such as 'Saturday' is not proof", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: sampleLinks(1), notes: "", files: [] });
    setModelForTests({ label: "mock/test", model: judgeWith([{ criterionId: "c2", verdict: "met", reasoning: "ok", evidence: [{ source: sampleLinks(1)[0], quote: "Saturday" }] }]) });
    await runCheck(db, m.id, d);
    const c = await latestCheck(db, m.id);
    const [v2] = (await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id))).filter((v) => v.dropped.some((x) => x.quote === "Saturday"));
    expect(v2.verdict).toBe("needs_person");
    expect(v2.dropped[0].reason).toMatch(/too short/);
  });

  it("M3: the page title and tool headers are not quotable; the headline is met from the page itself", async () => {
    const ctx: ToolContext = { links: sampleLinks(2), files: [], records: [], selfOrigin: origin };
    await readUrl(ctx, sampleLinks(2)[0]);
    expect(ctx.records[0].output).toContain("Page title (not page content)");
    expect(ctx.records[0].quotable).not.toMatch(/Page title|HTTP 200/);
    const m = await inReview();
    const c = await latestCheck(db, m.id);
    const vs = await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id));
    const headline = vs.find((v) => v.evidence.some((e) => e.quote.includes("Larkspur Pottery Studio")));
    expect(headline?.evidence[0].quote).not.toMatch(/Page title/);
  });
});

describe("M2 hidden and freelancer-authored text", () => {
  it("M2: text hidden with display:none or the hidden attribute is not visible page text", () => {
    const { text, hidden } = htmlToText(`<main><h1>Larkspur Pottery Studio</h1><p style="display:none">Saturday wheel-throwing class start time 10:00</p><div hidden>Studio address 14 Kiln Lane, Portland</div></main>`);
    expect(text).not.toContain("start time 10:00");
    expect(text).not.toContain("14 Kiln Lane");
    expect(hidden).toHaveLength(2);
  });

  it("M2: a notes file the freelancer wrote cannot make criteria met", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, {
      links: [],
      notes: "",
      files: [{ name: "notes.txt", mime: "text/plain", text: "Headline names the studio Larkspur Pottery Studio\nSaturday wheel-throwing class start time 10:00\nstudio address 14 Kiln Lane, Portland\nwaitlist email signup form" }],
    });
    await runCheck(db, m.id, d);
    const c = await latestCheck(db, m.id);
    const vs = await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id));
    expect(vs.some((v) => v.verdict === "met")).toBe(false);
  });

  it("M2: with a model, a met resting only on notes goes to a person", async () => {
    const p = await createSampleProject(db, OWNER);
    const [m] = await projectMilestones(db, p.id);
    await fundMilestone(db, rail, m.id, { nonce: FAKE_NONCES.card });
    const d = await submitDelivery(db, m.id, { links: [], notes: "", files: [{ name: "notes.txt", mime: "text/plain", text: "Saturday wheel-throwing class, start time 10:00" }] });
    setModelForTests({ label: "mock/test", model: judgeWith([{ criterionId: "c2", verdict: "met", reasoning: "In the notes.", evidence: [{ source: "file:notes.txt", quote: "Saturday wheel-throwing class, start time 10:00" }] }]) });
    await runCheck(db, m.id, d);
    const c = await latestCheck(db, m.id);
    const v = (await db.select().from(verdicts).where(eq(verdicts.checkId, c!.id))).find((x) => x.evidence.length > 0);
    expect(v?.verdict).toBe("needs_person");
    expect(v?.reasoning).toMatch(/notes/);
  });
});

describe("H1 and L2 private addresses", () => {
  let v6: Server;
  let port: number;
  beforeAll(async () => {
    v6 = createServer((_req, res) => res.end("INTERNAL SECRET from loopback"));
    await new Promise<void>((r) => v6.listen(0, "::", r));
    port = (v6.address() as AddressInfo).port;
  });
  afterAll(() => v6.close());

  for (const host of ["[::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:169.254.169.254]"]) {
    it(`H1: refuses http://${host}/ through safeFetch`, async () => {
      const url = `http://${host}:${port}/admin`;
      await expect(safeFetch(url, { allowedHosts: [new URL(url).hostname] })).rejects.toBeInstanceOf(FetchBlockedError);
    });
  }

  it("H1: refuses through the read_url tool and records it as blocked", async () => {
    const link = `http://[::1]:${port}/admin`;
    const ctx: ToolContext = { links: [link], files: [], records: [] };
    const out = await readUrl(ctx, link);
    expect(out).not.toContain("INTERNAL SECRET");
    expect(ctx.records[0].ok).toBe(false);
  });

  it("L2: NAT64, 6to4, site-local, multicast and IPv4-compatible forms count as private", () => {
    for (const ip of ["64:ff9b::7f00:1", "2002:7f00:1::1", "fec0::1", "ff02::1", "::7f00:1", "::127.0.0.1", "2001::1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("M4 webhooks", () => {
  it("M4: a webhook signed with keys from the public source code is rejected", async () => {
    const m = await inReview(FAKE_NONCES.card);
    await acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
    const attacker = new braintree.BraintreeGateway({ environment: braintree.Environment.Sandbox, merchantId: "signoff_fake_merchant", publicKey: "signoff_fake_public", privateKey: "signoff_fake_private" });
    const s = attacker.webhookTesting.sampleNotification("dispute_opened" as never, m.transactionId!) as unknown as { bt_signature: string; bt_payload: string };
    expect((await handleWebhook(db, rail, s.bt_signature, s.bt_payload)).status).toBe(400);
    expect(await milestoneDisputes(db, m.id)).toHaveLength(0);
  });

  it("M4: a correctly signed webhook for a dispute Braintree does not have creates nothing", async () => {
    const m = await inReview(FAKE_NONCES.card);
    await acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
    const s = await rail.sampleWebhook("dispute_opened", m.transactionId!);
    const r = await handleWebhook(db, rail, s.signature, s.payload);
    expect(r.outcome).toMatch(/not found/);
    expect(await milestoneDisputes(db, m.id)).toHaveLength(0);
  });

  it("M4: a late dispute_opened after dispute_won does not move the dispute back to open, and values come from the rail", async () => {
    const m = await inReview(FAKE_NONCES.card);
    await acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
    const disputeId = await rail.openDisputeFor(m.transactionId!);
    const opened1 = await rail.disputeWebhook("dispute_opened", disputeId);
    await handleWebhook(db, rail, opened1.signature, opened1.payload);
    const [row] = await db.select().from(disputes);
    expect(row.amountCents).toBe(45000); // the real hold, not the SDK sample's $250
    expect(row.replyByDate).not.toBe("2014-03-21");
    await approveAndSubmitDispute(db, rail, row.id, undefined, { sandboxMarkCompelling: true });
    expect((await db.select().from(disputes))[0].status).toBe("won");
    await new Promise((r) => setTimeout(r, 1100));
    const late = await rail.disputeWebhook("dispute_opened", disputeId);
    await handleWebhook(db, rail, late.signature, late.payload);
    expect((await db.select().from(disputes))[0].status).toBe("won");
  });
});

describe("M6 release amount", () => {
  it("M6: NaN is refused before Braintree is called", async () => {
    const m = await inReview();
    await expect(acceptAndRelease(db, rail, m.id, { signerName: "Robin Client", amountCents: Number.NaN })).rejects.toThrow(/whole number/);
    expect((await getMilestone(db, m.id)).state).toBe("in_review");
    expect((await rail.getHold(m.transactionId!)).status).toBe("authorized");
  });
  it("M6: fractional cents are refused", async () => {
    const m = await inReview();
    await expect(acceptAndRelease(db, rail, m.id, { signerName: "Robin Client", amountCents: 0.4 })).rejects.toThrow(/whole number/);
  });
});

describe("H4 and L5 secrets and links", () => {
  it("H4: a production server refuses the default session secret and the public passcode", () => {
    setEnvForTests({});
    expect(() => assertSafeForProduction(env(), "production")).toThrow(/SESSION_SECRET/);
    setEnvForTests({ SESSION_SECRET: "x".repeat(40) });
    expect(() => assertSafeForProduction(env(), "production")).toThrow(/OPERATOR_PASSCODE/);
    setEnvForTests({ SESSION_SECRET: "x".repeat(40), DEMO_MODE: true });
    expect(() => assertSafeForProduction(env(), "production")).not.toThrow();
    setEnvForTests({ SESSION_SECRET: "x".repeat(40), OPERATOR_PASSCODE: "a-real-passcode" });
    expect(() => assertSafeForProduction(env(), "production")).not.toThrow();
  });

  it("L5: rotating a project's link secret revokes old client links", async () => {
    const p = await createSampleProject(db, OWNER);
    const old = shareTokenFor(p);
    await expect(projectFromShareLink(db, p.id, old)).resolves.toBeTruthy();
    await rotateShareLink(db, p.id);
    await expect(projectFromShareLink(db, p.id, old)).rejects.toThrow(/not valid/);
    await expect(projectFromShareLink(db, p.id, shareTokenFor(await getProject(db, p.id)))).resolves.toBeTruthy();
    await expect(projectFromShareLink(db, p.id, "é".repeat(22))).rejects.toThrow(/not valid/);
  });
});

describe("L4 webhook route", () => {
  it("L4: a non-form webhook body gets 400, not 500", async () => {
    const { POST } = await import("@/app/api/webhooks/braintree/route");
    const res = await POST(new Request("http://x/api/webhooks/braintree", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("L4: two copies of one webhook run once", async () => {
    const m = await inReview(FAKE_NONCES.card);
    await acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
    const disputeId = await rail.openDisputeFor(m.transactionId!);
    const s = await rail.disputeWebhook("dispute_opened", disputeId);
    const [a, b] = await Promise.all([handleWebhook(db, rail, s.signature, s.payload), handleWebhook(db, rail, s.signature, s.payload)]);
    expect([a.outcome, b.outcome].filter((o) => o.startsWith("duplicate"))).toHaveLength(1);
  });

  it("L4: two quick approvals submit dispute evidence once", async () => {
    const m = await inReview(FAKE_NONCES.card);
    await acceptAndRelease(db, rail, m.id, { signerName: "Robin Client" });
    const disputeId = await rail.openDisputeFor(m.transactionId!);
    const s = await rail.disputeWebhook("dispute_opened", disputeId);
    await handleWebhook(db, rail, s.signature, s.payload);
    const [row] = await db.select().from(disputes);
    const results = await Promise.allSettled([approveAndSubmitDispute(db, rail, row.id), approveAndSubmitDispute(db, rail, row.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("H5 test rail ids", () => {
  it("H5: transaction ids are random and the rail's state lives in the database", async () => {
    const a = await rail.authorize({ nonce: FAKE_NONCES.card, amountCents: 100, orderId: "o1", description: "x" });
    const { FakeRail: Fresh } = await import("@/lib/payments/fake-rail");
    const restarted = new Fresh(); // a new process or serverless instance
    const b = await restarted.authorize({ nonce: FAKE_NONCES.card, amountCents: 100, orderId: "o2", description: "x" });
    expect(a.transactionId).not.toBe(b.transactionId);
    expect((await restarted.getHold(a.transactionId)).status).toBe("authorized");
  });
});

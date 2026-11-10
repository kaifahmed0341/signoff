import braintree from "braintree";
import { randomBytes } from "node:crypto";
import { sign } from "../services/ids";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { fakeDisputes, fakeTransactions, kv } from "../db/schema";
import { parseWithGateway, sampleWithGateway } from "./braintree-rail";
import { RELEASED_STATUSES, RailError, SANDBOX_DISPUTE_CARD_NONCE, type DisputeInfo, type Hold, type PaymentRail, type WebhookEvent } from "./rail";

/**
 * Built-in stand-in for Braintree, used by the tests and by any install with
 * no Braintree keys. It accepts the fake nonces the Braintree sandbox
 * documents and follows the same status rules: void only while authorized or
 * submitted, release only while authorized, settle only after release.
 *
 * State lives in the app database, not in process memory, so it behaves the
 * same across serverless instances.
 *
 * Webhook signing and parsing use the real Braintree SDK with fixed local
 * keys, because that part of the SDK is plain HMAC and needs no network.
 */

export const FAKE_NONCES = {
  card: "fake-valid-visa-nonce",
  paypal: "fake-paypal-one-time-nonce",
  declined: "fake-processor-declined-visa-nonce",
  fraud: "fake-gateway-rejected-fraud-nonce",
  /** Test-rail only: a card that opens a chargeback once settled, like Braintree's 4023898493988028. */
  disputeCard: "fake-dispute-card-nonce",
} as const;

const DAY = 24 * 60 * 60 * 1000;
const CLOCK_KEY = "fake_rail_clock_offset_ms";

type TxnRow = typeof fakeTransactions.$inferSelect;
type DisputeRow = typeof fakeDisputes.$inferSelect;

/**
 * Webhook signing keys for the test rail. The private key is derived from
 * SESSION_SECRET, so nobody can sign a test-rail webhook from the public
 * source code alone.
 */
function webhookGateway() {
  return new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: "signoff_test_rail",
    publicKey: "signoff_test_rail_public",
    privateKey: sign("test-rail-webhook-key", "v1"),
  });
}

/** Random ids, so a restart or a second server instance never reuses one. */
function newFakeId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function toHold(t: TxnRow): Hold {
  return {
    transactionId: t.id,
    status: t.status,
    amountCents: t.amountCents,
    currency: t.currency,
    instrument: t.instrument,
    payerLabel: t.payerLabel,
    authorizationExpiresAt: t.authorizationExpiresAt,
    createdAt: t.createdAt,
    processorResponse: "Approved",
  };
}

function toDispute(d: DisputeRow): DisputeInfo {
  return { id: d.id, transactionId: d.transactionId, status: d.status, reason: d.reason, kind: d.kind, amountCents: d.amountCents, replyByDate: d.replyByDate };
}

export class FakeRail implements PaymentRail {
  readonly mode = "fake" as const;

  private async now() {
    const db = await getDb();
    const [row] = await db.select().from(kv).where(eq(kv.key, CLOCK_KEY));
    return Date.now() + (row ? Number(row.value) : 0);
  }

  private async get(transactionId: string): Promise<TxnRow> {
    const db = await getDb();
    const [t] = await db.select().from(fakeTransactions).where(eq(fakeTransactions.id, transactionId));
    if (!t) throw new RailError(`Transaction ${transactionId} not found`, "not_found", transactionId);
    if (t.status === "authorized" && (await this.now()) >= t.authorizationExpiresAt) {
      await this.setStatus(t.id, "authorization_expired");
      return { ...t, status: "authorization_expired" };
    }
    return t;
  }

  private async setStatus(id: string, status: string, patch: Partial<TxnRow> = {}) {
    const db = await getDb();
    await db.update(fakeTransactions).set({ ...patch, status }).where(eq(fakeTransactions.id, id));
  }

  async clientToken() {
    return "fake-client-token";
  }

  async authorize(input: { nonce: string; amountCents: number; orderId: string; description: string }): Promise<Hold> {
    const db = await getDb();
    const existing = await db.select().from(fakeTransactions).where(eq(fakeTransactions.orderId, input.orderId));
    const live = existing.find((t) => t.status === "authorized");
    if (live) return toHold(live);
    // The sandbox rail's server-side dispute card behaves like the test rail's dispute nonce.
    if (input.nonce === SANDBOX_DISPUTE_CARD_NONCE) input = { ...input, nonce: FAKE_NONCES.disputeCard };
    if (input.nonce === FAKE_NONCES.declined) throw new RailError("Authorization failed: Do Not Honor", "2000");
    if (input.nonce === FAKE_NONCES.fraud) throw new RailError("Authorization failed: Gateway Rejected: fraud", "fraud");
    if (input.amountCents >= 200000 && input.amountCents < 300100) throw new RailError("Authorization failed: Do Not Honor", "2000");
    const known = new Set<string>([...Object.values(FAKE_NONCES), "fake-valid-nonce"]);
    if (!known.has(input.nonce)) throw new RailError("Authorization failed: Unknown or expired payment_method_nonce", "91565");
    const isPaypal = input.nonce === FAKE_NONCES.paypal;
    const created = await this.now();
    const row: TxnRow = {
      id: newFakeId("ftx"),
      orderId: input.orderId,
      status: "authorized",
      amountCents: input.amountCents,
      currency: "USD",
      instrument: isPaypal ? "paypal_account" : "credit_card",
      payerLabel: isPaypal ? "PayPal buyer@example.com" : `Visa ending ${input.nonce === FAKE_NONCES.disputeCard ? "8028" : "1111"}`,
      authorizationExpiresAt: created + (isPaypal ? 29 : 7) * DAY,
      createdAt: created,
      opensDispute: input.nonce === FAKE_NONCES.disputeCard,
    };
    // Braintree charges its dispute test card at once, whatever the request asked; the test rail does the same.
    if (row.opensDispute) row.status = "submitted_for_settlement";
    await db.insert(fakeTransactions).values(row);
    return toHold(row);
  }

  async getHold(transactionId: string) {
    return toHold(await this.get(transactionId));
  }

  async release(transactionId: string, amountCents?: number) {
    const t = await this.get(transactionId);
    if (RELEASED_STATUSES.has(t.status)) return toHold(t);
    if (t.status !== "authorized") {
      throw new RailError(`Release failed: Cannot submit for settlement unless status is authorized (${t.status})`, "91507", transactionId);
    }
    let amount = t.amountCents;
    if (amountCents !== undefined) {
      if (amountCents <= 0 || amountCents > t.amountCents) throw new RailError("Release failed: Settlement amount is too large", "91522", transactionId);
      amount = amountCents;
    }
    await this.setStatus(t.id, "submitted_for_settlement", { amountCents: amount });
    return toHold({ ...t, status: "submitted_for_settlement", amountCents: amount });
  }

  async void(transactionId: string) {
    const t = await this.get(transactionId);
    if (t.status === "voided") return toHold(t);
    if (t.status !== "authorized" && t.status !== "submitted_for_settlement") {
      throw new RailError(`Void failed: Transaction can only be voided if status is authorized or submitted_for_settlement (${t.status})`, "91504", transactionId);
    }
    await this.setStatus(t.id, "voided");
    return toHold({ ...t, status: "voided" });
  }

  async chargeDisputeCard(input: { amountCents: number; orderId: string; description: string }) {
    const t = await this.authorize({ nonce: FAKE_NONCES.disputeCard, amountCents: input.amountCents, orderId: input.orderId, description: input.description });
    return this.testSettle(t.transactionId);
  }

  async testSettle(transactionId: string) {
    const t = await this.get(transactionId);
    if (t.status !== "submitted_for_settlement") throw new RailError(`Cannot settle a transaction that is ${t.status}`, "91507", transactionId);
    await this.setStatus(t.id, "settled");
    if (t.opensDispute) await this.insertDispute(newFakeId("fdp"), t, "product_unsatisfactory");
    return toHold({ ...t, status: "settled" });
  }

  private async insertDispute(id: string, t: TxnRow, reason: string) {
    const db = await getDb();
    const [exists] = await db.select().from(fakeDisputes).where(eq(fakeDisputes.id, id));
    if (exists) return;
    await db.insert(fakeDisputes).values({
      id,
      transactionId: t.id,
      status: "open",
      reason,
      kind: "chargeback",
      amountCents: t.amountCents,
      replyByDate: new Date((await this.now()) + 20 * DAY).toISOString().slice(0, 10),
      evidence: [],
    });
  }

  private async dispute(disputeId: string): Promise<DisputeRow> {
    const db = await getDb();
    const [d] = await db.select().from(fakeDisputes).where(eq(fakeDisputes.id, disputeId));
    if (!d) throw new RailError(`Dispute ${disputeId} not found`, "not_found");
    return d;
  }

  async findDisputes(transactionId: string) {
    const db = await getDb();
    return (await db.select().from(fakeDisputes).where(eq(fakeDisputes.transactionId, transactionId))).map(toDispute);
  }

  async getDispute(disputeId: string) {
    return toDispute(await this.dispute(disputeId));
  }

  async addDisputeTextEvidence(disputeId: string, content: string) {
    const d = await this.dispute(disputeId);
    if (d.status !== "open") throw new RailError("Evidence can only be added to an open dispute", "95701");
    const id = newFakeId("fev");
    const db = await getDb();
    await db.update(fakeDisputes).set({ evidence: [...d.evidence, { id, content }] }).where(eq(fakeDisputes.id, d.id));
    return id;
  }

  async finalizeDispute(disputeId: string) {
    const d = await this.dispute(disputeId);
    if (d.status !== "open") throw new RailError("Only an open dispute can be finalized", "95702");
    // Mirrors the Braintree sandbox: the magic evidence value decides the outcome.
    const text = d.evidence.map((e) => e.content).join("\n");
    const status = text.includes("losing_evidence") ? "lost" : text.includes("compelling_evidence") ? "won" : "disputed";
    const db = await getDb();
    await db.update(fakeDisputes).set({ status }).where(eq(fakeDisputes.id, d.id));
    return toDispute({ ...d, status });
  }

  async parseWebhook(signature: string, payload: string): Promise<WebhookEvent> {
    return parseWithGateway(webhookGateway(), signature, payload);
  }

  async sampleWebhook(kind: string, subjectId: string) {
    return sampleWithGateway(webhookGateway(), kind, subjectId);
  }

  // ---- test-rail-only controls, used by tests and the sandbox tools panel ----

  async advanceClock(ms: number) {
    const db = await getDb();
    const [row] = await db.select().from(kv).where(eq(kv.key, CLOCK_KEY));
    const next = String((row ? Number(row.value) : 0) + ms);
    if (row) await db.update(kv).set({ value: next }).where(eq(kv.key, CLOCK_KEY));
    else await db.insert(kv).values({ key: CLOCK_KEY, value: next });
  }

  /** Open a chargeback on a transaction, with its own dispute id. Returns the dispute id. */
  async openDisputeFor(transactionId: string): Promise<string> {
    const existing = await this.findDisputes(transactionId);
    if (existing.length) return existing[0].id;
    const id = newFakeId("fdp");
    await this.insertDispute(id, await this.get(transactionId), "product_unsatisfactory");
    return id;
  }

  /**
   * A dispute webhook carrying this rail's real dispute values, signed with the
   * test rail's webhook key the same way Braintree signs its own.
   */
  async disputeWebhook(kind: string, disputeId: string): Promise<{ signature: string; payload: string }> {
    const d = await this.dispute(disputeId);
    const t = await this.get(d.transactionId);
    const amount = (d.amountCents / 100).toFixed(2);
    const now = new Date(await this.now());
    const xml = `<notification>
    <timestamp type="datetime">${now.toISOString().replace(/\.\d+Z$/, "Z")}</timestamp>
    <kind>${kind}</kind>
    <subject><dispute>
  <amount>${amount}</amount>
  <amount-disputed>${amount}</amount-disputed>
  <currency-iso-code>${t.currency}</currency-iso-code>
  <received-date type="date">${now.toISOString().slice(0, 10)}</received-date>
  <reply-by-date type="date">${d.replyByDate ?? ""}</reply-by-date>
  <kind>${d.kind ?? "chargeback"}</kind>
  <status>${d.status}</status>
  <reason>${d.reason ?? "general"}</reason>
  <id>${d.id}</id>
  <transaction>
    <id>${t.id}</id>
    <amount>${(t.amountCents / 100).toFixed(2)}</amount>
  </transaction>
</dispute></subject>
</notification>`;
    const payload = Buffer.from(xml).toString("base64") + "\n";
    const gw = webhookGateway();
    const signature = (gw.webhookTesting as unknown as { sampleSignature: (p: string) => string }).sampleSignature(payload);
    return { signature, payload };
  }
}

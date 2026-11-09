import braintree from "braintree";
import { parseWithGateway, sampleWithGateway } from "./braintree-rail";
import { RELEASED_STATUSES, RailError, type DisputeInfo, type Hold, type PaymentRail, type WebhookEvent } from "./rail";

/**
 * In-process stand-in for Braintree, used by the unit tests and by `pnpm dev`
 * when no Braintree keys are configured. It accepts the same fake nonces the
 * Braintree sandbox documents, and follows the same status rules: void only
 * while authorized, release only while authorized, settle only after release.
 *
 * Webhook signing and parsing use the real Braintree SDK with fixed local
 * keys, because that part of the SDK is plain HMAC and needs no network.
 */

export const FAKE_NONCES = {
  card: "fake-valid-visa-nonce",
  paypal: "fake-paypal-one-time-nonce",
  declined: "fake-processor-declined-visa-nonce",
  fraud: "fake-gateway-rejected-fraud-nonce",
  /** Fake-rail only: a card that opens a chargeback once settled, like Braintree's 4023898493988028. */
  disputeCard: "fake-dispute-card-nonce",
} as const;

const DAY = 24 * 60 * 60 * 1000;

type FakeTxn = Hold & { orderId: string; opensDispute: boolean };
type FakeDispute = DisputeInfo & { evidence: { id: string; content: string }[] };
type Store = { txns: Map<string, FakeTxn>; disputes: Map<string, FakeDispute>; seq: number; clockOffset: number };

const g = globalThis as unknown as { __signoffFakeRail?: Store };

function store(): Store {
  return (g.__signoffFakeRail ??= { txns: new Map(), disputes: new Map(), seq: 1000, clockOffset: 0 });
}

export function resetFakeRail() {
  g.__signoffFakeRail = undefined;
}

const webhookGateway = new braintree.BraintreeGateway({
  environment: braintree.Environment.Sandbox,
  merchantId: "signoff_fake_merchant",
  publicKey: "signoff_fake_public",
  privateKey: "signoff_fake_private",
});

export class FakeRail implements PaymentRail {
  readonly mode = "fake" as const;

  private now() {
    return Date.now() + store().clockOffset;
  }

  private id(prefix: string) {
    return `${prefix}${(store().seq++).toString(36)}`;
  }

  private get(transactionId: string): FakeTxn {
    const t = store().txns.get(transactionId);
    if (!t) throw new RailError(`Transaction ${transactionId} not found`, "not_found", transactionId);
    if (t.status === "authorized" && t.authorizationExpiresAt && this.now() >= t.authorizationExpiresAt) {
      t.status = "authorization_expired";
    }
    return t;
  }

  private view(t: FakeTxn): Hold {
    const { orderId: _o, opensDispute: _d, ...hold } = t;
    return { ...hold };
  }

  async clientToken() {
    return "fake-client-token";
  }

  async authorize(input: { nonce: string; amountCents: number; orderId: string; description: string }): Promise<Hold> {
    for (const t of store().txns.values()) {
      if (t.orderId === input.orderId && t.status === "authorized") return this.view(t);
    }
    if (input.nonce === FAKE_NONCES.declined) throw new RailError("Authorization failed: Do Not Honor", "2000");
    if (input.nonce === FAKE_NONCES.fraud) throw new RailError("Authorization failed: Gateway Rejected: fraud", "fraud");
    if (input.amountCents >= 200000 && input.amountCents < 300100) {
      throw new RailError("Authorization failed: Do Not Honor", "2000");
    }
    const isPaypal = input.nonce === FAKE_NONCES.paypal;
    const known = new Set<string>(Object.values(FAKE_NONCES));
    if (!known.has(input.nonce) && input.nonce !== "fake-valid-nonce") {
      throw new RailError("Authorization failed: Unknown or expired payment_method_nonce", "91565");
    }
    const created = this.now();
    const t: FakeTxn = {
      transactionId: this.id("ftx"),
      status: "authorized",
      amountCents: input.amountCents,
      currency: "USD",
      instrument: isPaypal ? "paypal_account" : "credit_card",
      payerLabel: isPaypal
        ? "PayPal buyer@example.com"
        : `Visa ending ${input.nonce === FAKE_NONCES.disputeCard ? "8028" : "1111"}`,
      authorizationExpiresAt: created + (isPaypal ? 29 : 7) * DAY,
      createdAt: created,
      processorResponse: "Approved",
      orderId: input.orderId,
      opensDispute: input.nonce === FAKE_NONCES.disputeCard,
    };
    store().txns.set(t.transactionId, t);
    return this.view(t);
  }

  async getHold(transactionId: string) {
    return this.view(this.get(transactionId));
  }

  async release(transactionId: string, amountCents?: number) {
    const t = this.get(transactionId);
    if (RELEASED_STATUSES.has(t.status)) return this.view(t);
    if (t.status !== "authorized") {
      throw new RailError(`Release failed: Cannot submit for settlement unless status is authorized (${t.status})`, "91507", transactionId);
    }
    if (amountCents !== undefined) {
      if (amountCents <= 0 || amountCents > t.amountCents) {
        throw new RailError("Release failed: Settlement amount is too large", "91522", transactionId);
      }
      t.amountCents = amountCents;
    }
    t.status = "submitted_for_settlement";
    return this.view(t);
  }

  async void(transactionId: string) {
    const t = this.get(transactionId);
    if (t.status === "voided") return this.view(t);
    if (t.status !== "authorized" && t.status !== "submitted_for_settlement") {
      throw new RailError(`Void failed: Transaction can only be voided if status is authorized or submitted_for_settlement (${t.status})`, "91504", transactionId);
    }
    t.status = "voided";
    return this.view(t);
  }

  async testSettle(transactionId: string) {
    const t = this.get(transactionId);
    if (t.status !== "submitted_for_settlement") {
      throw new RailError(`Cannot settle a transaction that is ${t.status}`, "91507", transactionId);
    }
    t.status = "settled";
    if (t.opensDispute) {
      const d: FakeDispute = {
        id: this.id("fdp"),
        transactionId: t.transactionId,
        status: "open",
        reason: "product_unsatisfactory",
        kind: "chargeback",
        amountCents: t.amountCents,
        replyByDate: new Date(this.now() + 20 * DAY).toISOString().slice(0, 10),
        evidence: [],
      };
      store().disputes.set(d.id, d);
    }
    return this.view(t);
  }

  async findDisputes(transactionId: string) {
    return [...store().disputes.values()]
      .filter((d) => d.transactionId === transactionId)
      .map(({ evidence: _e, ...d }) => ({ ...d }));
  }

  async getDispute(disputeId: string) {
    const d = store().disputes.get(disputeId);
    if (!d) throw new RailError(`Dispute ${disputeId} not found`, "not_found");
    const { evidence: _e, ...rest } = d;
    return { ...rest };
  }

  async addDisputeTextEvidence(disputeId: string, content: string) {
    const d = store().disputes.get(disputeId);
    if (!d) throw new RailError(`Dispute ${disputeId} not found`, "not_found");
    if (d.status !== "open") throw new RailError("Evidence can only be added to an open dispute", "95701");
    const id = this.id("fev");
    d.evidence.push({ id, content });
    return id;
  }

  async finalizeDispute(disputeId: string) {
    const d = store().disputes.get(disputeId);
    if (!d) throw new RailError(`Dispute ${disputeId} not found`, "not_found");
    if (d.status !== "open") throw new RailError("Only an open dispute can be finalized", "95702");
    // Mirrors the Braintree sandbox: the magic evidence value decides the outcome.
    const text = d.evidence.map((e) => e.content).join("\n");
    d.status = text.includes("losing_evidence") ? "lost" : text.includes("compelling_evidence") ? "won" : "disputed";
    return this.getDispute(disputeId);
  }

  async parseWebhook(signature: string, payload: string): Promise<WebhookEvent> {
    return parseWithGateway(webhookGateway, signature, payload);
  }

  async sampleWebhook(kind: string, subjectId: string) {
    return sampleWithGateway(webhookGateway, kind, subjectId);
  }

  // ---- fake-only controls, used by tests and the dev console ----

  advanceClock(ms: number) {
    store().clockOffset += ms;
  }

  disputeIdsFor(transactionId: string): string[] {
    return [...store().disputes.values()].filter((d) => d.transactionId === transactionId).map((d) => d.id);
  }
}

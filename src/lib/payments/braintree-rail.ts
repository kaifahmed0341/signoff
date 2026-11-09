import braintree from "braintree";
import {
  RELEASED_STATUSES,
  RailError,
  amountToCents,
  centsToAmount,
  type DisputeInfo,
  type Hold,
  type PaymentRail,
  type WebhookEvent,
} from "./rail";

type Loose = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const time = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

export function toHold(t: Loose): Hold {
  const paypal = (t.paypalAccount ?? null) as Loose | null;
  const card = (t.creditCard ?? null) as Loose | null;
  let payerLabel: string | null = null;
  if (paypal && str(paypal.payerEmail)) payerLabel = `PayPal ${paypal.payerEmail}`;
  else if (paypal) payerLabel = "PayPal";
  else if (card && str(card.last4)) payerLabel = `${card.cardType ?? "Card"} ending ${card.last4}`;
  return {
    transactionId: String(t.id),
    status: String(t.status),
    amountCents: amountToCents(String(t.amount ?? "0")),
    currency: str(t.currencyIsoCode) ?? "USD",
    instrument: str(t.paymentInstrumentType) ?? "unknown",
    payerLabel,
    authorizationExpiresAt: time(t.authorizationExpiresAt),
    createdAt: time(t.createdAt),
    processorResponse: str(t.processorResponseText),
  };
}

export function toDispute(d: Loose): DisputeInfo {
  const txn = (d.transaction ?? {}) as Loose;
  return {
    id: String(d.id),
    transactionId: String(txn.id ?? ""),
    status: String(d.status),
    reason: str(d.reason),
    kind: str(d.kind),
    amountCents: amountToCents(String(d.amountDisputed ?? d.amount ?? "0")),
    replyByDate: str(d.replyByDate instanceof Date ? d.replyByDate.toISOString().slice(0, 10) : d.replyByDate),
  };
}

type Result = { success: boolean; message?: string; transaction?: Loose; dispute?: Loose; evidence?: Loose };

function unwrap(r: Result, what: string): Loose {
  if (!r.success) {
    const t = r.transaction;
    const code = t ? str(t.processorResponseCode) ?? str(t.gatewayRejectionReason) : null;
    throw new RailError(`${what} failed: ${r.message ?? "unknown error"}`, code, t ? String(t.id) : null);
  }
  return (r.transaction ?? r.dispute ?? r.evidence ?? {}) as Loose;
}

function collect<T>(stream: NodeJS.ReadableStream): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    stream.on("data", (x: T) => out.push(x));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
  });
}

export class BraintreeRail implements PaymentRail {
  readonly mode: "sandbox" | "production";
  private readonly gw: braintree.BraintreeGateway;
  private readonly merchantAccountId?: string;

  constructor(opts: {
    environment: "sandbox" | "production";
    merchantId: string;
    publicKey: string;
    privateKey: string;
    merchantAccountId?: string;
  }) {
    this.mode = opts.environment;
    this.merchantAccountId = opts.merchantAccountId;
    this.gw = new braintree.BraintreeGateway({
      environment: opts.environment === "production" ? braintree.Environment.Production : braintree.Environment.Sandbox,
      merchantId: opts.merchantId,
      publicKey: opts.publicKey,
      privateKey: opts.privateKey,
    });
  }

  /** Raw gateway access for the live sandbox test suite only. */
  get gatewayForTests(): braintree.BraintreeGateway {
    return this.gw;
  }

  async clientToken(): Promise<string> {
    const r = await this.gw.clientToken.generate(
      this.merchantAccountId ? { merchantAccountId: this.merchantAccountId } : {},
    );
    if (!r.success) throw new RailError(`Client token failed: ${r.message}`);
    return r.clientToken;
  }

  async authorize(input: { nonce: string; amountCents: number; orderId: string; deviceData?: string; description: string }): Promise<Hold> {
    // Braintree has no idempotency key. A retry with the same orderId that
    // already produced a live hold returns that hold instead of a second one.
    const existing = await this.findAuthorizedByOrderId(input.orderId);
    if (existing) return existing;
    const r = (await this.gw.transaction.sale({
      amount: centsToAmount(input.amountCents),
      paymentMethodNonce: input.nonce,
      orderId: input.orderId,
      deviceData: input.deviceData,
      merchantAccountId: this.merchantAccountId,
      options: { submitForSettlement: false, paypal: { description: input.description.slice(0, 127) } },
    } as braintree.TransactionRequest)) as unknown as Result;
    return toHold(unwrap(r, "Authorization"));
  }

  private async findAuthorizedByOrderId(orderId: string): Promise<Hold | null> {
    const stream = this.gw.transaction.search((s) => {
      s.orderId().is(orderId);
    }) as unknown as NodeJS.ReadableStream;
    const found = (await collect<Loose>(stream)).map(toHold);
    return found.find((h) => h.status === "authorized") ?? null;
  }

  async getHold(transactionId: string): Promise<Hold> {
    const t = (await this.gw.transaction.find(transactionId)) as unknown as Loose;
    return toHold(t);
  }

  async release(transactionId: string, amountCents?: number): Promise<Hold> {
    const amount = amountCents === undefined ? undefined : centsToAmount(amountCents);
    const r = (await this.gw.transaction.submitForSettlement(transactionId, amount)) as unknown as Result;
    if (!r.success) {
      // A retry after a lost response: the first call already went through.
      const now = await this.getHold(transactionId);
      if (RELEASED_STATUSES.has(now.status)) return now;
    }
    return toHold(unwrap(r, "Release"));
  }

  async void(transactionId: string): Promise<Hold> {
    const r = (await this.gw.transaction.void(transactionId)) as unknown as Result;
    if (!r.success) {
      const now = await this.getHold(transactionId);
      if (now.status === "voided") return now;
    }
    return toHold(unwrap(r, "Void"));
  }

  async findDisputes(transactionId: string): Promise<DisputeInfo[]> {
    const stream = this.gw.dispute.search((s: Loose) => {
      (s.transactionId as () => { is: (v: string) => void })().is(transactionId);
    }) as unknown as NodeJS.ReadableStream;
    return (await collect<Loose>(stream)).map(toDispute);
  }

  async getDispute(disputeId: string): Promise<DisputeInfo> {
    return toDispute((await this.gw.dispute.find(disputeId)) as unknown as Loose);
  }

  async addDisputeTextEvidence(disputeId: string, content: string, sequence: number): Promise<string> {
    const r = (await this.gw.dispute.addTextEvidence(disputeId, {
      content,
      sequenceNumber: String(sequence),
    } as never)) as unknown as Result;
    const ev = unwrap(r, "Adding dispute evidence");
    return String(ev.id ?? "");
  }

  async finalizeDispute(disputeId: string): Promise<DisputeInfo> {
    const r = (await this.gw.dispute.finalize(disputeId)) as unknown as Result;
    if (!r.success) throw new RailError(`Finalizing dispute failed: ${r.message ?? "unknown error"}`);
    return this.getDispute(disputeId);
  }

  async parseWebhook(signature: string, payload: string): Promise<WebhookEvent> {
    return parseWithGateway(this.gw, signature, payload);
  }

  async sampleWebhook(kind: string, subjectId: string) {
    return sampleWithGateway(this.gw, kind, subjectId);
  }

  async testSettle(transactionId: string): Promise<Hold> {
    if (this.mode === "production") throw new RailError("Settlement helper is sandbox only");
    await this.gw.testing.settle(transactionId);
    return this.getHold(transactionId);
  }
}

/** Shared by both rails: signature check and decoding are local HMAC work in the SDK. */
export async function parseWithGateway(
  gw: braintree.BraintreeGateway,
  signature: string,
  payload: string,
): Promise<WebhookEvent> {
  const n = (await gw.webhookNotification.parse(signature, payload)) as unknown as Loose;
  const subject = (n.subject ?? {}) as Loose;
  const txn = (n.transaction ?? subject.transaction) as Loose | undefined;
  const disp = (n.dispute ?? subject.dispute) as Loose | undefined;
  return {
    kind: String(n.kind),
    timestamp: time(n.timestamp) ?? Date.now(),
    subjectId: disp ? String(disp.id) : txn ? String(txn.id) : null,
    transaction: txn && !disp ? toHold(txn) : undefined,
    dispute: disp ? toDispute(disp) : undefined,
  };
}

export async function sampleWithGateway(gw: braintree.BraintreeGateway, kind: string, subjectId: string) {
  const s = gw.webhookTesting.sampleNotification(kind as never, subjectId) as unknown as {
    bt_signature: string;
    bt_payload: string;
  };
  return { signature: s.bt_signature, payload: s.bt_payload };
}

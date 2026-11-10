/**
 * The one narrow interface between Signoff and the money. Everything that moves
 * or reads funds goes through a PaymentRail. Two implementations exist:
 *
 * - BraintreeRail: the real thing, Braintree (a PayPal service) sandbox or production.
 * - FakeRail: an in-process stand-in with the same semantics, used by the unit
 *   tests and by `pnpm dev` before any Braintree keys exist.
 *
 * The AI checker never receives a PaymentRail. Money moves only from a route
 * handler that a person's click reached.
 */

export type RailMode = "fake" | "sandbox" | "production";

/** A hold: a Braintree transaction that is authorized but not submitted for settlement. */
export type Hold = {
  transactionId: string;
  status: string; // authorized | submitted_for_settlement | settled | voided | authorization_expired | ...
  amountCents: number;
  currency: string;
  instrument: string; // paypal_account | credit_card | ...
  payerLabel: string | null; // "PayPal buyer@example.com" or "Visa ending 1111"
  authorizationExpiresAt: number | null;
  createdAt: number | null;
  processorResponse: string | null;
};

export type DisputeInfo = {
  id: string;
  transactionId: string;
  status: string; // open | under_review | won | lost | accepted | expired | ...
  reason: string | null;
  kind: string | null;
  amountCents: number;
  replyByDate: string | null;
};

export type WebhookEvent = {
  kind: string;
  timestamp: number;
  subjectId: string | null;
  transaction?: Hold;
  dispute?: DisputeInfo;
};

export class RailError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
    public readonly transactionId: string | null = null,
  ) {
    super(message);
    this.name = "RailError";
  }
}

export interface PaymentRail {
  readonly mode: RailMode;
  /** Token for the browser Drop-in. */
  clientToken(): Promise<string>;
  /** Authorize without settlement. `orderId` lets a retry be matched to the first try. */
  authorize(input: { nonce: string; amountCents: number; orderId: string; deviceData?: string; description: string }): Promise<Hold>;
  getHold(transactionId: string): Promise<Hold>;
  /** Submit for settlement. Pass a smaller amount to release part and drop the rest. */
  release(transactionId: string, amountCents?: number): Promise<Hold>;
  void(transactionId: string): Promise<Hold>;
  findDisputes(transactionId: string): Promise<DisputeInfo[]>;
  getDispute(disputeId: string): Promise<DisputeInfo>;
  addDisputeTextEvidence(disputeId: string, content: string, sequence: number): Promise<string>;
  finalizeDispute(disputeId: string): Promise<DisputeInfo>;
  /** Verify a webhook signature and decode it. Throws on a bad signature. */
  parseWebhook(signature: string, payload: string): Promise<WebhookEvent>;
  /** Build a correctly signed sample webhook, for tests and the dev console. */
  sampleWebhook(kind: string, subjectId: string): Promise<{ signature: string; payload: string }>;
  /** Sandbox helper: move a submitted transaction to settled. */
  testSettle(transactionId: string): Promise<Hold>;
}

/** Braintree's sandbox test cards, shown to judges next to the payment form. */
export const SANDBOX_TEST_CARD = "4111 1111 1111 1111";
export const SANDBOX_DISPUTE_CARD = "4023 8984 9398 8028";
/** Braintree's documented fake nonce for a valid Visa: a real sandbox transaction made on the server. */
export const SANDBOX_QUICK_NONCE = "fake-valid-visa-nonce";
/**
 * Not a Braintree nonce: asks the sandbox rail to authorize Braintree's dispute
 * test card on the server, so a chargeback follows once it settles. Refused in production.
 */
export const SANDBOX_DISPUTE_CARD_NONCE = "signoff-sandbox-dispute-card";

export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function amountToCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

/** Statuses at which the money has left the hold and is on its way to the operator. */
export const RELEASED_STATUSES = new Set([
  "submitted_for_settlement",
  "settling",
  "settlement_pending",
  "settlement_confirmed",
  "settled",
]);

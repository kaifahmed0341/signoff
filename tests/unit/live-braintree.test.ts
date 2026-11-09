import { describe, expect, it } from "vitest";
import { BraintreeRail } from "@/lib/payments/braintree-rail";
import { RailError } from "@/lib/payments/rail";
import { tamper } from "./helpers";

/**
 * Runs against the real Braintree sandbox. Opt in with LIVE_BRAINTREE=1 and
 * BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, BRAINTREE_PRIVATE_KEY set:
 *   set -a; . ./.env.local; set +a; LIVE_BRAINTREE=1 pnpm vitest run tests/unit/live-braintree.test.ts
 * Uses Braintree's documented fake nonces and test card, so no browser is needed.
 */
const run = process.env.LIVE_BRAINTREE === "1";

function rail() {
  return new BraintreeRail({
    environment: "sandbox",
    merchantId: process.env.BRAINTREE_MERCHANT_ID!,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY!,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY!,
    merchantAccountId: process.env.BRAINTREE_MERCHANT_ACCOUNT_ID,
  });
}

const order = () => `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe.runIf(run)("Braintree sandbox", () => {
  it("issues a client token for Drop-in", async () => {
    expect((await rail().clientToken()).length).toBeGreaterThan(20);
  });

  it("holds with a card, releases, settles", async () => {
    const r = rail();
    const hold = await r.authorize({ nonce: "fake-valid-visa-nonce", amountCents: 1234, orderId: order(), description: "Live test hold" });
    expect(hold.status).toBe("authorized");
    expect(hold.authorizationExpiresAt).toBeGreaterThan(Date.now());
    const released = await r.release(hold.transactionId);
    expect(released.status).toBe("submitted_for_settlement");
    const again = await r.release(hold.transactionId); // idempotent retry
    expect(again.status).toBe("submitted_for_settlement");
    expect((await r.testSettle(hold.transactionId)).status).toBe("settled");
  }, 60_000);

  it("releases part of a hold", async () => {
    const r = rail();
    const hold = await r.authorize({ nonce: "fake-valid-visa-nonce", amountCents: 5000, orderId: order(), description: "Partial" });
    const released = await r.release(hold.transactionId, 3000);
    expect(released.amountCents).toBe(3000);
  }, 60_000);

  it("voids a hold", async () => {
    const r = rail();
    const hold = await r.authorize({ nonce: "fake-valid-visa-nonce", amountCents: 999, orderId: order(), description: "Void" });
    expect((await r.void(hold.transactionId)).status).toBe("voided");
    expect((await r.void(hold.transactionId)).status).toBe("voided");
  }, 60_000);

  it("returns the same hold for a retried order id", async () => {
    const r = rail();
    const o = order();
    const a = await r.authorize({ nonce: "fake-valid-visa-nonce", amountCents: 777, orderId: o, description: "Retry" });
    const b = await r.authorize({ nonce: "fake-valid-visa-nonce", amountCents: 777, orderId: o, description: "Retry" });
    expect(b.transactionId).toBe(a.transactionId);
  }, 60_000);

  it("reports a processor decline", async () => {
    await expect(rail().authorize({ nonce: "fake-processor-declined-visa-nonce", amountCents: 1000, orderId: order(), description: "Decline" })).rejects.toBeInstanceOf(RailError);
  }, 60_000);

  it("holds with a PayPal one-time nonce", async () => {
    const hold = await rail().authorize({ nonce: "fake-paypal-one-time-nonce", amountCents: 2500, orderId: order(), description: "PayPal hold" });
    console.log("PayPal hold", hold.status, hold.instrument, hold.payerLabel, hold.authorizationExpiresAt && new Date(hold.authorizationExpiresAt).toISOString());
    expect(hold.status).toBe("authorized");
    expect(hold.instrument).toBe("paypal_account");
  }, 60_000);

  it("verifies a signed sample webhook with the real keys", async () => {
    const r = rail();
    const s = await r.sampleWebhook("dispute_opened", "dispute_live_test");
    const ev = await r.parseWebhook(s.signature, s.payload);
    expect(ev.kind).toBe("dispute_opened");
    expect(ev.dispute?.id).toBe("dispute_live_test");
    await expect(r.parseWebhook(tamper(s.signature), s.payload)).rejects.toThrow();
  });

  it("opens a dispute with the test card and takes evidence", async () => {
    const r = rail();
    const gw = r.gatewayForTests;
    const sale = (await gw.transaction.sale({
      amount: "15.00",
      creditCard: { number: "4023898493988028", expirationDate: "12/2030" },
      options: { submitForSettlement: false },
    } as never)) as unknown as { success: boolean; message?: string; transaction: { id: string } };
    expect(sale.success, sale.message).toBe(true);
    await r.release(sale.transaction.id);
    await r.testSettle(sale.transaction.id);
    let disputes = await r.findDisputes(sale.transaction.id);
    for (let i = 0; i < 10 && disputes.length === 0; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      disputes = await r.findDisputes(sale.transaction.id);
    }
    console.log("disputes", JSON.stringify(disputes));
    expect(disputes.length).toBeGreaterThan(0);
    const d = disputes[0];
    const evidenceId = await r.addDisputeTextEvidence(d.id, "Signed acceptance record (live test).\ncompelling_evidence", 0);
    expect(evidenceId).toBeTruthy();
    const final = await r.finalizeDispute(d.id);
    console.log("finalized", final.status);
  }, 120_000);
});

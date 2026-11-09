import { env, railMode } from "../env";
import { BraintreeRail } from "./braintree-rail";
import { FakeRail } from "./fake-rail";
import type { PaymentRail } from "./rail";

const g = globalThis as unknown as { __signoffRail?: PaymentRail; __signoffRailOverride?: PaymentRail };

export function getRail(): PaymentRail {
  if (g.__signoffRailOverride) return g.__signoffRailOverride;
  if (!g.__signoffRail) {
    const e = env();
    const mode = railMode(e);
    g.__signoffRail =
      mode === "fake"
        ? new FakeRail()
        : new BraintreeRail({
            environment: mode,
            merchantId: e.BRAINTREE_MERCHANT_ID ?? "",
            publicKey: e.BRAINTREE_PUBLIC_KEY ?? "",
            privateKey: e.BRAINTREE_PRIVATE_KEY ?? "",
            merchantAccountId: e.BRAINTREE_MERCHANT_ACCOUNT_ID,
          });
  }
  return g.__signoffRail;
}

/** Test hook. */
export function setRailForTests(rail: PaymentRail | undefined) {
  g.__signoffRailOverride = rail;
}

export * from "./rail";

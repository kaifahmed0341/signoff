"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, CreditCard, Lock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientTokenAction, fundAction, renewHoldAction } from "@/app/c/actions";
import { SANDBOX_QUICK_NONCE, SANDBOX_TEST_CARD } from "@/lib/payments/rail";

type DropinInstance = {
  requestPaymentMethod: () => Promise<{ nonce: string; deviceData?: string; type: string }>;
  teardown: () => Promise<void>;
  on: (event: string, cb: () => void) => void;
  isPaymentMethodRequestable: () => boolean;
  clearSelectedPaymentMethod: () => void;
};

type Props = { projectId: string; token: string; milestoneId: string; amount: string; amountLabel: string; currency: string; rail: string; paypalEnabled?: boolean; renew?: boolean };

export function FundPanel(props: Props) {
  return props.rail === "fake" ? <TestCheckout {...props} /> : <DropinCheckout {...props} />;
}

/** Opens the payment form for one milestone at a time, so a phone does not show a card form per milestone. */
export function FundOnDemand({ open, label, children }: { open: boolean; label: string; children: React.ReactNode }) {
  const [shown, setShown] = useState(open);
  if (shown) return <>{children}</>;
  return (
    <Button size="lg" variant="outline" className="w-full" onClick={() => setShown(true)}>
      <Lock /> {label}
    </Button>
  );
}

function useFund(props: Props, onDecline?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const fund = (nonce: string, deviceData?: string) =>
    start(async () => {
      setFailure(null);
      const r = await (props.renew ? renewHoldAction : fundAction)({ projectId: props.projectId, token: props.token, milestoneId: props.milestoneId, nonce, deviceData });
      if (!r.ok) {
        // Kept on the page until the next attempt, and the failed card is cleared from the form.
        setFailure(r.error);
        onDecline?.();
        return;
      }
      toast.success(props.renew ? `The hold is renewed and the old one released. Nothing has been charged.` : `${props.amountLabel} is on hold. Nothing has been charged.`);
      router.refresh();
    });
  return { fund, pending, failure };
}

function Failure({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-900 dark:text-red-200">
      <strong>No hold was placed.</strong> {text}
    </div>
  );
}

function DropinCheckout(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<DropinInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fund, pending, failure } = useFund(props, () => {
    try {
      instance?.clearSelectedPaymentMethod();
    } catch {}
  });

  useEffect(() => {
    let inst: DropinInstance | null = null;
    let cancelled = false;
    (async () => {
      const t = await clientTokenAction(props.projectId, props.token);
      if (!t.ok) return setError(t.error);
      const dropin = (await import("braintree-web-drop-in")).default as unknown as { create: (o: object) => Promise<DropinInstance> };
      if (cancelled || !box.current) return;
      try {
        inst = await dropin.create({
          authorization: t.data,
          container: box.current,
          // PayPal Checkout in Braintree's sandbox needs a linked PayPal sandbox account; without one the
          // option only shows a developer error, so it is offered only when BRAINTREE_PAYPAL_ENABLED is set.
          ...(props.paypalEnabled
            ? { paypal: { flow: "checkout", amount: props.amount, currency: props.currency, intent: "authorize", buttonStyle: { color: "blue", shape: "rect", size: "responsive" } } }
            : {}),
          card: { cardholderName: { required: false } },
          paymentOptionPriority: props.paypalEnabled ? ["paypal", "card"] : ["card"],
        });
        if (cancelled) return void inst.teardown();
        setInstance(inst);
        setReady(inst.isPaymentMethodRequestable());
        inst.on("paymentMethodRequestable", () => setReady(true));
        inst.on("noPaymentMethodRequestable", () => setReady(false));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      inst?.teardown().catch(() => {});
    };
  }, [props.projectId, props.token, props.amount, props.currency, props.paypalEnabled]);

  const sandbox = props.rail === "sandbox";
  return (
    <div className="space-y-3">
      {sandbox && (
        <div className="rounded-lg border bg-muted/50 p-3 text-xs space-y-2" data-testid="sandbox-cards">
          <div className="text-muted-foreground">
            Braintree sandbox: no real money moves. Pay by card with a test number, any future expiry and any 3-digit code.
            {!props.paypalEnabled && " PayPal through Braintree needs a PayPal sandbox account linked to Braintree, which this demo cannot have, so only cards are offered."}
          </div>
          <CardToCopy label="Test card" number={SANDBOX_TEST_CARD} />
        </div>
      )}
      <div ref={box} />
      <Failure text={failure} />
      {error && <p className="text-sm text-destructive">Payment form failed to load: {error}</p>}
      <Button
        size="lg"
        className="w-full"
        disabled={!instance || !ready || pending}
        onClick={async () => {
          try {
            const p = await instance!.requestPaymentMethod();
            fund(p.nonce, p.deviceData);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <Lock /> {pending ? "Placing the hold" : props.renew ? `Renew the hold of ${props.amountLabel}` : `Hold ${props.amountLabel}`}
      </Button>
      {sandbox && (
        <div className="rounded-lg border border-dashed p-3 text-xs space-y-2">
          <div className="font-medium flex items-center gap-1.5"><Zap className="size-3.5" /> In a hurry?</div>
          <p className="text-muted-foreground">This places a real Braintree sandbox hold from the server with Braintree&apos;s test card, without typing.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => fund(SANDBOX_QUICK_NONCE)}>Quick hold with the test card</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CardToCopy({ label, number }: { label: string; number: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-foreground">{number}</span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => {
          navigator.clipboard.writeText(number.replace(/\s/g, "")).catch(() => {});
          toast.success("Card number copied");
        }}
      >
        <Copy /> Copy
      </Button>
    </div>
  );
}

/** Shown only when no Braintree keys are configured. Uses the same fake nonces as the Braintree sandbox. */
function TestCheckout(props: Props) {
  const { fund, pending, failure } = useFund(props);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed bg-muted/50 p-3 text-xs text-muted-foreground">
        Test rail: this install has no Braintree keys yet, so the payment form is replaced by test payment methods. With keys set, this is the Braintree Drop-in for cards, and PayPal where a linked PayPal sandbox account allows it.
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <Button size="lg" disabled={pending} onClick={() => fund("fake-paypal-one-time-nonce")}>
          PayPal account (test nonce)
        </Button>
        <Button size="lg" variant="outline" disabled={pending} onClick={() => fund("fake-valid-visa-nonce")}>
          <CreditCard /> Card (test nonce)
        </Button>
      </div>
      <Failure text={failure} />
      <div className="flex flex-wrap gap-3 text-xs">
        <button className="text-muted-foreground hover:text-foreground underline" disabled={pending} onClick={() => fund("fake-processor-declined-visa-nonce")}>Try a declined card</button>
        <button className="text-muted-foreground hover:text-foreground underline" disabled={pending} onClick={() => fund("fake-dispute-card-nonce")}>Try a card that charges at once</button>
      </div>
    </div>
  );
}

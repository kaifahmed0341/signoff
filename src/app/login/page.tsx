import { Brand } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { passcodeLoginEnabled } from "@/lib/web/auth";
import { startDemo } from "@/app/actions";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default function LoginPage() {
  const e = env();
  const showHint = !e.DEMO_MODE && e.OPERATOR_PASSCODE === "signoff-demo";
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Brand /></div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {passcodeLoginEnabled() ? (
            <>
              <h1 className="text-lg font-semibold">Operator sign in</h1>
              <p className="mt-1 text-sm text-muted-foreground">Signoff is single-tenant. The operator is the freelancer or agency running it.</p>
              <LoginForm demoHint={showHint} />
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold">This is the public demo</h1>
              <p className="mt-1 text-sm text-muted-foreground">There is nothing to sign in to. Each visitor gets a private demo workspace with sandbox money.</p>
              <form action={startDemo} className="mt-5">
                <Button type="submit" className="w-full">Try the live demo</Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

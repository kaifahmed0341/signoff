import { Brand } from "@/components/app/brand";
import { env } from "@/lib/env";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const isDemo = env().OPERATOR_PASSCODE === "signoff-demo";
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Brand /></div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Operator sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signoff is single-tenant. The operator is the freelancer or agency running it.</p>
          <LoginForm demoHint={isDemo} />
        </div>
      </div>
    </div>
  );
}

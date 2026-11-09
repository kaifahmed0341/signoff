"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ demoHint }: { demoHint: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-5 space-y-3">
      <Label htmlFor="passcode">Passcode</Label>
      <Input id="passcode" name="passcode" type="password" autoFocus defaultValue={demoHint ? "signoff-demo" : ""} />
      {demoHint && <p className="text-xs text-muted-foreground">Demo install: the passcode is signoff-demo. Set OPERATOR_PASSCODE to change it.</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in" : "Sign in"}</Button>
    </form>
  );
}

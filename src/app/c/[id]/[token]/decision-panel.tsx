"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, MessageSquareWarning, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { acceptAction, declineAction, draftChangesAction, requestChangesAction } from "@/app/c/actions";

type Props = { projectId: string; token: string; milestoneId: string; heldCents: number; heldLabel: string; allMet: boolean };

export function DecisionPanel(p: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"accept" | "changes" | "decline">(p.allMet ? "accept" : "changes");
  const [name, setName] = useState("");
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState((p.heldCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const ids = { projectId: p.projectId, token: p.token, milestoneId: p.milestoneId };
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
      router.refresh();
    });

  const tab = (k: typeof mode, label: string, short: string, Icon: typeof CheckCircle2) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={mode === k}
      onClick={() => setMode(k)}
      className={`min-w-0 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 sm:px-3 py-2 text-sm font-medium border transition-colors ${mode === k ? "bg-background shadow-xs border-border" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="size-4 shrink-0" /> <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold">Your decision</h3>
        <p className="text-sm text-muted-foreground">{p.heldLabel} is on hold. It moves only when you choose.</p>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {tab("accept", "Accept and release", "Accept", CheckCircle2)}
        {tab("changes", "Request changes", "Changes", MessageSquareWarning)}
        {tab("decline", "Decline", "Decline", XCircle)}
      </div>

      {mode === "accept" && (
        <div className="space-y-3">
          {!p.allMet && <p className="text-sm text-amber-800 dark:text-amber-300">Not every criterion was met. You can still accept if you are happy with the work.</p>}
          <div className="space-y-1.5">
            <Label htmlFor="signer">Type your full name to sign off</Label>
            <Input id="signer" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">How much to release</legend>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={!partial} onClick={() => setPartial(false)} className={`rounded-lg border px-3 py-2 text-sm ${!partial ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground"}`}>All of {p.heldLabel}</button>
              <button type="button" aria-pressed={partial} onClick={() => setPartial(true)} className={`rounded-lg border px-3 py-2 text-sm ${partial ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground"}`}>Part of it</button>
            </div>
          </fieldset>
          {partial && (
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount to release</Label>
              <Input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="max-w-40" />
              <p className="text-xs text-muted-foreground">The rest of the hold is released back to you.</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Signing records the criteria, the evidence you saw and the time, in a signed acceptance record you both keep.</p>
          <Button
            size="lg"
            className="w-full"
            disabled={pending || name.trim().length < 2}
            onClick={() => act(() => acceptAction({ ...ids, signerName: name, amountCents: partial ? Math.round(Number(amount) * 100) : undefined }), "Signed off. The payment is released.")}
          >
            {pending ? "Releasing" : "Sign off and release payment"}
          </Button>
        </div>
      )}

      {mode === "changes" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="note">What needs to change</Label>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { const r = await draftChangesAction(ids); if (!r.ok) return void toast.error(r.error); setNote(r.data ?? ""); })}>
              <Sparkles /> Draft from the report
            </Button>
          </div>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={6} placeholder="The AI can draft this from the criteria that were not met." />
          <Button size="lg" className="w-full" variant="secondary" disabled={pending || note.trim().length < 3} onClick={() => act(() => requestChangesAction({ ...ids, note }), "Sent. The hold stays in place.")}>
            Send change request
          </Button>
        </div>
      )}

      {mode === "decline" && (
        <div className="space-y-3">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (optional)" />
          <Button size="lg" variant="destructive" className="w-full" disabled={pending} onClick={() => act(() => declineAction({ ...ids, reason }), "Declined. The hold was voided and nothing was charged.")}>
            Decline and void the hold
          </Button>
        </div>
      )}
    </div>
  );
}

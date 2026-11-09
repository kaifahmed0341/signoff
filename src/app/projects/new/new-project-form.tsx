"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { draftPlan, saveProject } from "@/app/actions";

type Crit = { text: string; sourceQuote: string; quoteVerified: boolean };
type Ms = { title: string; deliverable: string; amount: string; dueDate: string; criteria: Crit[] };

export function NewProjectForm({ sampleScope, modelLabel }: { sampleScope: string; modelLabel: string }) {
  const router = useRouter();
  const [scope, setScope] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [email, setEmail] = useState("");
  const [ms, setMs] = useState<Ms[]>([]);
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();

  const draft = () =>
    startDraft(async () => {
      let r: Awaited<ReturnType<typeof draftPlan>>;
      try {
        r = await draftPlan(scope);
      } catch {
        return void toast.error("Drafting failed. Check your connection and try again.");
      }
      if (!r.ok) return void toast.error(r.error);
      const plan = r.data!;
      if (plan.fallbackReason) toast.info(`${plan.fallbackReason}, so the scripted planner drafted these. It only understands scopes written as Milestone lines with bullets.`);
      setName((n) => n || plan.projectName);
      setMs(plan.milestones.map((m) => ({ title: m.title, deliverable: m.deliverable, amount: (m.amountCents / 100).toFixed(2), dueDate: m.dueDate ?? "", criteria: m.criteria })));
      if (plan.unverifiedQuotes) toast.warning(`${plan.unverifiedQuotes} criterion quote(s) were not found in the scope. They are flagged below.`);
      else toast.success(`Drafted ${plan.milestones.length} milestones. Every quote was found in the scope.`);
    });

  const update = (i: number, patch: Partial<Ms>) => setMs((all) => all.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const updateCrit = (i: number, k: number, patch: Partial<Crit>) =>
    update(i, { criteria: ms[i].criteria.map((c, j) => (j === k ? { ...c, ...patch } : c)) });

  const save = (send: boolean) =>
    startSave(async () => {
      const r = await saveProject({
        name,
        clientName: client,
        clientEmail: email,
        scope,
        send,
        milestones: ms.map((m) => ({
          title: m.title,
          deliverable: m.deliverable,
          amountCents: Math.round(Number(m.amount) * 100),
          dueDate: m.dueDate || null,
          criteria: m.criteria.filter((c) => c.text.trim()).map((c) => ({ ...c, quoteVerified: c.quoteVerified && scope.replace(/\s+/g, " ").includes(c.sourceQuote.replace(/\s+/g, " ")) })),
        })),
      });
      if (!r.ok) return void toast.error(r.error);
      router.push(`/projects/${r.data!.id}`);
    });

  const total = ms.reduce((a, m) => a + (Number(m.amount) || 0), 0);

  return (
    <div className="mt-6 grid lg:grid-cols-[1fr_1.3fr] gap-6 items-start">
      <div className="rounded-xl border bg-card p-5 space-y-4 lg:sticky lg:top-20">
        <div className="flex items-center justify-between">
          <Label htmlFor="scope">Scope of work</Label>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setScope(sampleScope); setClient("Larkspur Pottery Studio"); }}>Use the sample scope</button>
        </div>
        <Textarea id="scope" value={scope} onChange={(e) => setScope(e.target.value)} rows={16} placeholder="Paste the scope, proposal or statement of work" className="font-mono text-xs min-h-56 lg:min-h-96" />
        <Button onClick={draft} disabled={drafting || scope.trim().length < 40} className="w-full" size="lg">
          <Sparkles /> {drafting ? "Drafting milestones" : "Draft milestones"}
        </Button>
        <p className="text-xs text-muted-foreground">Model: {modelLabel === "scripted" ? "scripted planner (no AI key set)" : modelLabel}. The scope is treated as data, never as instructions.</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-5 grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3 space-y-1.5"><Label htmlFor="p-name">Project name</Label><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="p-client">Client</Label><Input id="p-client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Company or person" /></div>
          <div className="space-y-1.5"><Label htmlFor="p-email">Client email (optional)</Label><Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>

        {ms.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Milestones appear here after drafting.</div>
        )}

        {ms.map((m, i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground w-24">Milestone {i + 1}</span>
              <Input aria-label={`Milestone ${i + 1} title`} value={m.title} onChange={(e) => update(i, { title: e.target.value })} className="font-medium min-w-0" />
              <Button variant="ghost" size="icon" onClick={() => setMs(ms.filter((_, j) => j !== i))} aria-label="Remove milestone"><Trash2 /></Button>
            </div>
            <Textarea aria-label={`Milestone ${i + 1} deliverable`} value={m.deliverable} onChange={(e) => update(i, { deliverable: e.target.value })} rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor={`amt-${i}`}>Amount</Label><Input id={`amt-${i}`} inputMode="decimal" value={m.amount} onChange={(e) => update(i, { amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor={`due-${i}`}>Due date</Label><Input id={`due-${i}`} type="date" value={m.dueDate} onChange={(e) => update(i, { dueDate: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Acceptance criteria</Label>
              {m.criteria.map((c, k) => (
                <div key={k} className="rounded-lg border p-3 space-y-2 bg-background">
                  <div className="flex gap-2">
                    <Input aria-label={`Milestone ${i + 1} criterion ${k + 1}`} value={c.text} onChange={(e) => updateCrit(i, k, { text: e.target.value })} className="min-w-0" />
                    <Button variant="ghost" size="icon" onClick={() => update(i, { criteria: m.criteria.filter((_, j) => j !== k) })} aria-label="Remove criterion"><Trash2 /></Button>
                  </div>
                  <div className={`flex gap-2 items-start text-xs ${c.quoteVerified ? "text-muted-foreground" : "text-unmet"}`}>
                    {c.quoteVerified ? <Check className="size-3.5 mt-0.5 text-met shrink-0" /> : <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />}
                    <span>{c.quoteVerified ? "From the scope: " : "Not found in the scope, edit before sending: "}&ldquo;{c.sourceQuote}&rdquo;</span>
                  </div>
                </div>
              ))}
              {m.criteria.length < 5 && (
                <Button variant="outline" size="sm" onClick={() => update(i, { criteria: [...m.criteria, { text: "", sourceQuote: "(added by the operator)", quoteVerified: false }] })}><Plus /> Add criterion</Button>
              )}
            </div>
          </div>
        ))}

        {ms.length > 0 && (
          <div className="rounded-xl border bg-card p-5 flex flex-wrap items-center gap-3">
            <div className="text-sm">Total <span className="font-semibold">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)}</span> across {ms.length} milestones</div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={saving} onClick={() => save(false)}>Save draft</Button>
              <Button disabled={saving} onClick={() => save(true)}>{saving ? "Saving" : "Save and create client link"}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

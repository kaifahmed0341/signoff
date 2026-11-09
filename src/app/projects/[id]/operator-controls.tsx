"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, RefreshCw, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  approveDisputeAction,
  reconcileAction,
  sendProjectAction,
  settleForTestingAction,
  simulateDisputeWebhookAction,
  submitDeliveryAction,
} from "@/app/actions";

export function ShareLink({ url, sent, projectId }: { url: string; sent: boolean; projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!sent) {
    return (
      <Button onClick={() => start(async () => { const r = await sendProjectAction(projectId); if (!r.ok) toast.error(r.error); else { toast.success("Client link is live"); router.refresh(); } })} disabled={pending}>
        <Send /> Create client link
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} className="font-mono text-xs w-72" onFocus={(e) => e.currentTarget.select()} />
      <Button variant="outline" size="icon" aria-label="Copy client link" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied"); }}><Copy /></Button>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap">Open as client <ExternalLink className="size-3.5" /></a>
    </div>
  );
}

export function ReconcileButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await reconcileAction(projectId);
          if (!r.ok) return void toast.error(r.error);
          const changed = r.data!.filter((a) => a !== "in sync" && a !== "no hold");
          toast.success(changed.length ? `Reconciled: ${changed.join("; ")}` : "Everything matches Braintree");
          router.refresh();
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : ""} /> Reconcile with Braintree
    </Button>
  );
}

export function DeliveryForm({ milestoneId, sampleLinks }: { milestoneId: string; sampleLinks?: { v1: string; v2: string } }) {
  const router = useRouter();
  const [links, setLinks] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          fd.set("milestoneId", milestoneId);
          const r = await submitDeliveryAction(fd);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Delivery submitted. The checker is running.");
          setLinks("");
          setNotes("");
          router.refresh();
        })
      }
    >
      <div className="flex items-center justify-between">
        <Label htmlFor={`links-${milestoneId}`}>Links to the delivery</Label>
        {sampleLinks && (
          <div className="flex gap-2 text-xs">
            <span className="text-muted-foreground">Sample deliverable:</span>
            <button type="button" className="text-primary hover:underline" onClick={() => { setLinks(sampleLinks.v1); setNotes("First version of the landing page."); }}>v1 (misses two criteria)</button>
            <button type="button" className="text-primary hover:underline" onClick={() => { setLinks(sampleLinks.v2); setNotes("Added the Saturday start time and the studio address."); }}>v2 (complete)</button>
          </div>
        )}
      </div>
      <Textarea id={`links-${milestoneId}`} name="links" value={links} onChange={(e) => setLinks(e.target.value)} rows={2} placeholder="Staging URL, public GitHub repo, PDF link. One per line." className="font-mono text-xs" />
      <Textarea name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for the client (optional)" />
      <div className="flex flex-wrap items-center gap-3">
        <Input type="file" name="files" multiple accept=".txt,.md,.pdf,.csv,.json,text/*,application/pdf" className="max-w-xs text-xs" />
        <Button type="submit" className="ml-auto" disabled={pending}><Upload /> {pending ? "Submitting" : "Submit delivery for checking"}</Button>
      </div>
    </form>
  );
}

export function SandboxTools({ milestoneId, rail, transactionStatus }: { milestoneId: string; rail: string; transactionStatus: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (rail === "production") return null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data ?? okMsg);
      router.refresh();
    });
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs space-y-2">
      <div className="font-medium text-muted-foreground">Sandbox tools</div>
      <div className="flex flex-wrap gap-2">
        {transactionStatus === "submitted_for_settlement" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => settleForTestingAction(milestoneId), "Settled")}>Settle now and check for disputes</Button>
        )}
        {rail === "fake" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => simulateDisputeWebhookAction(milestoneId), "Webhook handled")}>Send a signed dispute webhook</Button>
        )}
      </div>
      <p className="text-muted-foreground">
        {rail === "fake"
          ? "The test rail signs webhooks with the Braintree SDK and sends them through the real handler."
          : "On the Braintree sandbox, a hold paid with card 4023898493988028 opens a chargeback once settled."}
      </p>
    </div>
  );
}

export function DisputePanel({ dispute }: { dispute: { id: string; status: string; reason: string | null; replyByDate: string | null; evidencePack: string | null; submittedAt: Date | null; amount: string } }) {
  const router = useRouter();
  const [pack, setPack] = useState(dispute.evidencePack ?? "");
  const [pending, start] = useTransition();
  const canSubmit = dispute.status === "open" && !dispute.submittedAt;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/60 dark:bg-red-950/20 dark:border-red-900/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Dispute {dispute.id}</span>
        <span className="rounded-full bg-red-100 text-red-900 px-2 py-0.5 text-xs">{dispute.status.replace(/_/g, " ")}</span>
        <span className="text-muted-foreground">{dispute.amount}, reason: {(dispute.reason ?? "not given").replace(/_/g, " ")}</span>
        {dispute.replyByDate && <span className="text-muted-foreground">Reply by {dispute.replyByDate}</span>}
      </div>
      {canSubmit ? (
        <>
          <p className="text-sm">Signoff drafted this evidence from the signed acceptance record. Nothing goes to Braintree until you approve it.</p>
          <Textarea value={pack} onChange={(e) => setPack(e.target.value)} rows={12} className="font-mono text-xs bg-background" />
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await approveDisputeAction(dispute.id, pack);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Evidence submitted and dispute finalized");
                router.refresh();
              })
            }
          >
            {pending ? "Submitting" : "Approve and submit evidence to Braintree"}
          </Button>
        </>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer">{dispute.submittedAt ? "Evidence submitted. View what was sent" : "View evidence pack"}</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs bg-background rounded p-3 border">{dispute.evidencePack}</pre>
        </details>
      )}
    </div>
  );
}

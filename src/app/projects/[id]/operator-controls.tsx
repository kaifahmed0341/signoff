"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Copy, ExternalLink, FileSignature, Gavel, Link2Off, RefreshCw, RotateCw, Send, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  approveDisputeAction,
  reconcileAction,
  rerunCheckAction,
  rotateLinkAction,
  sendProjectAction,
  settleForTestingAction,
  simulateDisputeWebhookAction,
  submitDeliveryAction,
} from "@/app/actions";

type Result<T = unknown> = { ok: boolean; error?: string; data?: T };

/** Runs a server action and always ends the pending state, even if the request itself fails. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<Result<T>>, ok: string | ((r: Result<T>) => string), after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return void toast.error(r.error ?? "Something went wrong");
        toast.success(typeof ok === "function" ? ok(r) : ok);
        after?.();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && /body|size|exceeded/i.test(err.message) ? "That upload is too large. Keep files under 1 MB each." : "The request failed. Check your connection and try again.");
      }
    });
  return { pending, run };
}

export function ShareLink({ url, sent, projectId }: { url: string; sent: boolean; projectId: string }) {
  const { pending, run } = useAction();
  if (!sent) {
    return (
      <Button onClick={() => run(() => sendProjectAction(projectId), "Client link is live")} disabled={pending}>
        <Send /> Create client link
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <Input readOnly value={url} className="font-mono text-xs w-full sm:w-72 min-w-0" onFocus={(e) => e.currentTarget.select()} aria-label="Client link" />
      <Button variant="outline" size="icon" aria-label="Copy client link" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied"); }}><Copy /></Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="Replace the client link"
        title="Replace the client link. Old links stop working."
        disabled={pending}
        onClick={() => { if (confirm("Replace the client link? The old link and old receipt links stop working.")) run(() => rotateLinkAction(projectId), "New link created. The old one no longer works."); }}
      >
        <Link2Off />
      </Button>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap">Open as client <ExternalLink className="size-3.5" /></a>
    </div>
  );
}

export function ReconcileButton({ projectId }: { projectId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(
          () => reconcileAction(projectId),
          (r) => {
            const changed = ((r.data as string[]) ?? []).filter((a) => a !== "in sync" && a !== "no hold");
            return changed.length ? `Reconciled: ${changed.join("; ")}` : "Everything matches Braintree";
          },
        )
      }
    >
      <RefreshCw className={pending ? "animate-spin" : ""} /> Reconcile with Braintree
    </Button>
  );
}

export function RerunCheck({ milestoneId }: { milestoneId: string }) {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => rerunCheckAction(milestoneId), "Checking again")}>
      <RotateCw /> Run the check again
    </Button>
  );
}

const MAX_FILE = 1_000_000;
const MAX_TOTAL = 3_000_000;

export function DeliveryForm({ milestoneId, sampleLinks }: { milestoneId: string; sampleLinks?: { v1: string; cheat: string; v2: string } }) {
  const [links, setLinks] = useState("");
  const [notes, setNotes] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, run } = useAction();
  const checkFiles = () => {
    const files = [...(fileRef.current?.files ?? [])];
    const big = files.find((f) => f.size > MAX_FILE);
    const msg = files.length > 3 ? "Attach at most 3 files." : big ? `${big.name} is over 1 MB.` : files.reduce((a, f) => a + f.size, 0) > MAX_TOTAL ? "The files add up to more than 3 MB." : null;
    setFileError(msg);
    return msg;
  };
  const sample = (link: string, note: string) => { setLinks(link); setNotes(note); };
  return (
    <form
      className="space-y-3"
      action={(fd) => {
        if (checkFiles()) return;
        fd.set("milestoneId", milestoneId);
        run(() => submitDeliveryAction(fd), "Delivery submitted. The checker is running.", () => {
          setLinks("");
          setNotes("");
          if (fileRef.current) fileRef.current.value = "";
        });
      }}
    >
      {sampleLinks && (
        <div className="rounded-lg bg-muted/60 p-3 text-xs">
          <div className="font-medium mb-2">Try a sample deliverable</div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => sample(sampleLinks.v1, "First version of the landing page.")}>v1, misses two criteria</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => sample(sampleLinks.cheat, "All done, every criterion is on the page.")}>v1 with a cheat</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => sample(sampleLinks.v2, "Added the Saturday start time and the studio address.")}>v2, complete</Button>
          </div>
        </div>
      )}
      <Label htmlFor={`links-${milestoneId}`}>Links to the delivery</Label>
      <Textarea id={`links-${milestoneId}`} name="links" value={links} onChange={(e) => setLinks(e.target.value)} rows={2} placeholder="Staging URL, public GitHub repository, PDF link. One per line, up to 5." className="font-mono text-xs" />
      <Textarea name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for the client (optional)" aria-label="Notes for the client" />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <Input ref={fileRef} type="file" name="files" multiple accept=".txt,.md,.pdf,.csv,.json,text/*,application/pdf" className="text-xs min-w-0" onChange={checkFiles} aria-label="Files" />
        <select name="fileRole" className="h-8 rounded-lg border bg-background px-2 text-xs" aria-label="What the files are" defaultValue="notes">
          <option value="notes">Files are my notes about the work</option>
          <option value="deliverable">Files are the deliverable itself</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Up to 3 files, 1 MB each. Notes are shown to the client as your own claims and never count as proof on their own.</p>
      {fileError && <p className="text-sm text-destructive">{fileError}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}><Upload /> {pending ? "Submitting" : "Submit delivery for checking"}</Button>
      </div>
    </form>
  );
}

export function SandboxTools({ milestoneId, rail, transactionStatus }: { milestoneId: string; rail: string; transactionStatus: string | null }) {
  const { pending, run } = useAction();
  if (rail === "production") return null;
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs space-y-2">
      <div className="font-medium text-muted-foreground">Sandbox tools, to show what happens when a client disputes</div>
      <div className="flex flex-wrap gap-2">
        {transactionStatus === "submitted_for_settlement" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => settleForTestingAction(milestoneId), "Settled")}>Settle now and check for disputes</Button>
        )}
        {rail === "fake" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => simulateDisputeWebhookAction(milestoneId), (r) => `Webhook handled: ${r.data}`)}>Open a chargeback with a signed webhook</Button>
        )}
      </div>
      <p className="text-muted-foreground">
        {rail === "fake"
          ? "The test rail opens a chargeback and sends a webhook signed with the Braintree SDK through the real handler."
          : "On the Braintree sandbox, a hold paid with card 4023898493988028 opens a chargeback once settled."}
      </p>
    </div>
  );
}

type DisputeView = {
  id: string;
  status: string;
  reason: string | null;
  kind: string | null;
  replyByDate: string | null;
  evidencePack: string | null;
  submittedAt: Date | null;
  outcomeAt: Date | null;
  amount: string;
  createdAt: Date;
};

const OUTCOME_TONE: Record<string, string> = {
  open: "bg-red-100 text-red-900",
  won: "bg-emerald-100 text-emerald-900",
  lost: "bg-zinc-200 text-zinc-800",
  under_review: "bg-amber-100 text-amber-900",
  disputed: "bg-amber-100 text-amber-900",
};

/** One view of the whole dispute: what happened, the evidence drafted from the signed record, and the outcome. */
export function DisputePanel({ dispute, signedBy, signedAt, rail }: { dispute: DisputeView; signedBy: string | null; signedAt: string | null; rail: string }) {
  const [pack, setPack] = useState(dispute.evidencePack ?? "");
  const [compelling, setCompelling] = useState(rail !== "production");
  const { pending, run } = useAction();
  const canSubmit = dispute.status === "open" && !dispute.submittedAt;
  const steps = [
    { icon: FileSignature, label: `${signedBy ?? "The client"} signed off`, detail: signedAt ?? "", done: true },
    { icon: Gavel, label: `Chargeback opened for ${dispute.amount}`, detail: `${(dispute.reason ?? "no reason given").replace(/_/g, " ")}${dispute.replyByDate ? `, reply by ${dispute.replyByDate}` : ""}`, done: true },
    { icon: ShieldCheck, label: "Evidence drafted from the signed record", detail: dispute.submittedAt ? "Approved and submitted to Braintree" : "Waiting for your approval", done: !!dispute.submittedAt },
    { icon: CheckCircle2, label: dispute.outcomeAt || ["won", "lost"].includes(dispute.status) ? `Outcome: ${dispute.status}` : "Outcome pending", detail: dispute.status.replace(/_/g, " "), done: ["won", "lost"].includes(dispute.status) },
  ];
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Dispute</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_TONE[dispute.status] ?? OUTCOME_TONE.open}`}>{dispute.status.replace(/_/g, " ")}</span>
        <span className="font-mono text-xs text-muted-foreground break-all">{dispute.id}</span>
      </div>
      <ol className="grid sm:grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <li key={i} className={`rounded-lg border bg-background p-3 text-xs ${s.done ? "" : "opacity-70"}`}>
            <s.icon className={`size-4 ${s.done ? "text-primary" : "text-muted-foreground"}`} />
            <div className="mt-1.5 font-medium">{s.label}</div>
            <div className="text-muted-foreground break-words">{s.detail}</div>
          </li>
        ))}
      </ol>
      {canSubmit ? (
        <>
          <p className="text-sm">This evidence comes only from the acceptance record the client signed. Nothing goes to Braintree until you approve it.</p>
          <Textarea value={pack} onChange={(e) => setPack(e.target.value)} rows={10} className="font-mono text-xs bg-background" aria-label="Evidence pack" />
          {rail !== "production" && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={compelling} onChange={(e) => setCompelling(e.target.checked)} className="mt-0.5" />
              <span>Sandbox only: add Braintree&apos;s test value &ldquo;compelling_evidence&rdquo;, which makes the sandbox rule in our favour. A real dispute is decided by the card issuer.</span>
            </label>
          )}
          <Button disabled={pending} onClick={() => run(() => approveDisputeAction(dispute.id, pack, compelling), "Evidence submitted and the dispute finalized")}>
            {pending ? "Submitting" : "Approve and submit evidence to Braintree"}
          </Button>
        </>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer">{dispute.submittedAt ? "Evidence submitted. View what was sent" : "View the evidence pack"}</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs bg-background rounded p-3 border">{dispute.evidencePack}</pre>
        </details>
      )}
    </div>
  );
}

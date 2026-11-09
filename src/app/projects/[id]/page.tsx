import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import { OperatorShell } from "@/components/app/operator-shell";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { EvidenceReport } from "@/components/app/evidence-report";
import { HoldInfo } from "@/components/app/hold-info";
import { StateBadge } from "@/components/app/state-badge";
import { Timeline, type TimelineRow } from "@/components/app/timeline";
import { getDb } from "@/lib/db";
import { env, railMode } from "@/lib/env";
import { sampleLinks } from "@/lib/sample";
import { shareToken } from "@/lib/services/ids";
import { ServiceError, getOwnedProject, projectMilestones } from "@/lib/services/milestones";
import { requireWorkspace } from "@/lib/web/auth";
import { recoverStuckChecks } from "@/lib/ai/checker";
import { day, money, refsOf, when } from "@/lib/web/format";
import { loadProjectView } from "@/lib/web/views";
import { DeliveryForm, DisputePanel, ReconcileButton, SandboxTools, ShareLink } from "./operator-controls";

export const dynamic = "force-dynamic";
// Server actions on this page start checks that keep running after the response (see after()).
export const maxDuration = 300;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const w = await requireWorkspace();
  const { id } = await params;
  const db = await getDb();
  await getOwnedProject(db, w.id, id).catch(() => notFound());
  await recoverStuckChecks(db, (await projectMilestones(db, id)).map((m) => m.id));
  const view = await loadProjectView(db, id).catch((e) => {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  });
  const { project, milestones, events } = view;
  const shareUrl = `${env().APP_URL}/c/${project.id}/${shareToken(project.id)}`;
  const rail = railMode();
  const anyChecking = milestones.some((m) => m.state === "checking");
  const rows: TimelineRow[] = events.map((e) => ({
    at: when(e.createdAt).replace(" UTC", ""),
    actor: e.actor,
    milestone: milestones.find((m) => m.id === e.milestoneId)?.title ?? "",
    type: e.type,
    message: e.message,
    refs: refsOf(e.data),
  }));

  return (
    <OperatorShell>
      <AutoRefresh active={anyChecking} />
      <div className="flex flex-wrap items-start gap-4 justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">Projects</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{project.name}</h1>
          <p className="text-sm text-muted-foreground">For {project.clientName}{project.isSample ? " (sample project)" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ShareLink url={shareUrl} sent={!!project.sentAt} projectId={project.id} />
          <ReconcileButton projectId={project.id} />
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {milestones.map((m, i) => (
          <section key={m.id} className="rounded-2xl border bg-card shadow-xs">
            <div className="p-5 border-b flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-60">
                <div className="text-xs text-muted-foreground">Milestone {i + 1}{m.dueDate ? `, due ${day(m.dueDate)}` : ""}</div>
                <h2 className="font-semibold text-lg">{m.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{m.deliverable}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold tabular-nums">{money(m.amountCents, project.currency)}</div>
                <StateBadge state={m.state} className="mt-1" />
              </div>
            </div>
            <div className="p-5 space-y-5">
              <HoldInfo m={m} currency={project.currency} />
              {m.state === "changes_requested" && m.changeNote && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-3 text-sm">
                  <div className="font-medium mb-1">The client asked for changes</div>
                  <p className="whitespace-pre-wrap">{m.changeNote}</p>
                </div>
              )}
              {(m.state === "draft" || m.state === "awaiting_funding") && (
                <ul className="text-sm space-y-1.5">
                  {m.criteria.map((c) => <li key={c.id} className="flex gap-2"><span className="text-muted-foreground">&bull;</span>{c.text}</li>)}
                </ul>
              )}
              {m.state === "awaiting_funding" && <p className="text-sm text-muted-foreground">Waiting for the client to place a hold from their link.</p>}
              {(m.state === "funded" || m.state === "changes_requested") && (
                <DeliveryForm milestoneId={m.id} sampleLinks={project.isSample && i === 0 ? { v1: sampleLinks(1)[0], v2: sampleLinks(2)[0] } : undefined} />
              )}
              <EvidenceReport m={m} />
              {m.state === "in_review" && <p className="text-sm text-muted-foreground">The client has the report and decides from their link.</p>}
              {m.state === "released" && (
                <div className="space-y-3">
                  <Link href={`/receipt/${m.id}?t=${shareToken(project.id)}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><Receipt className="size-4" /> Receipt {m.receiptNumber}</Link>
                  <SandboxTools milestoneId={m.id} rail={rail} transactionStatus={m.transactionStatus} />
                  {m.disputes.map((d) => (
                    <DisputePanel key={d.id} dispute={{ id: d.id, status: d.status, reason: d.reason, replyByDate: d.replyByDate, evidencePack: d.evidencePack, submittedAt: d.submittedAt, amount: money(d.amountCents, project.currency) }} />
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <h2 className="mt-10 mb-3 font-medium">Audit timeline</h2>
      <Timeline rows={rows} />
    </OperatorShell>
  );
}

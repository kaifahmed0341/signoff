import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Receipt } from "lucide-react";
import { OperatorShell } from "@/components/app/operator-shell";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { EvidenceReport } from "@/components/app/evidence-report";
import { HoldInfo } from "@/components/app/hold-info";
import { StateBadge } from "@/components/app/state-badge";
import { Timeline, type TimelineRow } from "@/components/app/timeline";
import { getDb } from "@/lib/db";
import { env, railMode } from "@/lib/env";
import { sampleLinks } from "@/lib/sample";
import { ServiceError, getOwnedProject, projectMilestones, shareTokenFor } from "@/lib/services/milestones";
import { requireWorkspace } from "@/lib/web/auth";
import { recoverStuckChecks } from "@/lib/ai/checker";
import { day, money, refsOf, when } from "@/lib/web/format";
import { loadProjectView } from "@/lib/web/views";
import { AgentAccess } from "./agent-access";
import { listAgentTokens } from "@/lib/services/mcp-tokens";
import { DeliveryForm, DisputePanel, ReconcileButton, RerunCheck, SandboxTools, ShareLink } from "./operator-controls";

export const dynamic = "force-dynamic";
// Server actions on this page start checks that keep running after the response (see after()).
export const maxDuration = 300;

export async function generateMetadata() {
  return { title: "Project" };
}

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
  const agentTokens = await listAgentTokens(db, project.id);
  const shareUrl = `${env().APP_URL}/c/${project.id}/${shareTokenFor(project)}`;
  const rail = railMode();
  const anyChecking = milestones.some((m) => m.state === "checking");
  const rows: TimelineRow[] = events.map((e) => ({
    iso: e.createdAt.toISOString(),
    at: when(e.createdAt).replace(" UTC", ""),
    actor: e.actor === "operator" ? "freelancer" : e.actor,
    milestone: milestones.find((m) => m.id === e.milestoneId)?.title ?? "",
    type: e.type,
    message: e.message,
    refs: refsOf(e.data),
  }));

  return (
    <OperatorShell>
      <AutoRefresh active={anyChecking} />
      <div className="flex flex-wrap items-start gap-4 justify-between">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">Projects</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1 break-words">{project.name}</h1>
          <p className="text-sm text-muted-foreground">For {project.clientName}{project.isSample ? " (sample project)" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0 w-full lg:w-auto">
          <ShareLink url={shareUrl} sent={!!project.sentAt} projectId={project.id} />
          <ReconcileButton projectId={project.id} />
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {milestones.map((m, i) => (
          <section key={m.id} className="rounded-2xl border bg-card shadow-xs min-w-0">
            <div className="p-4 sm:p-5 border-b flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Milestone {i + 1}{m.dueDate ? `, due ${day(m.dueDate)}` : ""}</div>
                <h2 className="font-semibold text-lg">{m.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{m.deliverable}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold tabular-nums">{money(m.amountCents, project.currency)}</div>
                <StateBadge state={m.state} className="mt-1" />
              </div>
            </div>
            <div className="p-4 sm:p-5 space-y-5 min-w-0">
              {m.attention && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-900 dark:text-red-200 flex gap-2">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span><strong>Needs attention.</strong> {m.attention}</span>
                </div>
              )}
              <HoldInfo m={m} currency={project.currency} />
              {m.state === "changes_requested" && m.changeNote && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-3 text-sm">
                  <div className="font-medium mb-1">The client asked for changes</div>
                  <p className="whitespace-pre-wrap break-words">{m.changeNote}</p>
                </div>
              )}
              {(m.state === "draft" || m.state === "awaiting_funding") && (
                <ul className="text-sm space-y-1.5">
                  {m.criteria.map((c) => <li key={c.id} className="flex gap-2"><span className="text-muted-foreground">&bull;</span>{c.text}</li>)}
                </ul>
              )}
              {m.state === "awaiting_funding" && (
                <p className="text-sm text-muted-foreground">
                  Waiting for the client to place a hold from their link.
                  {project.isSample && i === 0 && <span className="text-foreground"> Next: click <strong>Open as client</strong> above and fund this milestone. In the demo you play both sides.</span>}
                </p>
              )}
              {(m.state === "funded" || m.state === "changes_requested") && (
                <DeliveryForm
                  milestoneId={m.id}
                  sampleLinks={project.isSample && i === 0 ? { v1: sampleLinks(1)[0], cheat: sampleLinks("cheat")[0], v2: sampleLinks(2)[0] } : undefined}
                />
              )}
              <EvidenceReport m={m} />
              {m.check?.status === "failed" && m.delivery && (m.state === "funded" || m.state === "changes_requested") && <RerunCheck milestoneId={m.id} />}
              {m.state === "in_review" && (
                <p className="text-sm text-muted-foreground">
                  The client has the report and decides from their link.
                  {project.isSample && <span className="text-foreground"> Next: open the client link to read the evidence and decide.</span>}
                </p>
              )}
              {m.state === "released" && (
                <div className="space-y-3">
                  <Link href={`/receipt/${m.id}?t=${shareTokenFor(project)}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><Receipt className="size-4" /> Receipt {m.receiptNumber}</Link>
                  {m.disputes.length === 0 && <SandboxTools milestoneId={m.id} rail={rail} transactionStatus={m.transactionStatus} />}
                  {m.disputes.map((d) => (
                    <DisputePanel
                      key={d.id}
                      rail={rail}
                      signedBy={m.acceptedBy}
                      signedAt={m.acceptedAt ? when(m.acceptedAt) : null}
                      dispute={{ id: d.id, status: d.status, reason: d.reason, kind: d.kind, replyByDate: d.replyByDate, evidencePack: d.evidencePack, submittedAt: d.submittedAt, outcomeAt: d.outcomeAt, createdAt: d.createdAt, amount: money(d.amountCents, project.currency) }}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6">
        <AgentAccess
          projectId={project.id}
          endpoint={`${env().APP_URL}/api/mcp`}
          tokens={agentTokens.map((t) => ({ id: t.id, label: t.label, createdAt: when(t.createdAt), lastUsedAt: t.lastUsedAt ? when(t.lastUsedAt) : null, revokedAt: t.revokedAt ? when(t.revokedAt) : null }))}
        />
      </div>

      <h2 className="mt-10 mb-3 font-medium">Audit timeline</h2>
      <Timeline rows={rows} />
    </OperatorShell>
  );
}

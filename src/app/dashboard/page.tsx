import Link from "next/link";
import { FlaskConical, Plus } from "lucide-react";
import { OperatorShell } from "@/components/app/operator-shell";
import { Ledger, type LedgerRow } from "@/components/app/ledger";
import { StateBadge } from "@/components/app/state-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { isHoldActive, type MilestoneState } from "@/lib/domain/milestone-machine";
import { loadSampleProject } from "@/app/actions";
import { requireWorkspace } from "@/lib/web/auth";
import { day, money } from "@/lib/web/format";
import { loadDashboard } from "@/lib/web/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function Dashboard() {
  const w = await requireWorkspace();
  const db = await getDb();
  const { projects, milestones, disputes } = await loadDashboard(db, w.id);
  const currency = projects[0]?.currency ?? "USD";
  const held = milestones.filter((m) => isHoldActive(m.state as MilestoneState)).reduce((a, m) => a + m.heldCents, 0);
  const released = milestones.reduce((a, m) => a + m.settledCents, 0);
  const waiting = milestones.filter((m) => m.state === "in_review").length;
  const openDisputes = disputes.filter((d) => d.status === "open").length;
  const rows: LedgerRow[] = milestones.map((m) => {
    const p = projects.find((x) => x.id === m.projectId)!;
    return {
      id: m.id,
      projectId: p.id,
      project: p.name,
      client: p.clientName,
      milestone: m.title,
      state: m.state,
      amount: m.amountCents,
      held: isHoldActive(m.state as MilestoneState) ? m.heldCents : 0,
      released: m.settledCents,
      currency: p.currency,
      payer: m.payerLabel ?? "",
      transactionId: m.transactionId ?? "",
      expires: m.authExpiresAt && isHoldActive(m.state as MilestoneState) ? day(m.authExpiresAt) : "",
      disputes: disputes.filter((d) => d.milestoneId === m.id).length,
    };
  });

  return (
    <OperatorShell>
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">Every milestone, its hold and where it stands.</p>
        </div>
        <div className="flex gap-2">
          {!projects.some((p) => p.isSample) && (
            <form action={loadSampleProject}>
              <Button type="submit" variant="outline" size="lg"><FlaskConical /> Load sample project</Button>
            </form>
          )}
          <Link href="/projects/new" className={buttonVariants({ size: "lg" })}><Plus /> New project</Link>
        </div>
      </div>

      {w.kind === "demo" && (
        <div className="mt-6 rounded-xl border bg-card p-4 sm:p-5">
          <div className="text-sm font-medium">Start here</div>
          <ol className="mt-2 grid gap-2 sm:grid-cols-4 text-sm text-muted-foreground">
            <li><span className="font-medium text-foreground">1.</span> Open the sample project below. You are the freelancer.</li>
            <li><span className="font-medium text-foreground">2.</span> Click <span className="text-foreground">Open as client</span> and place a hold. Now you are the client.</li>
            <li><span className="font-medium text-foreground">3.</span> Back as the freelancer, submit a sample delivery. Try the one with a cheat.</li>
            <li><span className="font-medium text-foreground">4.</span> As the client, read the evidence and sign off or ask for changes.</li>
          </ol>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Held for you now" value={money(held, currency)} hint="Authorized, not yet charged" />
        <Stat label="Released to you" value={money(released, currency)} hint="Submitted for settlement or settled" />
        <Stat label="Waiting on client sign-off" value={String(waiting)} hint="Evidence report ready" />
        <Stat label="Open disputes" value={String(openDisputes)} hint="Evidence pack drafted" />
      </div>

      {projects.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed p-10 text-center">
          <h2 className="font-medium">No projects yet</h2>
          <p className="text-sm text-muted-foreground mt-1">Load the sample project to run the whole loop in two minutes, or paste your own scope.</p>
        </div>
      ) : (
        <>
          <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => {
              const ms = milestones.filter((m) => m.projectId === p.id);
              const total = ms.reduce((a, m) => a + m.amountCents, 0);
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-sm text-muted-foreground">{p.clientName}</div>
                    </div>
                    <div className="text-sm font-medium">{money(total, p.currency)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[...new Set(ms.map((m) => m.state))].map((st) => {
                      const n = ms.filter((m) => m.state === st).length;
                      return <StateBadge key={st} state={st} count={n} />;
                    })}
                  </div>
                </Link>
              );
            })}
          </div>
          <h2 className="mt-10 mb-3 font-medium">Ledger</h2>
          <Ledger rows={rows} />
        </>
      )}
    </OperatorShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

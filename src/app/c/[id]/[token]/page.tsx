import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Lock, Receipt } from "lucide-react";
import { Brand } from "@/components/app/brand";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { EvidenceReport } from "@/components/app/evidence-report";
import { HoldInfo } from "@/components/app/hold-info";
import { StateBadge } from "@/components/app/state-badge";
import { getDb } from "@/lib/db";
import { env, railMode } from "@/lib/env";
import { projectFromShareLink } from "@/lib/services/milestones";
import { centsToAmount } from "@/lib/payments/rail";
import { day, money } from "@/lib/web/format";
import { loadProjectView } from "@/lib/web/views";
import { recoverStuckChecks } from "@/lib/ai/checker";
import { DecisionPanel } from "./decision-panel";
import { FundPanel } from "./fund-panel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Your project", robots: { index: false } };

export default async function ClientPage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  const db = await getDb();
  await projectFromShareLink(db, id, token).catch(() => notFound());
  const { project, milestones } = await loadProjectView(db, id).catch(() => notFound());
  await recoverStuckChecks(db, milestones.filter((m) => m.state === "checking").map((m) => m.id));
  if (!project.sentAt) notFound();
  const rail = railMode();
  const total = milestones.reduce((a, m) => a + m.amountCents, 0);
  const released = milestones.reduce((a, m) => a + m.settledCents, 0);

  return (
    <div className="min-h-screen">
      <AutoRefresh active={milestones.some((m) => m.state === "checking")} />
      <header className="border-b bg-card">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center">
          <Brand href="#" />
          <span className="ml-auto max-w-[55%] text-right text-[11px] leading-tight sm:text-xs text-muted-foreground">Payments by Braintree, a PayPal service{rail === "fake" ? " (test rail)" : rail === "sandbox" ? " (sandbox)" : ""}</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 min-w-0">
        <p className="text-sm text-muted-foreground">Prepared for {project.clientName}</p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">{project.name}</h1>
        <div className="mt-5 grid sm:grid-cols-3 gap-3">
          <div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">Total agreed</div><div className="text-xl font-semibold">{money(total, project.currency)}</div></div>
          <div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">Paid so far</div><div className="text-xl font-semibold">{money(released, project.currency)}</div></div>
          <div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">How this works</div><div className="text-sm mt-0.5">You pay each milestone on acceptance. Funding places a hold: nothing is charged until you sign off.</div></div>
        </div>

        <div className="mt-8 space-y-6">
          {milestones.map((m, i) => {
            const allMet = m.verdicts.length > 0 && m.verdicts.every((v) => v.verdict === "met");
            return (
              <section key={m.id} className="rounded-2xl border bg-card shadow-xs overflow-hidden">
                <div className="p-5 border-b flex items-start gap-4">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground">Milestone {i + 1}{m.dueDate ? `, due ${day(m.dueDate)}` : ""}</div>
                    <h2 className="font-semibold text-lg">{m.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{m.deliverable}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-semibold tabular-nums">{money(m.amountCents, project.currency)}</div>
                    <StateBadge state={m.state} className="mt-1" audience="client" />
                  </div>
                </div>
                <div className="p-5 space-y-5">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">You accept this milestone when</div>
                    <ul className="space-y-1.5 text-sm">
                      {m.criteria.map((c) => (
                        <li key={c.id} className="flex gap-2"><CheckCircle2 className="size-4 mt-0.5 text-muted-foreground shrink-0" />{c.text}</li>
                      ))}
                    </ul>
                  </div>
                  <HoldInfo m={m} currency={project.currency} />

                  {(m.state === "awaiting_funding" || m.state === "hold_expired") && (
                    <div className="rounded-xl border bg-background p-5 space-y-4">
                      <div className="flex gap-3">
                        <Lock className="size-5 text-held shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <div className="font-medium">Fund this milestone with a hold</div>
                          <p className="text-muted-foreground mt-1">
                            Your {rail === "sandbox" && !env().BRAINTREE_PAYPAL_ENABLED ? "card" : "PayPal account or card"} is authorized for {money(m.amountCents, project.currency)}. The money is held, not charged. It is charged only if you accept the work.
                            If you decline, the hold is voided. A hold lasts about a week on cards and longer on PayPal, and this page shows the exact expiry.
                          </p>
                        </div>
                      </div>
                      <FundPanel projectId={project.id} token={token} milestoneId={m.id} amount={centsToAmount(m.amountCents)} amountLabel={money(m.amountCents, project.currency)} currency={project.currency} rail={rail} paypalEnabled={env().BRAINTREE_PAYPAL_ENABLED} />
                    </div>
                  )}
                  {m.state === "funded" && <p className="text-sm text-muted-foreground">Your money is held. You will see an evidence report here when the work is delivered.</p>}
                  {m.state === "changes_requested" && <p className="text-sm text-muted-foreground">You asked for changes. The hold stays in place until the next delivery is checked.</p>}
                  <EvidenceReport m={m} />
                  {m.state === "in_review" && <DecisionPanel projectId={project.id} token={token} milestoneId={m.id} heldCents={m.heldCents} heldLabel={money(m.heldCents, project.currency)} allMet={allMet} />}
                  {m.disputes.length > 0 && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-900 dark:text-red-200">
                      <strong>A chargeback was opened on this payment</strong> ({m.disputes[0].status.replace(/_/g, " ")}).{" "}
                      {m.disputes[0].status === "won"
                        ? "It was decided for the freelancer, so the payment stands."
                        : m.disputes[0].status === "lost"
                          ? "It was decided for you, so the payment is returned to your card."
                          : "The freelancer can answer it with the acceptance record you signed."}
                      {["won", "lost"].includes(m.disputes[0].status) && rail !== "production" && " Sandbox: decided by Braintree's test value in the evidence, not by a bank."}
                    </div>
                  )}
                  {m.state === "released" && (
                    <Link href={`/receipt/${m.id}?t=${token}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><Receipt className="size-4" /> View receipt {m.receiptNumber}</Link>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

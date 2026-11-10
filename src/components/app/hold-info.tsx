import { Clock, Lock, ShieldAlert } from "lucide-react";
import { dueEndMs, holdEndsBeforeDue, holdHealth, isHoldActive, type MilestoneState } from "@/lib/domain/milestone-machine";

function holdHealthNow(exp: number | null) {
  return holdHealth(Date.now(), exp);
}
import { day, money, relative } from "@/lib/web/format";
import type { MilestoneView } from "@/lib/web/views";

export function HoldInfo({ m, currency }: { m: MilestoneView; currency: string }) {
  const state = m.state as MilestoneState;
  if (!m.transactionId) return null;
  if (isHoldActive(state)) {
    const exp = m.authExpiresAt?.getTime() ?? null;
    const health = holdHealthNow(exp);
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 text-held font-medium"><Lock className="size-4" /> {money(m.heldCents, currency)} held, not charged</span>
        {m.payerLabel && <span className="text-muted-foreground">{m.payerLabel}</span>}
        {exp && (
          <span className={`inline-flex items-center gap-1.5 ${health === "active" ? "text-muted-foreground" : "text-unmet font-medium"}`}>
            {health === "active" ? <Clock className="size-4" /> : <ShieldAlert className="size-4" />}
            Hold expires {day(exp)} ({relative(exp)})
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground">txn {m.transactionId}</span>
        {holdEndsBeforeDue(exp, m.dueDate) && (
          <span role="status" className="basis-full text-amber-800 dark:text-amber-300">
            This hold ends {exp ? day(exp) : ""}, before the milestone is due on {day(dueEndMs(m.dueDate)!)}. If the work is not signed off by then, the client can renew the hold on their page, and nothing is charged by renewing.
          </span>
        )}
      </div>
    );
  }
  if (state === "released") {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="text-met font-medium">{money(m.settledCents, currency)} released{m.settledCents < m.heldCents ? ` of ${money(m.heldCents, currency)} held` : ""}</span>
        <span className="text-muted-foreground">Signed off by {m.acceptedBy}</span>
        <span className="font-mono text-xs text-muted-foreground">txn {m.transactionId} ({m.transactionStatus})</span>
      </div>
    );
  }
  if (state === "declined") return <div className="text-sm text-muted-foreground">Hold voided. Nothing was charged. <span className="font-mono text-xs">txn {m.transactionId}</span></div>;
  if (state === "hold_expired") return <div className="text-sm text-unmet">The hold expired before a decision. The client can fund this milestone again.</div>;
  return null;
}

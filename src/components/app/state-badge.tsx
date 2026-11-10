import { CLIENT_STATE_LABEL, STATE_LABEL, type MilestoneState } from "@/lib/domain/milestone-machine";
import { cn } from "@/lib/utils";

const TONE: Record<MilestoneState, string> = {
  draft: "bg-muted text-muted-foreground",
  awaiting_funding: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  funded: "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
  checking: "bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-200",
  in_review: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200",
  releasing: "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200",
  voiding: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  changes_requested: "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200",
  released: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  declined: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  hold_expired: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
};

export function StateBadge({ state, className, audience = "operator", count = 1 }: { state: string; className?: string; audience?: "operator" | "client"; count?: number }) {
  const s = state as MilestoneState;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[s] ?? TONE.draft, className)}>
      {(s === "checking" || s === "releasing" || s === "voiding") && <span className="mr-1.5 size-1.5 rounded-full bg-current animate-pulse" />}
      {(audience === "client" ? CLIENT_STATE_LABEL[s] : undefined) ?? STATE_LABEL[s] ?? state}
      {count > 1 && <span className="ml-1 opacity-70">x{count}</span>}
    </span>
  );
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  met: { label: "Met", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200" },
  not_met: { label: "Not met", cls: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200" },
  needs_person: { label: "Needs a person", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" },
};

export function VerdictBadge({ verdict }: { verdict: string }) {
  const v = VERDICT[verdict] ?? VERDICT.needs_person;
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", v.cls)}>{v.label}</span>;
}

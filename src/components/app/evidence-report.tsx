import { Ban, CheckCircle2, Circle, FileText, Globe, Info, Loader2, Quote } from "lucide-react";
import type { MilestoneView } from "@/lib/web/views";
import { VerdictBadge } from "./state-badge";
import { when } from "@/lib/web/format";

function SourceLabel({ source }: { source: string }) {
  if (source === "scope") return <span>the signed scope</span>;
  if (source.startsWith("file:")) return <span>file {source.slice(5)}</span>;
  return (
    <a href={source} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted underline-offset-2 break-all">
      {source.replace(/^https?:\/\//, "")}
    </a>
  );
}

export function EvidenceReport({ m }: { m: MilestoneView }) {
  if (!m.check) return null;
  const c = m.check;
  if (c.status === "running") return <CheckProgressView m={m} />;
  if (c.status === "failed") {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">The last check failed: {c.error}. The hold is untouched. The operator can resubmit.</div>;
  }
  const counts = { met: 0, not_met: 0, needs_person: 0 } as Record<string, number>;
  for (const v of m.verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  return (
    <div className="rounded-xl border bg-card">
      <div className="p-4 border-b flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-sm font-medium">Evidence report for delivery v{m.delivery?.version}</div>
          <div className="text-xs text-muted-foreground">
            Checked {when(c.finishedAt)} by {c.model === "scripted" ? "the scripted checker (no AI model)" : c.model}
            {c.finishedAt && ` in ${Math.max(1, Math.round((c.finishedAt.getTime() - c.startedAt.getTime()) / 1000))} s`}
          </div>
        </div>
        <div className="flex gap-4 text-sm ml-auto">
          <span><span className="font-semibold text-met">{counts.met}</span> met</span>
          <span><span className="font-semibold text-unmet">{counts.not_met}</span> not met</span>
          <span><span className="font-semibold text-person">{counts.needs_person}</span> need a person</span>
        </div>
      </div>
      {c.fallbackReason && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex gap-2">
          <Info className="size-4 shrink-0" />
          <span>{c.fallbackReason}, so the scripted checker ran instead. It matches key words and uses no AI. Treat its verdicts with more care.</span>
        </div>
      )}
      {c.summary && <p className="px-4 pt-4 text-sm">{c.summary.replace(/^.*so the scripted checker ran instead\. /, "")}</p>}
      <ol className="p-4 space-y-4">
        {m.criteria.map((cr, i) => {
          const v = m.verdicts.find((x) => x.criterionId === cr.id);
          return (
            <li key={cr.id} className="rounded-lg border p-4 bg-background">
              <div className="flex items-start gap-3">
                <span className="text-xs text-muted-foreground mt-0.5 w-5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="font-medium text-sm">{cr.text}</div>
                    {v && <VerdictBadge verdict={v.verdict} />}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Agreed in the scope: &ldquo;{cr.sourceQuote}&rdquo;</div>
                  {v && <p className="mt-2 text-sm">{v.reasoning}</p>}
                  {v?.evidence.map((e, k) => (
                    <blockquote key={k} className="mt-2 rounded-md bg-muted px-3 py-2 text-sm flex gap-2">
                      <Quote className="size-3.5 mt-1 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div>&ldquo;{e.quote}&rdquo;</div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><CheckCircle2 className="size-3 text-met" /> Found word for word in <SourceLabel source={e.source} /></div>
                      </div>
                    </blockquote>
                  ))}
                  {v?.note && (
                    <div className="mt-2 text-xs flex gap-1.5 text-amber-800 dark:text-amber-300"><Info className="size-3.5 shrink-0" />{v.note}</div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <details className="border-t px-4 py-3 text-sm group">
        <summary className="cursor-pointer text-muted-foreground select-none">What the checker read ({m.toolCalls.length} reads{c.droppedEvidence ? `, ${c.droppedEvidence} unverifiable quote(s) removed` : ""})</summary>
        <ul className="mt-3 space-y-2">
          {m.toolCalls.map((t) => {
            const input = JSON.parse(t.input) as Record<string, string>;
            const target = input.url ?? input.repoUrl ?? input.name ?? "";
            return (
              <li key={t.id} className="flex gap-2 items-start">
                {t.ok ? (t.tool === "read_file" ? <FileText className="size-4 mt-0.5 text-muted-foreground" /> : <Globe className="size-4 mt-0.5 text-muted-foreground" />) : <Ban className="size-4 mt-0.5 text-unmet" />}
                <div className="min-w-0">
                  <div className="font-mono text-xs break-all">{t.tool} {target}{input.path ? ` ${input.path}` : ""}</div>
                  {!t.ok && <div className="text-xs text-unmet">{t.output}</div>}
                  {t.ok && <div className="text-xs text-muted-foreground">{t.output.length.toLocaleString()} characters read</div>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">The checker only reads. It has no payment tools, and pages it reads are treated as data, so instructions hidden in a delivery cannot move money.</p>
      </details>
    </div>
  );
}

const PHASE: Record<string, string> = {
  reading: "Reading the delivery",
  exploring: "Following links in the delivery",
  judging: "Testing each criterion",
  saving: "Verifying quotes and saving the report",
};

function CheckProgressView({ m }: { m: MilestoneView }) {
  const p = m.check!.progress;
  const reads = p?.reading ?? [];
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/70 dark:bg-violet-950/30 dark:border-violet-900 p-4 text-sm space-y-3" aria-live="polite">
      <div className="flex items-center gap-3 font-medium">
        <Loader2 className="size-4 animate-spin text-violet-600" />
        {PHASE[p?.phase ?? "reading"]} for delivery v{m.delivery?.version}
      </div>
      <ol className="space-y-1.5">
        {m.criteria.map((cr) => {
          const st = p?.criteria[cr.id] ?? "waiting";
          return (
            <li key={cr.id} className="flex items-start gap-2">
              {st === "done" ? <CheckCircle2 className="size-4 mt-0.5 text-met shrink-0" /> : st === "checking" ? <Loader2 className="size-4 mt-0.5 animate-spin text-violet-600 shrink-0" /> : <Circle className="size-4 mt-0.5 text-muted-foreground shrink-0" />}
              <span className={st === "waiting" ? "text-muted-foreground" : ""}>{cr.text}</span>
            </li>
          );
        })}
      </ol>
      {reads.length > 0 && (
        <div className="text-xs text-muted-foreground border-t border-violet-200 dark:border-violet-900 pt-2">
          <div className="font-medium mb-1">Read so far</div>
          <ul className="space-y-0.5 font-mono break-all">
            {reads.slice(-5).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

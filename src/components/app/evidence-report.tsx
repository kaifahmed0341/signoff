import { Ban, CheckCircle2, FileText, Globe, Info, Quote } from "lucide-react";
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
  if (c.status === "running") {
    return (
      <div className="rounded-xl border bg-violet-50 dark:bg-violet-950/30 p-4 text-sm flex items-center gap-3">
        <span className="size-2 rounded-full bg-violet-500 animate-pulse" />
        The checker is reading delivery v{m.delivery?.version} and testing each criterion. This takes under a minute.
      </div>
    );
  }
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
          <div className="text-xs text-muted-foreground">Checked {when(c.finishedAt)} by {c.model === "scripted" ? "the scripted checker (no AI model)" : c.model}</div>
        </div>
        <div className="flex gap-4 text-sm ml-auto">
          <span><span className="font-semibold text-met">{counts.met}</span> met</span>
          <span><span className="font-semibold text-unmet">{counts.not_met}</span> not met</span>
          <span><span className="font-semibold text-person">{counts.needs_person}</span> need a person</span>
        </div>
      </div>
      {c.summary && <p className="px-4 pt-4 text-sm">{c.summary}</p>}
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

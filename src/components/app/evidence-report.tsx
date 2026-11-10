import { Ban, CheckCircle2, Circle, Copy, EyeOff, FileText, GitBranch, Globe, Info, Loader2, Quote, ShieldAlert, X } from "lucide-react";
import type { MilestoneView } from "@/lib/web/views";
import { VerdictBadge } from "./state-badge";
import { when } from "@/lib/web/format";

const KIND: Record<string, string> = {
  page: "on the delivered page",
  deliverable_file: "in the delivered file",
  notes_file: "in the freelancer's notes (a claim, not proof)",
  repository: "in the repository",
};

function SourceLabel({ source }: { source: string }) {
  if (source.startsWith("file:")) return <span className="break-all">{source.slice(5)}</span>;
  if (!/^https?:\/\//.test(source)) return <span className="break-all">{source}</span>;
  return (
    <a href={source} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted underline-offset-2 break-all">
      {source.replace(/^https?:\/\//, "")}
    </a>
  );
}

/** Removed quotes worth showing: on a "not met" verdict, short or off-point quotes are noise, not tampering. */
function shownDropped(v: MilestoneView["verdicts"][number] | undefined) {
  return (v?.dropped ?? []).filter((d) => v!.verdict !== "not_met" || !/^(too short|does not mention)/.test(d.reason));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function EvidenceReport({ m }: { m: MilestoneView }) {
  if (!m.check) return null;
  const c = m.check;
  if (c.status === "running") return <CheckProgressView m={m} />;
  if (c.status === "failed") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        The last check did not finish: {c.error} The hold is untouched. The freelancer can run the check again.
      </div>
    );
  }
  const counts = { met: 0, not_met: 0, needs_person: 0 } as Record<string, number>;
  for (const v of m.verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  const findings = c.findings ?? [];
  const seconds = c.finishedAt ? Math.max(1, Math.round((c.finishedAt.getTime() - c.startedAt.getTime()) / 1000)) : null;
  return (
    <div className="rounded-xl border bg-card min-w-0">
      <div className="p-4 border-b flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">Evidence report for delivery v{m.delivery?.version}</div>
          <div className="text-xs text-muted-foreground">
            Checked {when(c.finishedAt)} by {c.model === "scripted" ? "the scripted checker (no AI)" : c.model}
            {seconds !== null && ` in ${seconds} s`}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:ml-auto">
          <span><span className="font-semibold text-met">{counts.met}</span> met</span>
          <span><span className="font-semibold text-unmet">{counts.not_met}</span> not met</span>
          <span><span className="font-semibold text-person">{counts.needs_person}</span> for a person</span>
        </div>
      </div>

      {m.files.some((f) => f.mime === "application/pdf") && !(m.delivery?.links ?? []).some((l) => /^https?:\/\//.test(l) && !/github\.com/.test(l)) && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex gap-2">
          <FileText className="size-4 shrink-0" />
          <span>This delivery is a PDF. The checker read the text of the file. No live page was checked, so anything the PDF shows as a website was not tested on a real site.</span>
        </div>
      )}

      {c.fallbackReason && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex gap-2">
          <Info className="size-4 shrink-0" />
          <span>{c.fallbackReason}, so the scripted checker ran instead. It matches key words and uses no AI. Read its verdicts with more care.</span>
        </div>
      )}

      {findings.length > 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-red-900 dark:text-red-200">
            <ShieldAlert className="size-4" /> Tampering found on the delivered page
          </div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {findings.map((f, i) => (
              <li key={i} className="flex gap-2">
                {f.kind === "hidden_text" ? <EyeOff className="size-3.5 mt-0.5 shrink-0" /> : f.kind === "pasted_requirement" ? <Copy className="size-3.5 mt-0.5 shrink-0" /> : <ShieldAlert className="size-3.5 mt-0.5 shrink-0" />}
                <span className="min-w-0">
                  <span className="font-medium">
                    {f.kind === "hidden_text" ? "Text hidden from visitors" : f.kind === "pasted_requirement" ? "Requirement pasted onto the page" : "Instruction aimed at the AI checker"}
                    {f.how && f.kind !== "pasted_requirement" ? ` (${f.how})` : ""}:
                  </span>{" "}
                  <span className="break-words">&ldquo;{f.excerpt}&rdquo;</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-900/80 dark:text-red-200/80">Hidden text and pasted requirements never count as evidence, and the checker treats page content as data, not instructions.</p>
        </div>
      )}

      {c.summary && <p className="px-4 pt-4 text-sm">{c.summary.replace(/^.*so the scripted checker ran instead\. /, "")}</p>}

      <ol className="p-4 space-y-4">
        {m.criteria.map((cr, i) => {
          const v = m.verdicts.find((x) => x.criterionId === cr.id);
          return (
            <li key={cr.id} className="rounded-lg border p-4 bg-background">
              <div className="flex items-start gap-3">
                <span className="text-xs text-muted-foreground mt-0.5 w-5 shrink-0">{i + 1}.</span>
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
                        <div className="break-words">&ldquo;{e.quote}&rdquo;</div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                          {v?.verdict === "met" ? (
                            <>
                              <CheckCircle2 className="size-3 text-met" /> Found word for word {KIND[e.kind ?? "page"]}: <SourceLabel source={e.source} />
                            </>
                          ) : (
                            <>
                              <Info className="size-3" /> What the delivery shows, not proof that this is met. Found word for word {KIND[e.kind ?? "page"]}: <SourceLabel source={e.source} />
                            </>
                          )}
                        </div>
                      </div>
                    </blockquote>
                  ))}
                  {shownDropped(v).map((d, k) => (
                    <div key={k} className="mt-2 rounded-md border border-dashed border-red-300 dark:border-red-900 px-3 py-2 text-sm flex gap-2">
                      <X className="size-3.5 mt-1 shrink-0 text-unmet" />
                      <div className="min-w-0">
                        <div className="line-through decoration-red-400/70 text-muted-foreground break-words">&ldquo;{d.quote}&rdquo;</div>
                        <div className="text-xs text-unmet mt-1">Removed: {d.reason}</div>
                      </div>
                    </div>
                  ))}
                  {v?.note && !(/were removed\. See why below\./.test(v.note) && shownDropped(v).length === 0) && (
                    <div className="mt-2 text-xs flex gap-1.5 text-amber-800 dark:text-amber-300">
                      <Info className="size-3.5 shrink-0" />
                      {v.note}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <details className="border-t px-4 py-3 text-sm group">
        <summary className="cursor-pointer text-muted-foreground select-none">
          What the checker read ({plural(m.toolCalls.length, "read")}
          {c.droppedEvidence ? `, ${plural(c.droppedEvidence, "quote")} removed` : ""})
        </summary>
        <ul className="mt-3 space-y-2">
          {m.toolCalls.map((t) => {
            const input = JSON.parse(t.input) as Record<string, string>;
            const target = input.url ?? input.repoUrl ?? input.name ?? "";
            const Icon = !t.ok ? Ban : t.tool === "read_file" ? FileText : t.tool.startsWith("github") ? GitBranch : Globe;
            return (
              <li key={t.id} className="flex gap-2 items-start">
                <Icon className={`size-4 mt-0.5 shrink-0 ${t.ok ? "text-muted-foreground" : "text-unmet"}`} />
                <div className="min-w-0">
                  <div className="font-mono text-xs break-all">
                    {t.tool} {target}
                    {input.path ? ` ${input.path}` : ""}
                  </div>
                  {!t.ok && <div className="text-xs text-unmet">{t.output}</div>}
                  {t.ok && <div className="text-xs text-muted-foreground">{t.output.length.toLocaleString()} characters read</div>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">The checker only reads. It has no payment tools, and what it reads is treated as data, so instructions hidden in a delivery cannot move money.</p>
      </details>
    </div>
  );
}

const PHASE: Record<string, string> = {
  reading: "Reading the delivery",
  exploring: "Following links in the delivery",
  judging: "Testing each criterion against what it read",
  saving: "Verifying every quote and saving the report",
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
              {st === "done" ? (
                <CheckCircle2 className="size-4 mt-0.5 text-met shrink-0" />
              ) : st === "checking" ? (
                <Loader2 className="size-4 mt-0.5 animate-spin text-violet-600 shrink-0" />
              ) : (
                <Circle className="size-4 mt-0.5 text-muted-foreground shrink-0" />
              )}
              <span className={st === "waiting" ? "text-muted-foreground" : ""}>{cr.text}</span>
            </li>
          );
        })}
      </ol>
      {reads.length > 0 && (
        <div className="text-xs text-muted-foreground border-t border-violet-200 dark:border-violet-900 pt-2">
          <div className="font-medium mb-1">Read so far</div>
          <ul className="space-y-0.5 font-mono break-all">
            {reads.slice(-5).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

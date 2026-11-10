"use client";

import { useEffect, useRef, useState } from "react";
import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { Download, X } from "lucide-react";
import type { AuditKind, TimelineRow } from "@/lib/web/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataGrid } from "./data-grid";

export type { TimelineRow };

const ACTOR: Record<string, string> = {
  client: "bg-indigo-100 text-indigo-900",
  freelancer: "bg-emerald-100 text-emerald-900",
  checker: "bg-violet-100 text-violet-900",
  braintree: "bg-sky-100 text-sky-900",
  system: "bg-zinc-100 text-zinc-700",
};

const KINDS: (AuditKind | "All")[] = ["All", "Money", "Dispute", "Check", "Sign-off", "Delivery"];

function What(p: ICellRendererParams<TimelineRow>) {
  const r = p.data!;
  const ids = [r.transactionId && `txn ${r.transactionId}`, r.disputeId && `dispute ${r.disputeId}`].filter(Boolean).join(" · ");
  return (
    <div className="py-2 leading-snug whitespace-normal">
      <div>{r.message}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground font-mono break-all">
        {/* On a phone the time and id columns are hidden, so they ride along under the message. */}
        <span className="md:hidden">{r.at} · </span>
        {r.type}
        {r.milestone ? ` · ${r.milestone}` : ""}
        {ids && <span className="md:hidden"> · {ids}</span>}
      </div>
    </div>
  );
}

const Mono = (p: ICellRendererParams<TimelineRow>) => (
  <span className="font-mono text-[11px]" title={p.value}>
    {p.value}
  </span>
);

/** Day-level date filter over the ISO timestamp. */
function sameDayComparator(filterDate: Date, iso: string): number {
  const d = new Date(iso);
  const cell = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const f = filterDate.getTime();
  return cell < f ? -1 : cell > f ? 1 : 0;
}

/**
 * The audit trail as an AG Grid: every column sorts and filters (text filters,
 * a date filter on the time), the Braintree transaction, dispute and check ids
 * are their own columns, chips filter by kind of event, the parent can narrow
 * it to one milestone, and the whole trail downloads as CSV for a dispute file.
 */
export function Timeline({ rows, milestone = null, onClearMilestone }: { rows: TimelineRow[]; milestone?: string | null; onClearMilestone?: () => void }) {
  const api = useRef<GridApi<TimelineRow> | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<AuditKind | "All">("All");

  const apply = async () => {
    const a = api.current;
    if (!a || a.isDestroyed()) return;
    await a.setColumnFilterModel("kind", kind === "All" ? null : { filterType: "text", type: "equals", filter: kind });
    await a.setColumnFilterModel("milestone", milestone ? { filterType: "text", type: "equals", filter: milestone } : null);
    a.onFilterChanged();
  };
  useEffect(() => {
    void apply();
    // apply reads the latest kind and milestone; it needs to run only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, milestone]);

  const columns: ColDef<TimelineRow>[] = [
    // Sorted by the ISO timestamp, shown formatted: text dates do not sort.
    {
      field: "iso",
      headerName: "When (UTC)",
      width: 160,
      minWidth: 150,
      flex: 0,
      sort: "desc",
      cellClass: "text-xs",
      valueFormatter: (p) => p.data?.at ?? "",
      filter: "agDateColumnFilter",
      filterParams: { comparator: sameDayComparator, buttons: ["reset"] },
    },
    {
      field: "actor",
      headerName: "Who",
      width: 120,
      minWidth: 110,
      flex: 0,
      cellRenderer: (p: ICellRendererParams<TimelineRow>) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTOR[p.value] ?? ACTOR.system}`}>{p.value}</span>,
    },
    { field: "kind", headerName: "Kind", width: 110, minWidth: 100, flex: 0, cellClass: "text-xs" },
    { field: "milestone", headerName: "Milestone", minWidth: 140, flex: 1, cellClass: "text-xs", tooltipField: "milestone" },
    { field: "message", headerName: "What happened", minWidth: 240, flex: 3, autoHeight: true, cellRenderer: What, getQuickFilterText: (p) => `${p.data!.message} ${p.data!.type} ${p.data!.milestone} ${p.data!.transactionId} ${p.data!.disputeId}` },
    { field: "transactionId", headerName: "Braintree transaction", minWidth: 150, flex: 1, cellRenderer: Mono },
    { field: "disputeId", headerName: "Braintree dispute", minWidth: 150, flex: 1, cellRenderer: Mono },
    { field: "checkId", headerName: "Check", minWidth: 130, flex: 0.8, cellRenderer: Mono, hide: true },
    { field: "refs", headerName: "Other data", minWidth: 160, flex: 1, cellRenderer: Mono, hide: true },
  ];

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search the timeline, ids too" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs" aria-label="Search the timeline" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind of event">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`rounded-full border px-2.5 py-1 text-xs ${kind === k ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="sm:ml-auto"
          onClick={() => api.current?.exportDataAsCsv({ fileName: "signoff-audit-trail.csv", allColumns: true, columnKeys: ["iso", "actor", "kind", "milestone", "type", "message", "transactionId", "disputeId", "checkId", "refs"] })}
        >
          <Download /> Download CSV
        </Button>
      </div>
      {milestone && (
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1">Milestone: {milestone}</span>
          {onClearMilestone && (
            <button type="button" onClick={onClearMilestone} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" /> Show every milestone
            </button>
          )}
        </div>
      )}
      <DataGrid
        rows={rows}
        columns={columns}
        quickFilter={q}
        empty="No events match"
        narrowHidden={["iso", "actor", "kind", "milestone", "transactionId", "disputeId"]}
        gridProps={{
          getRowId: (p) => p.data.id,
          onGridReady: (e) => {
            api.current = e.api;
            void apply();
          },
          onFilterChanged: (e) => {
            // Keep the chips honest when someone sets the Kind filter from the column menu.
            const m = e.api.getColumnFilterModel("kind") as { filter?: string } | null;
            const k = (m?.filter as AuditKind | undefined) ?? "All";
            if (KINDS.includes(k) && k !== kind) setKind(k);
          },
        }}
      />
    </div>
  );
}

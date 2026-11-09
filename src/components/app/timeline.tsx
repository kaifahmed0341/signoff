"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { DataGrid } from "./data-grid";

export type TimelineRow = { at: string; actor: string; milestone: string; type: string; message: string; refs: string };

const ACTOR: Record<string, string> = {
  client: "bg-indigo-100 text-indigo-900",
  operator: "bg-emerald-100 text-emerald-900",
  checker: "bg-violet-100 text-violet-900",
  braintree: "bg-sky-100 text-sky-900",
  system: "bg-zinc-100 text-zinc-700",
};

function What(p: ICellRendererParams<TimelineRow>) {
  const r = p.data!;
  return (
    <div className="py-2 leading-snug whitespace-normal">
      <div>{r.message}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground font-mono break-all">
        {r.type}
        {r.milestone ? ` · ${r.milestone}` : ""}
      </div>
    </div>
  );
}

function Refs(p: ICellRendererParams<TimelineRow>) {
  return <div className="py-2 font-mono text-[11px] leading-snug whitespace-normal break-all">{p.value}</div>;
}

export function Timeline({ rows }: { rows: TimelineRow[] }) {
  const columns: ColDef<TimelineRow>[] = [
    { field: "at", headerName: "When (UTC)", width: 160, minWidth: 150, flex: 0, sort: "desc", cellClass: "text-xs" },
    {
      field: "actor",
      headerName: "Who",
      width: 110,
      minWidth: 100,
      flex: 0,
      cellRenderer: (p: ICellRendererParams<TimelineRow>) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTOR[p.value] ?? ACTOR.system}`}>{p.value}</span>,
    },
    { field: "message", headerName: "What happened", minWidth: 280, flex: 3, autoHeight: true, cellRenderer: What, getQuickFilterText: (p) => `${p.data!.message} ${p.data!.type} ${p.data!.milestone}` },
    { field: "refs", headerName: "Braintree and check ids", minWidth: 200, flex: 1.4, autoHeight: true, cellRenderer: Refs },
  ];
  return <DataGrid rows={rows} columns={columns} empty="No events yet" />;
}

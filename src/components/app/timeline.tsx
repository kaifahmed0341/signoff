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

export function Timeline({ rows }: { rows: TimelineRow[] }) {
  const columns: ColDef<TimelineRow>[] = [
    { field: "at", headerName: "When (UTC)", minWidth: 165, maxWidth: 190, sort: "desc" },
    { field: "actor", headerName: "Who", maxWidth: 120, cellRenderer: (p: ICellRendererParams<TimelineRow>) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTOR[p.value] ?? ACTOR.system}`}>{p.value}</span> },
    { field: "milestone", headerName: "Milestone", minWidth: 140, maxWidth: 200 },
    { field: "message", headerName: "What happened", minWidth: 320, flex: 3, wrapText: true, autoHeight: true, cellClass: "leading-snug py-2" },
    { field: "refs", headerName: "Braintree and check ids", minWidth: 200, flex: 1.4, cellClass: "font-mono text-[11px] leading-snug py-2", wrapText: true, autoHeight: true },
    { field: "type", headerName: "Event", minWidth: 150, maxWidth: 190, cellClass: "font-mono text-xs" },
  ];
  return <DataGrid rows={rows} columns={columns} height={440} />;
}


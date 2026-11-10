"use client";

import { useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as AllChartsModule, ModuleRegistry as ChartsRegistry, type AgCartesianChartOptions } from "ag-charts-community";
import type { MoneyRow, TimelineRow } from "@/lib/web/audit";
import { DataGrid } from "./data-grid";
import { StateBadge } from "./state-badge";
import { Timeline } from "./timeline";

ChartsRegistry.registerModules([AllChartsModule]);

const SERIES = [
  { key: "held", name: "Held", fill: "#0ea5e9" },
  { key: "released", name: "Released", fill: "#059669" },
  { key: "voided", name: "Voided or expired", fill: "#a1a1aa" },
  { key: "disputed", name: "Disputed", fill: "#dc2626" },
] as const;

const fmt = (currency: string) => (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

/** One small AG Charts column chart: money held, released, voided and disputed, per milestone. */
export function MoneyChart({ rows, currency }: { rows: MoneyRow[]; currency: string }) {
  const money = fmt(currency);
  const anything = rows.some((r) => r.held || r.released || r.voided || r.disputed);
  if (!anything) return <p className="text-sm text-muted-foreground rounded-xl border bg-card p-4">No money has moved yet. The chart fills in when the client places a hold.</p>;
  const options: AgCartesianChartOptions = {
    data: rows.map((r) => ({ milestone: short(r.milestone), held: r.held / 100, released: r.released / 100, voided: r.voided / 100, disputed: r.disputed / 100 })),
    height: 240,
    background: { visible: false },
    padding: { top: 8, right: 8, bottom: 4, left: 4 },
    series: SERIES.map((s) => ({
      type: "bar" as const,
      xKey: "milestone",
      yKey: s.key,
      yName: s.name,
      fill: s.fill,
      cornerRadius: 3,
    })),
    axes: {
      x: { type: "category", position: "bottom", label: { fontSize: 11 } },
      y: { type: "number", position: "left", label: { fontSize: 11, formatter: ({ value }: { value: number }) => money(Math.round(value * 100)) } },
    },
    legend: { position: "bottom", item: { label: { fontSize: 11 } } },
  };
  return (
    <div className="rounded-xl border bg-card p-2 min-w-0" role="img" aria-label={`Money by milestone: ${rows.map((r) => `${r.milestone}, held ${money(r.held)}, released ${money(r.released)}, voided ${money(r.voided)}, disputed ${money(r.disputed)}`).join("; ")}`}>
      <AgCharts options={options} />
    </div>
  );
}

/**
 * The project's money in AG Grid and AG Charts, both community editions: a
 * grid with one row per milestone and a pinned totals row, the chart, and the
 * audit timeline. Clicking a milestone row filters the timeline to it, which
 * stands in for a per-milestone detail view without enterprise features.
 */
export function MoneyAndAudit({ money, totals, timeline, currency }: { money: MoneyRow[]; totals: MoneyRow; timeline: TimelineRow[]; currency: string }) {
  const [milestone, setMilestone] = useState<string | null>(null);
  const f = fmt(currency);
  const amount = (p: { value: number }) => (p.value ? f(p.value) : "");
  const columns: ColDef<MoneyRow>[] = [
    {
      field: "milestone",
      headerName: "Milestone",
      minWidth: 130,
      flex: 2,
      wrapText: true,
      autoHeight: true,
      cellRenderer: (p: ICellRendererParams<MoneyRow>) =>
        p.node.rowPinned ? (
          <span className="font-semibold">{p.value}</span>
        ) : (
          <button type="button" className="py-2 text-left font-medium leading-snug hover:underline" onClick={() => setMilestone(p.value === milestone ? null : p.value)} title="Show this milestone's events in the timeline">
            {p.value}
          </button>
        ),
    },
    { field: "state", headerName: "Status", minWidth: 160, cellRenderer: (p: ICellRendererParams<MoneyRow>) => (p.value ? <StateBadge state={p.value} /> : null) },
    { field: "agreed", headerName: "Agreed", type: "rightAligned", minWidth: 90, valueFormatter: amount, filter: false },
    { field: "held", headerName: "Held", type: "rightAligned", minWidth: 85, valueFormatter: amount, filter: false },
    { field: "released", headerName: "Released", type: "rightAligned", minWidth: 90, valueFormatter: amount, filter: false },
    { field: "voided", headerName: "Voided", type: "rightAligned", minWidth: 85, valueFormatter: amount, filter: false, headerTooltip: "Voided or expired holds: nothing was charged" },
    { field: "disputed", headerName: "Disputed", type: "rightAligned", minWidth: 90, valueFormatter: amount, filter: false },
    { field: "transactionId", headerName: "Braintree transaction", minWidth: 160, cellClass: "font-mono text-xs" },
    { field: "disputeId", headerName: "Braintree dispute", minWidth: 150, cellClass: "font-mono text-xs" },
    { field: "disputeStatus", headerName: "Dispute status", minWidth: 130 },
  ];
  return (
    <div className="space-y-4 min-w-0">
      <div className="grid gap-4 min-w-0">
        <DataGrid
          rows={money}
          columns={columns}
          empty="No milestones"
          narrowHidden={["state", "agreed", "voided", "transactionId", "disputeId", "disputeStatus"]}
          gridProps={{
            getRowId: (p) => p.data.id,
            pinnedBottomRowData: money.length > 1 ? [totals] : [],
            rowClassRules: { "bg-muted/60": (p) => !!milestone && p.data?.milestone === milestone },
          }}
        />
        <div className="max-w-2xl min-w-0">
          <MoneyChart rows={money} currency={currency} />
        </div>
      </div>
      <h2 className="mt-8 font-medium">Audit timeline</h2>
      <p className="-mt-2 text-xs text-muted-foreground">Click a milestone above to see only its events. Sort or filter any column from its header.</p>
      <Timeline rows={timeline} milestone={milestone} onClearMilestone={() => setMilestone(null)} />
    </div>
  );
}

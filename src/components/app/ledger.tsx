"use client";

import { useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { DataGrid } from "./data-grid";
import { StateBadge } from "./state-badge";
import { Input } from "@/components/ui/input";

export type LedgerRow = {
  id: string;
  projectId: string;
  project: string;
  client: string;
  milestone: string;
  state: string;
  amount: number;
  held: number;
  released: number;
  currency: string;
  payer: string;
  transactionId: string;
  expires: string;
  disputes: number;
};

const fmt = (currency: string) => (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v / 100);

export function Ledger({ rows }: { rows: LedgerRow[] }) {
  const [q, setQ] = useState("");
  const columns: ColDef<LedgerRow>[] = [
    {
      field: "milestone",
      headerName: "Milestone",
      minWidth: 200,
      cellRenderer: (p: ICellRendererParams<LedgerRow>) => (
        <Link className="font-medium hover:underline" href={`/projects/${p.data!.projectId}`}>{p.value}</Link>
      ),
    },
    { field: "project", headerName: "Project", minWidth: 180 },
    { field: "client", headerName: "Client", minWidth: 150 },
    { field: "state", headerName: "Status", minWidth: 170, cellRenderer: (p: ICellRendererParams<LedgerRow>) => <StateBadge state={p.value} /> },
    { field: "amount", headerName: "Agreed", type: "rightAligned", valueFormatter: (p) => fmt(p.data!.currency)(p.value) },
    { field: "held", headerName: "Held now", type: "rightAligned", valueFormatter: (p) => (p.value ? fmt(p.data!.currency)(p.value) : "") },
    { field: "released", headerName: "Released", type: "rightAligned", valueFormatter: (p) => (p.value ? fmt(p.data!.currency)(p.value) : "") },
    { field: "payer", headerName: "Paid with", minWidth: 170 },
    { field: "expires", headerName: "Hold expires", minWidth: 150 },
    { field: "transactionId", headerName: "Braintree transaction", minWidth: 170, cellClass: "font-mono text-xs" },
    { field: "disputes", headerName: "Disputes", maxWidth: 110, type: "rightAligned" },
  ];
  return (
    <div className="space-y-3">
      <Input placeholder="Filter the ledger" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Filter the ledger" />
      <DataGrid rows={rows} columns={columns} quickFilter={q} empty="No milestones yet" />
    </div>
  );
}

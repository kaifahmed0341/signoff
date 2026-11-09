"use client";

import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  headerFontWeight: 600,
  accentColor: "oklch(0.36 0.07 165)",
  borderColor: "oklch(0.905 0.008 95)",
  headerBackgroundColor: "oklch(0.97 0.005 95)",
  rowHoverColor: "oklch(0.96 0.01 165)",
  wrapperBorderRadius: 12,
  spacing: 7,
});

export function DataGrid<T>({ rows, columns, height = 360, quickFilter }: { rows: T[]; columns: ColDef<T>[]; height?: number; quickFilter?: string }) {
  return (
    <div style={{ height }} className="w-full">
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        quickFilterText={quickFilter}
        defaultColDef={{ sortable: true, resizable: true, filter: true, flex: 1, minWidth: 110 }}
        animateRows
        suppressCellFocus
        enableCellTextSelection
      />
    </div>
  );
}

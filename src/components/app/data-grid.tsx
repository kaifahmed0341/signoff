"use client";

import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi } from "ag-grid-community";

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
  spacing: 6,
});

/**
 * Grid sized to its rows: no empty box under a short list, and pages of 20
 * for a long one. The grid scrolls sideways inside its own box on a phone,
 * so it never widens the page.
 */
/** Columns listed in `narrowHidden` are hidden when the grid is narrower than 640 pixels. */
/** `gridProps` passes further AG Grid options through, such as a pinned totals row or a row-click handler. */
export function DataGrid<T>({
  rows,
  columns,
  quickFilter,
  empty = "Nothing here yet",
  narrowHidden = [],
  gridProps = {},
}: {
  rows: T[];
  columns: ColDef<T>[];
  quickFilter?: string;
  empty?: string;
  narrowHidden?: string[];
  gridProps?: Partial<AgGridReactProps<T>>;
}) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        quickFilterText={quickFilter}
        domLayout="autoHeight"
        pagination={rows.length > 20}
        paginationPageSize={20}
        paginationPageSizeSelector={false}
        overlayNoRowsTemplate={`<span style="padding:16px;color:#777">${empty}</span>`}
        defaultColDef={{ sortable: true, resizable: true, filter: true, flex: 1, minWidth: 110 }}
        // Rows with wrapped text are measured once fonts and styles have loaded, so a second line is never clipped.
        onFirstDataRendered={(e) => remeasure(e.api)}
        onGridSizeChanged={(e) => {
          if (narrowHidden.length) e.api.setColumnsVisible(narrowHidden, e.clientWidth >= 640);
          e.api.resetRowHeights();
        }}
        animateRows
        suppressCellFocus
        enableCellTextSelection
        {...gridProps}
      />
    </div>
  );
}

function remeasure(api: GridApi) {
  const run = () => {
    if (!api.isDestroyed()) api.resetRowHeights();
  };
  requestAnimationFrame(run);
  setTimeout(run, 300);
  if (typeof document !== "undefined" && document.fonts) document.fonts.ready.then(run).catch(() => undefined);
}

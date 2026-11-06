import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CellValue, RowSet } from "@/lib/api-types";
import { isNumericType, typeIcon } from "@/lib/column-types";
import { formatCell } from "@/lib/format";
import { estimateColumnWidth } from "@/lib/sql-text";
import { cn } from "@/lib/utils";

const features = tableFeatures({ columnSizingFeature, columnResizingFeature });
const helper = createColumnHelper<typeof features, CellValue[]>();

const ROW_HEIGHT = 28;
const ROW_NUMBER_WIDTH = 56;

export function ResultGrid({
  data,
  className,
  renderColumnPopover,
}: {
  data: RowSet;
  className?: string;
  renderColumnPopover?: (index: number) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openColumn, setOpenColumn] = useState<number | null>(null);
  const numeric = useMemo(() => data.columns.map((c) => isNumericType(c.type)), [data.columns]);

  const columns = useMemo(
    () =>
      helper.columns(
        data.columns.map((column, index) =>
          helper.accessor((row) => row[index], {
            id: String(index),
            header: column.name,
            size: estimateColumnWidth(column, data.rows, index),
            minSize: 60,
            maxSize: 1200,
          }),
        ),
      ),
    [data.columns, data.rows],
  );

  const table = useTable({ features, columns, data: data.rows, columnResizeMode: "onChange" });
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const width = table.getTotalSize() + ROW_NUMBER_WIDTH;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      ref={scrollRef}
      className={cn("relative overflow-auto text-xs", className)}
      role="grid"
      aria-rowcount={rows.length + 1}
    >
      <div style={{ width, minWidth: "100%" }}>
        <div className="sticky top-0 z-10 flex border-b bg-muted" role="row">
          <div
            className="sticky left-0 z-20 shrink-0 border-r bg-muted"
            style={{ width: ROW_NUMBER_WIDTH }}
          />
          {headers.map((header, index) => {
            const column = data.columns[index];
            const Icon = typeIcon(column.type);
            const content = (
              <button
                className={cn(
                  "flex h-full w-full flex-col justify-center px-3 py-1.5 text-left hover:bg-accent/60",
                  numeric[index] && "items-end text-right",
                )}
                title={`${column.name} · ${column.type}${renderColumnPopover ? " — click for stats" : ""}`}
              >
                <span className="flex max-w-full items-center gap-1.5 font-medium">
                  <Icon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{column.name}</span>
                </span>
                <span className="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                  {column.type}
                </span>
              </button>
            );
            return (
              <div
                key={header.id}
                role="columnheader"
                className="relative shrink-0 border-r"
                style={{ width: header.getSize() }}
              >
                {renderColumnPopover ? (
                  <Popover
                    open={openColumn === index}
                    onOpenChange={(open) => setOpenColumn(open ? index : null)}
                  >
                    <PopoverTrigger asChild>{content}</PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-0">
                      {openColumn === index && renderColumnPopover(index)}
                    </PopoverContent>
                  </Popover>
                ) : (
                  content
                )}
                <div
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                  onDoubleClick={() => header.column.resetSize()}
                  className={cn(
                    "absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/40",
                    header.column.getIsResizing() && "bg-primary",
                  )}
                />
              </div>
            );
          })}
        </div>

        <div className="relative select-text" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.id}
                role="row"
                className="absolute left-0 flex w-full border-b border-border/60 hover:bg-accent/40"
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <div
                  className="sticky left-0 z-[1] flex shrink-0 items-center justify-end border-r bg-background px-2 text-muted-foreground tabular-nums"
                  style={{ width: ROW_NUMBER_WIDTH }}
                >
                  {item.index + 1}
                </div>
                {row.getAllCells().map((cell, index) => {
                  const value = cell.getValue() as CellValue;
                  const text = formatCell(value);
                  return (
                    <div
                      key={cell.id}
                      role="gridcell"
                      title={text.length > 40 ? text : undefined}
                      className={cn(
                        "flex shrink-0 items-center truncate border-r border-border/60 px-3",
                        numeric[index] && "justify-end font-mono tabular-nums",
                        value === null && "text-muted-foreground/60 italic",
                      )}
                      style={{ width: cell.column.getSize() }}
                    >
                      <span className="truncate">{text}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">No rows</div>
      )}
    </div>
  );
}

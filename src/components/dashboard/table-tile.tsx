import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { CellValue } from "@/lib/api-types";
import { toNumber } from "@/lib/chart";
import { formatCell } from "@/lib/format";
import { metricLabel } from "@/lib/dashboard-chart";
import type { TileData, TileSpec } from "@/lib/dashboard-types";
import { formatBucket, formatValue } from "@/lib/number-format";
import { cn } from "@/lib/utils";

interface Column {
  label: string;
  numeric: boolean;
  render: (value: CellValue) => string;
}

function columnsFor(tile: TileSpec, data: TileData): Column[] {
  const dims = tile.config.dimensions ?? [];
  const metrics = tile.config.metrics ?? [];
  return [
    ...dims.map((dim, i): Column => {
      const type = data.columns[i]?.type ?? "";
      return {
        label: dim.column,
        numeric: /^(U?(TINY|SMALL|BIG|HUGE)?INT|FLOAT|DOUBLE|DECIMAL)/.test(type),
        render: (v) =>
          dim.grain && typeof v === "string" ? formatBucket(v, dim.grain, true) : formatCell(v),
      };
    }),
    ...metrics.map((metric): Column => ({
      label: metricLabel(metric),
      numeric: true,
      render: (v) =>
        typeof v === "number" || typeof v === "string"
          ? formatValue(toNumber(v), metric.format, false)
          : formatCell(v),
    })),
  ];
}

export function TableTile({ tile, data }: { tile: TileSpec; data: TileData }) {
  const columns = useMemo(() => columnsFor(tile, data), [tile, data]);
  const [sort, setSort] = useState<{ index: number; direction: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return data.rows;
    const { index, direction } = sort;
    return [...data.rows].sort((a, b) => {
      const x = a[index];
      const y = b[index];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const nx = toNumber(x);
      const ny = toNumber(y);
      if (nx !== null && ny !== null) return (nx - ny) * direction;
      return String(x).localeCompare(String(y)) * direction;
    });
  }, [data.rows, sort]);

  const toggle = (index: number) =>
    setSort((current) =>
      current?.index !== index
        ? { index, direction: 1 }
        : current.direction === 1
          ? { index, direction: -1 }
          : null,
    );

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    "border-b bg-card px-2 py-1.5 font-medium whitespace-nowrap text-muted-foreground",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  <button
                    type="button"
                    dir="auto"
                    onClick={() => toggle(i)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {column.label}
                    {sort?.index === i &&
                      (sort.direction === 1 ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="hover:bg-muted/50">
                {columns.map((column, c) => (
                  <td
                    key={c}
                    dir="auto"
                    className={cn(
                      "max-w-64 truncate border-b border-border/50 px-2 py-1.5",
                      column.numeric ? "text-right tabular-nums" : "text-left",
                    )}
                  >
                    {column.render(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No rows for the current filters
          </div>
        )}
      </div>
      {data.truncated && (
        <div className="shrink-0 pt-1.5 text-[11px] text-muted-foreground">
          Showing the first {rows.length.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}

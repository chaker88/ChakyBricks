import type { RowSet } from "@/lib/api-types";
import { isNumericType, typeIcon } from "@/lib/column-types";
import { formatCell } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DataPreview({ data, className }: { data: RowSet; className?: string }) {
  const numeric = data.columns.map((c) => isNumericType(c.type));

  return (
    <div className={cn("overflow-auto rounded-lg border", className)}>
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="w-10 border-b px-2 py-2 text-right font-normal text-muted-foreground">
              #
            </th>
            {data.columns.map((column, i) => {
              const Icon = typeIcon(column.type);
              return (
                <th
                  key={column.name}
                  className={cn(
                    "border-b border-l px-3 py-2 text-left font-medium whitespace-nowrap",
                    numeric[i] && "text-right",
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="size-3 text-muted-foreground" />
                    {column.name}
                  </span>
                  <div className="font-mono text-[10px] font-normal text-muted-foreground">
                    {column.type}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r} className="hover:bg-accent/40">
              <td className="border-b px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                {r + 1}
              </td>
              {row.map((value, c) => (
                <td
                  key={c}
                  className={cn(
                    "max-w-80 truncate border-b border-l px-3 py-1.5 whitespace-nowrap",
                    numeric[c] && "text-right font-mono tabular-nums",
                    value === null && "text-muted-foreground/60 italic",
                  )}
                  title={formatCell(value)}
                >
                  {formatCell(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">No rows</div>
      )}
    </div>
  );
}

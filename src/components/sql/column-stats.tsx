import { Loader2 } from "lucide-react";
import { useColumnStats } from "@/hooks/use-sql";
import { formatCell, formatNumber } from "@/lib/format";

export function ColumnStatsPanel({ sql, column }: { sql: string; column: string }) {
  const { data, error, isLoading } = useColumnStats(sql, column);

  return (
    <div className="text-xs">
      <div className="border-b px-3 py-2">
        <div className="truncate font-medium">{column}</div>
        <div className="text-muted-foreground">Statistics over the full result</div>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Computing…
        </div>
      ) : error ? (
        <div className="px-3 py-3 text-destructive">{error.message}</div>
      ) : data ? (
        <div className="space-y-3 p-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <Stat label="Rows" value={formatNumber(data.rows)} />
            <Stat
              label="Nulls"
              value={`${formatNumber(data.nulls)}${data.rows ? ` (${Math.round((data.nulls / data.rows) * 100)}%)` : ""}`}
            />
            <Stat label="Distinct (approx.)" value={formatNumber(data.distinct)} />
            {data.min !== undefined && <Stat label="Min" value={formatCell(data.min)} />}
            {data.max !== undefined && <Stat label="Max" value={formatCell(data.max)} />}
            {data.numeric && (
              <>
                <Stat label="Mean" value={fmt(data.mean)} />
                <Stat label="Std dev" value={fmt(data.stddev)} />
                <Stat label="25th pct" value={fmt(data.p25)} />
                <Stat label="Median" value={fmt(data.median)} />
                <Stat label="75th pct" value={fmt(data.p75)} />
              </>
            )}
          </dl>
          {data.top_values.length > 0 && (
            <div>
              <div className="mb-1.5 font-medium text-muted-foreground">Most common</div>
              <ul className="space-y-1">
                {data.top_values.map(({ value, count }, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                      <div
                        className="absolute inset-y-0 left-0 bg-primary/20"
                        style={{ width: `${data.rows ? (count / data.rows) * 100 : 0}%` }}
                      />
                      <span className="relative block truncate px-1.5 leading-5">
                        {formatCell(value)}
                      </span>
                    </div>
                    <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
                      {formatNumber(count)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(Math.round(value * 100) / 100)
    : value.toPrecision(4);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono tabular-nums" title={value}>
        {value}
      </dd>
    </>
  );
}

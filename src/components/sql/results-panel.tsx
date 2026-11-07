import {
  BarChart3,
  Ban,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  OctagonX,
  Play,
  Table2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ResultGrid } from "@/components/result-grid";
import { ColumnStatsPanel } from "@/components/sql/column-stats";
import { ResultChart } from "@/components/sql/result-chart";
import { SaveTableDialog } from "@/components/sql/save-table-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExportResult, type RunState } from "@/hooks/use-sql";
import { pickSavePath } from "@/lib/files";
import { formatBytes, formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ResultsPanel({ run, onCancel }: { run?: RunState; onCancel: () => void }) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [saving, setSaving] = useState(false);
  const exporter = useExportResult();
  const result = run?.result;
  const rowsResult = result?.kind === "rows" ? result : undefined;
  const running = run?.status === "running";

  const exportResult = async (format: "csv" | "parquet") => {
    if (!run) return;
    const path = await pickSavePath(`query_result.${format}`, format);
    if (!path) return;
    toast.promise(exporter.mutateAsync({ sql: run.sql, path, format }), {
      loading: `Exporting full result to ${format.toUpperCase()}…`,
      success: (r) => `Exported ${formatBytes(r.size_bytes)} to ${r.path}`,
      error: (e: Error) => `Export failed: ${e.message}`,
    });
  };

  if (!run) {
    return (
      <Placeholder>
        <Play className="size-5" />
        <span>
          Run a query with <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd>. Select text to run just that part.
        </span>
      </Placeholder>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3 text-xs">
        <Status run={run} />
        <div className="flex-1" />
        {rowsResult && (
          <>
            <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
              {(
                [
                  ["table", Table2, "Table"],
                  ["chart", BarChart3, "Chart"],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors",
                    view === value
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <Download />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Full result ({formatNumber(rowsResult.row_count)} rows)
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => exportResult("csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportResult("parquet")}>
                  Parquet
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSaving(true)}
            >
              <Database />
              Save as table
            </Button>
          </>
        )}
        {running && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>
            <Ban />
            Cancel
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {running && (
          <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/20">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        )}
        {run.status === "error" ? (
          <div className="h-full overflow-auto p-4">
            <div className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-destructive">
              <OctagonX className="mt-0.5 size-4 shrink-0" />
              <pre className="font-mono text-xs break-words whitespace-pre-wrap select-text">
                {run.error}
              </pre>
            </div>
          </div>
        ) : run.status === "cancelled" ? (
          <Placeholder>
            <Ban className="size-5" />
            Query cancelled
          </Placeholder>
        ) : result?.kind === "write" ? (
          <div className={cn("h-full overflow-auto p-4", running && "opacity-50")}>
            <div className="flex gap-2.5 rounded-lg border bg-card p-4">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium select-text">{result.message}</p>
                {result.writes.length > 1 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground select-text">
                    {result.writes.slice(0, -1).map((write, i) => (
                      <li key={i}>{write.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : rowsResult ? (
          <div className={cn("h-full", running && "opacity-50")}>
            {view === "table" ? (
              <ResultGrid
                data={rowsResult}
                className="h-full"
                renderColumnPopover={(index) => (
                  <ColumnStatsPanel sql={run.sql} column={rowsResult.columns[index].name} />
                )}
              />
            ) : (
              <ResultChart key={rowsResult.query_id} data={rowsResult} />
            )}
          </div>
        ) : (
          <Placeholder>
            <Loader2 className="size-5 animate-spin" />
            Running…
          </Placeholder>
        )}
      </div>
      {rowsResult && (
        <SaveTableDialog
          key={rowsResult.query_id}
          sql={run.sql}
          open={saving}
          onOpenChange={setSaving}
        />
      )}
    </div>
  );
}

function Status({ run }: { run: RunState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [run.status]);

  if (run.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
        <Loader2 className="size-3.5 animate-spin" />
        Running · {formatDuration(Math.max(0, now - run.startedAt) / 1000)}
      </span>
    );
  }
  const result = run.result;
  if (run.status !== "done" || !result) return null;
  if (result.kind === "write") {
    return (
      <span className="text-muted-foreground tabular-nums">
        {result.statement_count > 1 ? `${result.statement_count} statements` : "Done"} ·{" "}
        {formatDuration(result.elapsed_ms / 1000)}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground tabular-nums">
      {result.truncated ? (
        <>
          Showing{" "}
          <span className="font-medium text-foreground">{formatNumber(result.rows.length)}</span> of{" "}
          <span className="font-medium text-foreground">{formatNumber(result.row_count)}</span> rows
        </>
      ) : (
        <>
          <span className="font-medium text-foreground">{formatNumber(result.row_count)}</span>{" "}
          {result.row_count === 1 ? "row" : "rows"}
        </>
      )}
      {" · "}
      {formatDuration(result.elapsed_ms / 1000)}
      {result.statement_count > 1 && ` · ${result.statement_count} statements, showing the last`}
    </span>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium">
      {children}
    </kbd>
  );
}

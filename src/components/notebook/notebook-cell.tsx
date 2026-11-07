import {
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { forwardRef, memo } from "react";
import { CellEditor, type CellEditorHandle, type RunMode } from "@/components/notebook/cell-editor";
import { CellOutputs } from "@/components/notebook/cell-outputs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import type { KernelCompletion } from "@/lib/monaco";
import { ADD_LABELS, type Cell, type CellType, type NotebookAction } from "@/lib/notebook";
import { cn } from "@/lib/utils";

const TYPES: { value: CellType; label: string }[] = [
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "markdown", label: "Markdown" },
];

interface NotebookCellProps {
  cell: Cell;
  index: number;
  count: number;
  active: boolean;
  autoFocus: boolean;
  dispatch: (action: NotebookAction) => void;
  onRun: (cell: Cell, mode: RunMode) => void;
  onActivate: (id: string) => void;
  onAdd: (index: number, type: CellType) => void;
  complete: (code: string, offset: number) => Promise<KernelCompletion>;
}

export const NotebookCell = memo(
  forwardRef<CellEditorHandle, NotebookCellProps>(function NotebookCell(
    { cell, index, count, active, autoFocus, dispatch, onRun, onActivate, onAdd, complete },
    ref,
  ) {
    const markdown = cell.type === "markdown";
    const busy = cell.status === "queued" || cell.status === "running";

    return (
      <div
        onMouseDown={() => onActivate(cell.id)}
        className={cn(
          "group relative flex rounded-lg border bg-card transition-colors",
          active ? "border-primary/50 ring-1 ring-primary/20" : "hover:border-foreground/20",
        )}
      >
        <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-2">
          <button
            aria-label="Run cell"
            title="Run (Shift+Enter)"
            onClick={() => onRun(cell, "stay")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {cell.status === "running" ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : cell.status === "queued" ? (
              <Clock className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>
          {!markdown && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              [{cell.status === "queued" ? "*" : (cell.executionCount ?? " ")}]
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex h-8 items-center gap-2 border-b px-2 text-xs">
            <Select
              value={cell.type}
              onValueChange={(value) =>
                dispatch({ type: "change-type", id: cell.id, cellType: value as CellType })
              }
            >
              <SelectTrigger size="sm" className="h-6 w-28 border-none px-2 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Status cell={cell} />
            <div
              className={cn(
                "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                active && "opacity-100",
              )}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Add cell"
                    title="Add cell"
                    className="flex items-center gap-0.5 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                    <span className="text-[11px]">Add cell</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ADD_LABELS.map((t) => (
                    <DropdownMenuItem
                      key={`below-${t.value}`}
                      onSelect={() => onAdd(index + 1, t.value)}
                    >
                      {t.label} cell below
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {ADD_LABELS.map((t) => (
                    <DropdownMenuItem
                      key={`above-${t.value}`}
                      onSelect={() => onAdd(index, t.value)}
                    >
                      {t.label} cell above
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <IconButton
                label="Move up"
                disabled={index === 0}
                onClick={() => dispatch({ type: "move", id: cell.id, delta: -1 })}
              >
                <ArrowUp className="size-3.5" />
              </IconButton>
              <IconButton
                label="Move down"
                disabled={index === count - 1}
                onClick={() => dispatch({ type: "move", id: cell.id, delta: 1 })}
              >
                <ArrowDown className="size-3.5" />
              </IconButton>
              <IconButton
                label="Delete cell"
                disabled={busy}
                onClick={() => dispatch({ type: "remove", id: cell.id })}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          </div>

          {markdown && !cell.editing ? (
            <div
              onDoubleClick={() => dispatch({ type: "editing", id: cell.id, editing: true })}
              className="min-h-10 cursor-text px-4 py-2"
              title="Double-click to edit"
            >
              {cell.source.trim() ? (
                <div
                  className="markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.source) }}
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">Empty markdown cell</p>
              )}
            </div>
          ) : (
            <CellEditor
              ref={ref}
              type={cell.type}
              value={cell.source}
              autoFocus={autoFocus}
              onChange={(source) => dispatch({ type: "source", id: cell.id, source })}
              onRun={(mode) => onRun(cell, mode)}
              onFocus={() => onActivate(cell.id)}
              complete={complete}
            />
          )}
          <CellOutputs outputs={cell.outputs} />
        </div>
      </div>
    );
  }),
);

function Status({ cell }: { cell: Cell }) {
  if (cell.status === "running") return <span className="text-muted-foreground">Running…</span>;
  if (cell.status === "queued") return <span className="text-muted-foreground">Queued</span>;
  if (cell.status === "aborted") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Ban className="size-3" /> Not run
      </span>
    );
  }
  if (cell.status === "error") {
    return (
      <span className="flex items-center gap-1 text-destructive">
        <XCircle className="size-3" />
        {cell.durationMs !== null && formatDuration(cell.durationMs / 1000)}
      </span>
    );
  }
  if (cell.status === "ok") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
        <CheckCircle2 className="size-3 text-success" />
        {cell.durationMs !== null && formatDuration(cell.durationMs / 1000)}
      </span>
    );
  }
  return null;
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

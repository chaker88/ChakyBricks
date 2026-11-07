import {
  ChevronDown,
  CircleDot,
  Eraser,
  FileWarning,
  Loader2,
  NotebookPen,
  Pencil,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { CellEditorHandle, RunMode } from "@/components/notebook/cell-editor";
import { InsertBar, NotebookCell } from "@/components/notebook/notebook-cell";
import { RunningKernelsButton } from "@/components/notebook/running-kernels";
import { EmptyState } from "@/components/page";
import { QueryNameDialog } from "@/components/sql/query-name-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys, useCatalog } from "@/hooks/use-api";
import { useKernel, type KernelEvent, type KernelStatus } from "@/hooks/use-kernel";
import { useNotebook, useRenameNotebook, useSaveNotebook } from "@/hooks/use-notebooks";
import { setCompletionTables } from "@/lib/monaco";
import {
  codeToRun,
  fromIpynb,
  makeCell,
  notebookReducer,
  toIpynb,
  type Cell,
  type CellType,
  type NotebookDoc,
} from "@/lib/notebook";
import { cn } from "@/lib/utils";

const SAVE_DELAY_MS = 1000;

export default function NotebookPage() {
  const { name = "" } = useParams();
  const notebook = useNotebook(name);

  if (notebook.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-8 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (notebook.error || !notebook.data) {
    return (
      <div className="flex h-full p-8">
        <EmptyState
          icon={FileWarning}
          title="Notebook not found"
          description={notebook.error?.message ?? `${name} could not be opened.`}
        />
      </div>
    );
  }
  return <NotebookEditor key={name} name={name} initial={fromIpynb(notebook.data)} />;
}

function NotebookEditor({ name, initial }: { name: string; initial: NotebookDoc }) {
  const [doc, dispatch] = useReducer(notebookReducer, initial);
  const [activeId, setActiveId] = useState<string | null>(initial.cells[0]?.id ?? null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [renaming, setRenaming] = useState(false);
  const editors = useRef(new Map<string, CellEditorHandle>());
  const docRef = useRef(doc);
  const dirty = useRef(false);
  const navigate = useNavigate();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const { mutate: saveNotebook } = useSaveNotebook(name);
  const rename = useRenameNotebook();

  const onEvent = useCallback(
    (event: KernelEvent) => {
      switch (event.type) {
        case "started":
          dispatch({ type: "started", id: event.cell_id, executionCount: event.execution_count });
          break;
        case "output":
          dispatch({ type: "output", id: event.cell_id, output: event.output });
          break;
        case "clear_output":
          dispatch({ type: "clear-output", id: event.cell_id, wait: event.wait });
          break;
        case "done":
          dispatch({
            type: "done",
            id: event.cell_id,
            status: event.status,
            durationMs: event.duration_ms,
          });
          void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
          void queryClient.invalidateQueries({ queryKey: ["table"] });
          break;
        case "error":
          if (event.cell_id) {
            dispatch({
              type: "output",
              id: event.cell_id,
              output: {
                output_type: "error",
                ename: "Error",
                evalue: event.message,
                traceback: [],
              },
            });
            dispatch({ type: "done", id: event.cell_id, status: "error", durationMs: null });
          } else toast.error(event.message);
          break;
        case "status":
          if (event.state === "restarting" || event.state === "dead") {
            dispatch({ type: "kernel-reset" });
          }
          break;
      }
    },
    [queryClient],
  );

  const kernel = useKernel(name, onEvent);

  useEffect(() => {
    setCompletionTables(catalog.data?.schemas.flatMap((s) => s.tables) ?? []);
  }, [catalog.data]);

  const saveNow = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    saveNotebook(toIpynb(docRef.current), {
      onSuccess: () => setSaveState(dirty.current ? "saving" : "saved"),
      onError: () => {
        dirty.current = true;
        setSaveState("error");
      },
    });
  }, [saveNotebook]);

  useEffect(() => {
    if (doc === initial) return;
    docRef.current = doc;
    dirty.current = true;
    const timer = setTimeout(saveNow, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc, initial, saveNow]);

  useEffect(() => () => saveNow(), [saveNow]);

  const insertCell = useCallback((index: number, type: CellType, focus = true) => {
    const cell = makeCell(type);
    dispatch({ type: "insert", index, cell });
    setActiveId(cell.id);
    if (focus) setFocusId(cell.id);
    return cell;
  }, []);

  const execute = useCallback(
    (cell: Cell) => {
      if (cell.type === "markdown") {
        dispatch({ type: "editing", id: cell.id, editing: false });
        return;
      }
      const code = codeToRun(cell);
      if (code === null) return;
      if (!kernel.ready) {
        toast("The kernel is not ready yet");
        return;
      }
      dispatch({ type: "queued", id: cell.id });
      if (!kernel.execute(cell.id, code)) {
        dispatch({ type: "done", id: cell.id, status: "aborted", durationMs: null });
        toast.error("Lost connection to the kernel; reconnecting…");
      }
    },
    [kernel],
  );

  const runCell = useCallback(
    (cell: Cell, mode: RunMode) => {
      execute(cell);
      const cells = docRef.current.cells.length ? docRef.current.cells : doc.cells;
      const index = cells.findIndex((c) => c.id === cell.id);
      if (mode === "insert") insertCell(index + 1, "python");
      if (mode === "advance") {
        const next = cells[index + 1];
        if (next) {
          setActiveId(next.id);
          if (next.type === "markdown" && !next.editing) setFocusId(null);
          else editors.current.get(next.id)?.focus();
        } else insertCell(index + 1, "python");
      }
    },
    [execute, insertCell, doc.cells],
  );

  const runAll = () => doc.cells.forEach(execute);

  const restart = async (then?: "clear" | "run") => {
    await kernel.restart();
    if (then === "clear") dispatch({ type: "clear-outputs" });
    if (then === "run") {
      dispatch({ type: "clear-outputs" });
      setTimeout(() => docRef.current.cells.forEach(execute), 0);
    }
  };

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const complete = useCallback(
    (code: string, offset: number) => kernel.complete(code, offset),
    [kernel],
  );

  const running = doc.cells.some((c) => c.status === "running" || c.status === "queued");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <NotebookPen className="size-4 text-primary" />
        <button
          onClick={() => setRenaming(true)}
          className="group flex min-w-0 items-center gap-1.5 text-sm font-semibold"
          title="Rename notebook"
        >
          <span className="truncate">{name}</span>
          <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
        <KernelBadge status={kernel.status} error={kernel.error} />
        <span className="text-[11px] text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved"}
        </span>
        <div className="flex-1" />
        <RunningKernelsButton />
        <Button size="sm" className="h-7 text-xs" disabled={!kernel.ready} onClick={runAll}>
          <Play />
          Run all
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!running}
          onClick={() => void kernel.interrupt()}
        >
          <Square />
          Interrupt
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!kernel.kernelId || kernel.status === "restarting"}
            >
              <RotateCcw />
              Restart
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void restart()}>Restart kernel</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void restart("clear")}>
              Restart and clear outputs
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void restart("run")}>
              Restart and run all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => dispatch({ type: "clear-outputs" })}
        >
          <Eraser />
          Clear outputs
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <InsertBar onInsert={(type) => insertCell(0, type)} />
          {doc.cells.map((cell, index) => (
            <div key={cell.id}>
              <NotebookCell
                ref={(handle) => {
                  if (handle) editors.current.set(cell.id, handle);
                  else editors.current.delete(cell.id);
                }}
                cell={cell}
                index={index}
                count={doc.cells.length}
                active={cell.id === activeId}
                autoFocus={cell.id === focusId}
                dispatch={dispatch}
                onRun={runCell}
                onActivate={setActiveId}
                complete={complete}
              />
              <InsertBar onInsert={(type) => insertCell(index + 1, type)} />
            </div>
          ))}
          <p className="pt-2 pb-8 text-center text-[11px] text-muted-foreground">
            Shift+Enter run and move on · Ctrl+Enter run · Alt+Enter run and insert · use{" "}
            <code className="font-mono">cb.sql()</code>,{" "}
            <code className="font-mono">cb.table()</code>,{" "}
            <code className="font-mono">cb.save()</code>,{" "}
            <code className="font-mono">cb.tables()</code>
          </p>
        </div>
      </div>

      {renaming && (
        <QueryNameDialog
          open
          onOpenChange={setRenaming}
          title="Rename notebook"
          description="The kernel keeps running under the new name."
          initialName={name}
          submitLabel="Rename"
          pending={rename.isPending}
          error={rename.error?.message}
          onSubmit={(newName) => {
            saveNow();
            rename.mutate(
              { name, newName },
              {
                onSuccess: (result) => {
                  setRenaming(false);
                  navigate(`/notebooks/${encodeURIComponent(result.name)}`, { replace: true });
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<KernelStatus, string> = {
  connecting: "Connecting",
  starting: "Starting kernel…",
  idle: "Kernel idle",
  busy: "Kernel busy",
  restarting: "Restarting…",
  dead: "Kernel stopped",
  disconnected: "Reconnecting…",
  error: "Kernel failed",
};

function KernelBadge({ status, error }: { status: KernelStatus; error: string | null }) {
  const tone =
    status === "idle"
      ? "text-success"
      : status === "busy"
        ? "text-primary"
        : status === "dead" || status === "error"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
      title={error ?? undefined}
    >
      {["starting", "restarting", "connecting", "disconnected"].includes(status) ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <CircleDot className={cn("size-3", tone, status === "busy" && "animate-pulse")} />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

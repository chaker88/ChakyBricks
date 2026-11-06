import { Ban, Loader2, Play, Plus, Save, X } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { QueryNameDialog } from "@/components/sql/query-name-dialog";
import { ResultsPanel } from "@/components/sql/results-panel";
import { SqlEditor, type SqlEditorHandle } from "@/components/sql/sql-editor";
import { SqlSidebar } from "@/components/sql/sql-sidebar";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useCatalog } from "@/hooks/use-api";
import { useCreateSavedQuery, useQueryRunner, useUpdateSavedQuery } from "@/hooks/use-sql";
import { disposeModel, setCompletionTables } from "@/lib/monaco";
import { previewSql } from "@/lib/sql-text";
import {
  activeTab,
  isDirty,
  loadTabs,
  newTabId,
  saveTabs,
  tabsReducer,
  type SqlTab,
} from "@/lib/sql-tabs";
import { cn } from "@/lib/utils";

export default function SqlPage() {
  const [state, dispatch] = useReducer(tabsReducer, undefined, loadTabs);
  const { runs, run, cancel, forget } = useQueryRunner();
  const [naming, setNaming] = useState(false);
  const editorRef = useRef<SqlEditorHandle>(null);
  const handledParams = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const catalog = useCatalog();
  const createSaved = useCreateSavedQuery();
  const updateSaved = useUpdateSavedQuery();
  const tab = activeTab(state);
  const current = runs[tab.id];

  useEffect(() => saveTabs(state), [state]);

  useEffect(() => {
    setCompletionTables(catalog.data?.schemas.flatMap((s) => s.tables) ?? []);
  }, [catalog.data]);

  const openInNewTab = useCallback(
    (sql: string, title?: string, execute = false) => {
      const id = newTabId();
      dispatch({ type: "new", id, sql, title });
      if (execute) run(id, sql);
    },
    [run],
  );

  useEffect(() => {
    const key = searchParams.toString();
    if (!key || handledParams.current === key) return;
    handledParams.current = key;
    const table = searchParams.get("table");
    if (table) openInNewTab(previewSql(table), table, true);
    else if (searchParams.has("new")) openInNewTab("");
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, openInNewTab]);

  const closeTab = (closing: SqlTab) => {
    dispatch({ type: "close", id: closing.id });
    disposeModel(closing.id);
    forget(closing.id);
  };

  const save = () => {
    if (!tab.sql.trim()) return;
    if (tab.savedQueryId === null) {
      setNaming(true);
      return;
    }
    const id = tab.id;
    updateSaved.mutate(
      { id: tab.savedQueryId, sql: tab.sql },
      {
        onSuccess: (saved) => {
          dispatch({
            type: "saved",
            id,
            savedQueryId: saved.id,
            title: saved.name,
            sql: saved.sql,
          });
          toast.success(`Saved “${saved.name}”`);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const runTab = (sql: string) => run(tab.id, sql);

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 border-r">
        <SqlSidebar
          onInsert={(text) => editorRef.current?.insert(text)}
          onPreviewTable={(reference) => openInNewTab(previewSql(reference), reference, true)}
          onOpenSaved={(query) =>
            dispatch({
              type: "open-saved",
              savedQueryId: query.id,
              title: query.name,
              sql: query.sql,
            })
          }
          onOpenSql={(sql) => openInNewTab(sql)}
          onSavedDeleted={(id) => dispatch({ type: "forget-saved", savedQueryId: id })}
          onSavedRenamed={(query) => {
            const owner = state.tabs.find((t) => t.savedQueryId === query.id);
            if (owner) {
              dispatch({
                type: "saved",
                id: owner.id,
                savedQueryId: query.id,
                title: query.name,
                sql: owner.sql,
              });
            }
          }}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-muted/40 px-2">
          {state.tabs.map((t) => {
            const active = t.id === tab.id;
            const status = runs[t.id]?.status;
            return (
              <div
                key={t.id}
                onMouseDown={(e) => e.button === 1 && closeTab(t)}
                className={cn(
                  "group flex h-8 max-w-52 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 pr-1 pl-3 text-xs",
                  active
                    ? "-mb-px bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/50",
                )}
              >
                <button
                  className="flex min-w-0 items-center gap-1.5"
                  onClick={() => dispatch({ type: "activate", id: t.id })}
                  title={t.title}
                >
                  {status === "running" && <Loader2 className="size-3 shrink-0 animate-spin" />}
                  <span className="truncate">{t.title}</span>
                  {isDirty(t) && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                </button>
                <button
                  aria-label={`Close ${t.title}`}
                  onClick={() => closeTab(t)}
                  className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
          <button
            aria-label="New query tab"
            onClick={() => openInNewTab("")}
            className="mb-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="45%" minSize="15%">
            <div className="flex h-full flex-col">
              <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={current?.status === "running"}
                  onClick={() => runTab(editorRef.current?.runText() ?? tab.sql)}
                >
                  <Play />
                  Run
                  <span className="opacity-70">Ctrl+Enter</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={current?.status === "running"}
                  onClick={() => runTab(tab.sql)}
                >
                  Run all
                </Button>
                {current?.status === "running" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => cancel(tab.id)}
                  >
                    <Ban />
                    Cancel
                  </Button>
                )}
                <div className="flex-1" />
                <span className="text-[11px] text-muted-foreground">Read-only · DuckDB SQL</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!tab.sql.trim() || updateSaved.isPending}
                  onClick={save}
                >
                  <Save />
                  {tab.savedQueryId === null ? "Save query" : "Save"}
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <SqlEditor
                  ref={editorRef}
                  tabId={tab.id}
                  value={tab.sql}
                  onChange={(sql) => dispatch({ type: "edit", id: tab.id, sql })}
                  onRun={runTab}
                  onSave={save}
                />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="55%" minSize="15%">
            <ResultsPanel run={current} onCancel={() => cancel(tab.id)} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {naming && (
        <QueryNameDialog
          open
          onOpenChange={setNaming}
          title="Save query"
          description="Saved queries appear in the sidebar and can be used as dashboard sources."
          initialName={tab.title.startsWith("Query ") ? "" : tab.title}
          submitLabel="Save"
          pending={createSaved.isPending}
          error={createSaved.error?.message}
          onSubmit={(name) => {
            const id = tab.id;
            const sql = tab.sql;
            createSaved.mutate(
              { name, sql },
              {
                onSuccess: (saved) => {
                  dispatch({ type: "saved", id, savedQueryId: saved.id, title: saved.name, sql });
                  setNaming(false);
                  toast.success(`Saved “${saved.name}”`);
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}

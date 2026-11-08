import {
  CalendarClock,
  Ban,
  CheckCircle2,
  ChevronRight,
  Database,
  FileCode2,
  MoreHorizontal,
  Pencil,
  Play,
  Search,
  Table2,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ScheduleDialog } from "@/components/jobs/schedule-dialog";
import { QueryNameDialog } from "@/components/sql/query-name-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCatalog } from "@/hooks/use-api";
import {
  useClearHistory,
  useDeleteSavedQuery,
  useQueryHistory,
  useSavedQueries,
  useUpdateSavedQuery,
} from "@/hooks/use-sql";
import type { SavedQuery } from "@/lib/api-types";
import { filterCatalog } from "@/lib/catalog";
import { typeIcon } from "@/lib/column-types";
import { formatDateTime, formatDuration, plural } from "@/lib/format";
import { tableReference } from "@/lib/sql-text";
import { cn } from "@/lib/utils";

export function SqlSidebar({
  onInsert,
  onPreviewTable,
  onOpenSaved,
  onOpenSql,
  onSavedDeleted,
  onSavedRenamed,
}: {
  onInsert: (text: string) => void;
  onPreviewTable: (reference: string) => void;
  onOpenSaved: (query: SavedQuery) => void;
  onOpenSql: (sql: string) => void;
  onSavedDeleted: (id: number) => void;
  onSavedRenamed: (query: SavedQuery) => void;
}) {
  return (
    <Tabs defaultValue="schema" className="flex h-full flex-col gap-0">
      <div className="border-b px-3 py-2">
        <TabsList className="w-full">
          <TabsTrigger value="schema" className="text-xs">
            Schema
          </TabsTrigger>
          <TabsTrigger value="saved" className="text-xs">
            Saved
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            History
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="schema" className="min-h-0 flex-1">
        <SchemaBrowser onInsert={onInsert} onPreviewTable={onPreviewTable} />
      </TabsContent>
      <TabsContent value="saved" className="min-h-0 flex-1 overflow-y-auto">
        <SavedList onOpen={onOpenSaved} onDeleted={onSavedDeleted} onRenamed={onSavedRenamed} />
      </TabsContent>
      <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto">
        <HistoryList onOpen={onOpenSql} />
      </TabsContent>
    </Tabs>
  );
}

function SchemaBrowser({
  onInsert,
  onPreviewTable,
}: {
  onInsert: (text: string) => void;
  onPreviewTable: (reference: string) => void;
}) {
  const { data, isLoading } = useCatalog();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const filtered = data ? filterCatalog(data, query) : null;
  const searching = query.trim() !== "";

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter"
            className="h-7 pl-8 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 text-[13px]">
        {isLoading || !filtered ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : filtered.schemas.every((s) => s.tables.length === 0) ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {searching ? "No matches" : "No tables yet. Import data from the Catalog."}
          </p>
        ) : (
          filtered.schemas
            .filter((s) => s.tables.length > 0)
            .map((schema) => (
              <div key={schema.name} className="mb-1">
                <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-muted-foreground">
                  <Database className="size-3" />
                  {schema.name}
                </div>
                {schema.tables.map((table) => {
                  const key = `${schema.name}.${table.name}`;
                  const reference = tableReference(schema.name, table.name);
                  const open = searching || expanded.has(key);
                  return (
                    <div key={key}>
                      <div className="group flex items-center rounded-md hover:bg-accent/60">
                        <button
                          aria-label={open ? "Hide columns" : "Show columns"}
                          onClick={() => toggle(key)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                        >
                          <ChevronRight
                            className={cn("size-3.5 transition-transform", open && "rotate-90")}
                          />
                        </button>
                        <button
                          title={`Insert ${reference}`}
                          onClick={() => onInsert(reference)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                        >
                          <Table2 className="size-3.5 shrink-0 text-primary" />
                          <span className="truncate">{table.name}</span>
                        </button>
                        <button
                          title="Preview in a new tab"
                          onClick={() => onPreviewTable(reference)}
                          className="mr-1 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                        >
                          <Play className="size-3" />
                        </button>
                      </div>
                      {open && (
                        <div className="ml-5 border-l py-0.5 pl-1.5">
                          {table.columns.map((column) => {
                            const Icon = typeIcon(column.type);
                            return (
                              <button
                                key={column.name}
                                title={`Insert ${column.name}`}
                                onClick={() => onInsert(column.name)}
                                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/60"
                              >
                                <Icon className="size-3 shrink-0 text-muted-foreground" />
                                <span className="truncate">{column.name}</span>
                                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                  {column.type}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function SavedList({
  onOpen,
  onDeleted,
  onRenamed,
}: {
  onOpen: (query: SavedQuery) => void;
  onDeleted: (id: number) => void;
  onRenamed: (query: SavedQuery) => void;
}) {
  const { data, isLoading } = useSavedQueries();
  const [renaming, setRenaming] = useState<SavedQuery | null>(null);
  const [scheduling, setScheduling] = useState<SavedQuery | null>(null);
  const [deleting, setDeleting] = useState<SavedQuery | null>(null);
  const update = useUpdateSavedQuery();
  const remove = useDeleteSavedQuery();

  if (isLoading) return <Skeleton className="m-3 h-16" />;
  if (!data?.length) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        No saved queries yet. Press <span className="font-medium">Ctrl + S</span> in the editor to
        save one; dashboards are built from saved queries.
      </p>
    );
  }

  return (
    <div className="p-1.5">
      {data.map((query) => (
        <div key={query.id} className="group flex items-start rounded-md hover:bg-accent/60">
          <button
            onClick={() => onOpen(query)}
            className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
          >
            <FileCode2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block truncate text-[13px]">{query.name}</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                {firstLine(query.sql)}
              </span>
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="m-1 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground data-[state=open]:opacity-100">
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(query)}>
                <Pencil />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setScheduling(query)}>
                <CalendarClock />
                Schedule…
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(query)}>
                <Trash2 />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {scheduling && (
        <ScheduleDialog
          kind="query"
          target={String(scheduling.id)}
          name={scheduling.name}
          onClose={() => setScheduling(null)}
        />
      )}
      {renaming && (
        <QueryNameDialog
          open
          onOpenChange={(open) => !open && setRenaming(null)}
          title="Rename query"
          description="Dashboards that use this query keep working."
          initialName={renaming.name}
          submitLabel="Rename"
          pending={update.isPending}
          error={update.error?.message}
          onSubmit={(name) =>
            update.mutate(
              { id: renaming.id, name },
              {
                onSuccess: (saved) => {
                  onRenamed(saved);
                  setRenaming(null);
                },
              },
            )
          }
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved query is removed. Open tabs keep their SQL as unsaved queries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, {
                  onSuccess: () => onDeleted(deleting.id),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HistoryList({ onOpen }: { onOpen: (sql: string) => void }) {
  const { data, isLoading } = useQueryHistory();
  const clear = useClearHistory();

  if (isLoading) return <Skeleton className="m-3 h-16" />;
  if (!data?.length) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        Queries you run appear here.
      </p>
    );
  }

  return (
    <div className="p-1.5">
      <div className="flex justify-end px-1 pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground"
          onClick={() => clear.mutate()}
        >
          Clear history
        </Button>
      </div>
      {data.map((entry) => {
        const Icon =
          entry.status === "succeeded" ? CheckCircle2 : entry.status === "failed" ? XCircle : Ban;
        return (
          <button
            key={entry.id}
            onClick={() => onOpen(entry.sql)}
            title={entry.error ?? entry.sql}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
          >
            <Icon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                entry.status === "succeeded" && "text-success",
                entry.status === "failed" && "text-destructive",
                entry.status === "cancelled" && "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-mono text-[11px] break-all">{entry.sql}</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {formatDateTime(entry.started_at)} · {formatDuration(entry.duration_ms / 1000)}
                {entry.row_count !== null && ` · ${plural(entry.row_count, "row")}`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function firstLine(sql: string): string {
  return (
    sql
      .trim()
      .split("\n")
      .find((l) => l.trim() && !l.trim().startsWith("--")) ?? ""
  );
}

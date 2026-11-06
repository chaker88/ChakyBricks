import {
  Code2,
  History,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Table2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { DataPreview } from "@/components/data-preview";
import { EmptyState } from "@/components/page";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useDropTable,
  useRenameTable,
  useTable,
  useTableHistory,
  useTableSample,
} from "@/hooks/use-api";
import type { HistoryEntry, TableDetail } from "@/lib/api-types";
import { typeIcon } from "@/lib/column-types";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { identifierError } from "@/lib/import";
import { cn } from "@/lib/utils";
import { Stat } from "@/routes/catalog";

export function TablePage() {
  const { schema = "", table = "" } = useParams();
  const { data, error, isLoading } = useTable(schema, table);
  const [tab, setTab] = useState("schema");

  if (isLoading) return <TableSkeleton />;
  if (error || !data) {
    return (
      <div className="flex h-full p-8">
        <EmptyState
          icon={Table2}
          title="Table not found"
          description={error?.message ?? `${schema}.${table} does not exist.`}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-8 py-7">
      <TableHeader key={`${data.schema}.${data.name}`} table={data} />
      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="Rows" value={formatNumber(data.row_count)} />
        <Stat label="Size on disk" value={formatBytes(data.size_bytes)} />
        <Stat label="Columns" value={formatNumber(data.columns.length)} />
        <Stat label="Version" value={`v${data.version}`} hint={formatDateTime(data.updated_at)} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6 flex-1">
        <TabsList>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="sample">Sample data</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="schema" className="mt-3">
          <SchemaTab table={data} />
        </TabsContent>
        <TabsContent value="sample" className="mt-3">
          <SampleTab schema={schema} table={table} enabled={tab === "sample"} />
        </TabsContent>
        <TabsContent value="history" className="mt-3">
          <HistoryTab table={data} enabled={tab === "history"} />
        </TabsContent>
        <TabsContent value="details" className="mt-3">
          <DetailsTab table={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TableHeader({ table }: { table: TableDetail }) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fullName = `${table.schema}.${table.name}`;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{table.schema}</div>
        <h1 className="mt-0.5 flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Table2 className="size-5 text-primary" />
          <span className="truncate">{table.name}</span>
          <Badge variant="secondary" className="font-normal">
            Delta
          </Badge>
          {table.partition_columns.length > 0 && (
            <Badge variant="outline" className="font-normal">
              partitioned by {table.partition_columns.join(", ")}
            </Badge>
          )}
        </h1>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={() => navigate(`/sql?table=${fullName}`)}>
          <Code2 />
          Open in SQL
        </Button>
        <Button variant="outline" onClick={() => navigate(`/notebooks?table=${fullName}`)}>
          <NotebookPen />
          Open in notebook
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil />
              Rename…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDropping(true)}>
              <Trash2 />
              Drop table…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <RenameDialog table={table} open={renaming} onOpenChange={setRenaming} />
      <DropDialog table={table} open={dropping} onOpenChange={setDropping} />
    </div>
  );
}

function SchemaTab({ table }: { table: TableDetail }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-12 px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Column</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {table.columns.map((column, i) => {
            const Icon = typeIcon(column.type);
            return (
              <tr key={column.name} className="border-t">
                <td className="px-4 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2 font-medium select-text">
                    <Icon className="size-3.5 text-muted-foreground" />
                    {column.name}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{column.type}</td>
                <td className="px-4 py-2 text-right">
                  {table.partition_columns.includes(column.name) && (
                    <Badge variant="outline" className="font-normal">
                      partition
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SampleTab({
  schema,
  table,
  enabled,
}: {
  schema: string;
  table: string;
  enabled: boolean;
}) {
  const { data, isLoading, error } = useTableSample(schema, table, null, enabled);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <ErrorBox message={error.message} />;
  return data ? <DataPreview data={data} className="max-h-[60vh]" /> : null;
}

function HistoryTab({ table, enabled }: { table: TableDetail; enabled: boolean }) {
  const history = useTableHistory(table.schema, table.name, enabled);
  const [selected, setSelected] = useState<number | null>(null);
  const sample = useTableSample(table.schema, table.name, selected, selected !== null);

  if (history.isLoading) return <Skeleton className="h-40 w-full" />;
  if (history.error) return <ErrorBox message={history.error.message} />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 font-medium">Timestamp</th>
              <th className="px-4 py-2 font-medium">Operation</th>
              <th className="px-4 py-2 font-medium">Details</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {history.data?.map((entry) => (
              <tr
                key={entry.version}
                className={cn("border-t", selected === entry.version && "bg-accent/50")}
              >
                <td className="px-4 py-2 font-medium tabular-nums">
                  v{entry.version}
                  {entry.version === table.version && (
                    <Badge variant="secondary" className="ml-2 font-normal">
                      current
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </td>
                <td className="px-4 py-2">{entry.operation ?? "—"}</td>
                <td className="max-w-xs truncate px-4 py-2 text-xs text-muted-foreground">
                  {describeEntry(entry)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(selected === entry.version ? null : entry.version)}
                  >
                    <History />
                    {selected === entry.version ? "Hide" : "View data"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected !== null && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Data as of version {selected} (first 100 rows). In notebooks use
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono select-text">
              cb.table("{table.schema}.{table.name}", version={selected})
            </code>
            {sample.isFetching && <Loader2 className="size-3 animate-spin" />}
          </div>
          {sample.error ? (
            <ErrorBox message={sample.error.message} />
          ) : sample.data ? (
            <DataPreview data={sample.data} className="max-h-[50vh]" />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
      )}
    </div>
  );
}

function describeEntry(entry: HistoryEntry): string {
  const metrics = entry.metrics;
  const parts: string[] = [];
  const mode = entry.parameters["mode"];
  if (typeof mode === "string") parts.push(`mode ${mode}`);
  const added = metrics["num_added_rows"] ?? metrics["numOutputRows"];
  if (typeof added === "number") parts.push(`${formatNumber(added)} rows added`);
  const files = metrics["num_added_files"] ?? metrics["numFiles"];
  if (typeof files === "number") parts.push(`${formatNumber(files)} files`);
  return parts.join(" · ") || "—";
}

function DetailsTab({ table }: { table: TableDetail }) {
  const rows: [string, string][] = [
    ["Full name", `${table.schema}.${table.name}`],
    ["Location", table.location],
    ["Imported from", table.source ?? "—"],
    ["Created", formatDateTime(table.created_at)],
    ["Last updated", formatDateTime(table.updated_at)],
    ["Format", "Delta Lake"],
  ];
  return (
    <dl className="divide-y rounded-lg border text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-6 px-4 py-2.5">
          <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 font-mono text-xs leading-5 break-all select-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RenameDialog({
  table,
  open,
  onOpenChange,
}: {
  table: TableDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [schema, setSchema] = useState(table.schema);
  const [name, setName] = useState(table.name);
  const rename = useRenameTable();
  const navigate = useNavigate();
  const error = identifierError(schema, "schema name") ?? identifierError(name, "table name");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (error) return;
    rename.mutate(
      { schema: table.schema, name: table.name, newSchema: schema, newName: name },
      {
        onSuccess: (renamed) => {
          onOpenChange(false);
          toast.success(`Renamed to ${renamed.schema}.${renamed.name}`);
          navigate(`/catalog/${renamed.schema}/${renamed.name}`, { replace: true });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename table</DialogTitle>
            <DialogDescription>
              Move {table.schema}.{table.name} to a new name or schema. New schemas are created
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              value={schema}
              aria-label="Schema"
              className="w-40"
              onChange={(e) => setSchema(e.target.value.toLowerCase())}
            />
            <span className="text-muted-foreground">.</span>
            <Input
              autoFocus
              value={name}
              aria-label="Table name"
              onChange={(e) => setName(e.target.value.toLowerCase())}
            />
          </div>
          <p className="min-h-4 text-xs text-destructive">{error ?? rename.error?.message}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!error || rename.isPending}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DropDialog({
  table,
  open,
  onOpenChange,
}: {
  table: TableDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const drop = useDropTable();
  const navigate = useNavigate();
  const fullName = `${table.schema}.${table.name}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop {fullName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the table, its {formatNumber(table.row_count)} rows and its
            version history ({formatBytes(table.size_bytes)} on disk). The original source file is
            not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={drop.isPending}
            onClick={(event) => {
              event.preventDefault();
              drop.mutate(
                { schema: table.schema, name: table.name },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    toast.success(`Dropped ${fullName}`);
                    navigate("/catalog", { replace: true });
                  },
                  onError: (error) => toast.error(error.message),
                },
              );
            }}
          >
            Drop table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive select-text">
      {message}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-7">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCatalog } from "@/hooks/use-api";
import { useSaveAsTable } from "@/hooks/use-sql";
import { identifierError } from "@/lib/import";
import { useImport } from "@/lib/import-context";
import { cn } from "@/lib/utils";

export function SaveTableDialog({
  sql,
  open,
  onOpenChange,
}: {
  sql: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [schema, setSchema] = useState("main");
  const [table, setTable] = useState("");
  const [mode, setMode] = useState<"overwrite" | "append">("overwrite");
  const catalog = useCatalog();
  const save = useSaveAsTable();
  const { trackJob } = useImport();

  const exists = !!catalog.data?.schemas
    .find((s) => s.name === schema)
    ?.tables.some((t) => t.name === table);
  const error = identifierError(schema, "schema name") ?? identifierError(table, "table name");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (error) return;
    save.mutate(
      { sql, schema_name: schema, table, mode: exists ? mode : "create" },
      {
        onSuccess: (job) => {
          trackJob(job.id);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Save result as table</DialogTitle>
            <DialogDescription>
              Runs the query again over all rows and writes the full result to a Delta table. Column
              names are cleaned so they work in SQL and Python without quotes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Table</Label>
            <div className="flex items-center gap-2">
              <Input
                value={schema}
                aria-label="Schema"
                list="save-table-schemas"
                className="w-36"
                onChange={(e) => setSchema(e.target.value.toLowerCase())}
              />
              <datalist id="save-table-schemas">
                {catalog.data?.schemas.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
              <span className="text-muted-foreground">.</span>
              <Input
                autoFocus
                value={table}
                aria-label="Table name"
                placeholder="table_name"
                onChange={(e) => setTable(e.target.value.toLowerCase())}
              />
            </div>
          </div>
          {exists && (
            <div className="space-y-1.5">
              <Label className="text-xs">Table already exists</Label>
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {(["overwrite", "append"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setMode(value)}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      mode === value
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value === "overwrite" ? "Replace table" : "Append rows"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="min-h-4 text-xs text-destructive">
            {(table && error) || save.error?.message}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!error || save.isPending}>
              {exists ? (mode === "overwrite" ? "Replace table" : "Append rows") : "Create table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

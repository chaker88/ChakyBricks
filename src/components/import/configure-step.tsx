import { Loader2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { DataPreview } from "@/components/data-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCatalog, useClient, usePreview, useStartImport } from "@/hooks/use-api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { ImportMode, PreviewResponse, SourceOptions } from "@/lib/api-types";
import { typeIcon } from "@/lib/column-types";
import { formatBytes, formatNumber } from "@/lib/format";
import {
  DELIMITERS,
  buildImportRequest,
  columnErrors,
  createDraft,
  draftErrors,
  fileName,
  includedColumns,
  typeOptions,
  type DraftColumn,
  type ImportDraft,
} from "@/lib/import";
import { cn } from "@/lib/utils";

const NEW_SCHEMA = "__new__";
const NO_PARTITION = "__none__";

export function ConfigureStep({
  preview,
  onBack,
  onStarted,
}: {
  preview: PreviewResponse;
  onBack: () => void;
  onStarted: (jobId: string) => void;
}) {
  const [draft, setDraft] = useState<ImportDraft>(() => createDraft(preview));
  const [sourceColumns, setSourceColumns] = useState(preview.source_columns);
  const [reloading, setReloading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [newSchema, setNewSchema] = useState(false);
  const client = useClient();
  const catalog = useCatalog();
  const start = useStartImport();

  const changeOptions = async (options: SourceOptions) => {
    if (!client) return;
    setDraft((d) => ({ ...d, options }));
    setReloading(true);
    try {
      const fresh = await client.post<PreviewResponse>("/api/imports/preview", {
        path: preview.path,
        options,
      });
      setSourceColumns(fresh.source_columns);
      setDraft((d) => ({
        ...d,
        partitionBy: null,
        columns: fresh.source_columns.map((c) => ({ ...c, include: true })),
      }));
      setOptionsError(null);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : String(error));
    } finally {
      setReloading(false);
    }
  };

  const update = (changes: Partial<ImportDraft>) => setDraft((d) => ({ ...d, ...changes }));
  const updateColumn = (index: number, changes: Partial<DraftColumn>) =>
    setDraft((d) => ({
      ...d,
      columns: d.columns.map((c, i) => (i === index ? { ...c, ...changes } : c)),
    }));

  const schemas = catalog.data?.schemas ?? [];
  const tableExists = schemas.some(
    (s) => s.name === draft.schema && s.tables.some((t) => t.name === draft.table),
  );
  const mode: ImportMode = tableExists
    ? draft.mode === "create"
      ? "append"
      : draft.mode
    : "create";
  const effectiveDraft = { ...draft, mode };
  const errors = draftErrors(effectiveDraft);
  const perColumnErrors = columnErrors(draft.columns);
  const included = draft.columns.filter((c) => c.include);

  const requestKey =
    reloading || optionsError || perColumnErrors.size > 0 || included.length === 0
      ? null
      : JSON.stringify({ options: draft.options, columns: includedColumns(draft) });
  const previewRequest = useMemo(
    () => (requestKey ? { path: preview.path, ...JSON.parse(requestKey) } : null),
    [requestKey, preview.path],
  );
  const debouncedRequest = useDebouncedValue(previewRequest, 400);
  const livePreview = usePreview(debouncedRequest);
  const sample = livePreview.data?.sample ?? preview.sample;
  const previewError = optionsError ?? livePreview.error?.message ?? null;
  const isText = preview.format === "csv" || preview.format === "tsv";

  const submit = () =>
    start.mutate(buildImportRequest(preview, effectiveDraft), {
      onSuccess: (job) => onStarted(job.id),
    });

  return (
    <>
      <div className="flex items-center gap-3 border-b px-6 py-4 pr-12">
        <div className="min-w-0">
          <DialogTitle className="truncate">Import {fileName(preview.path)}</DialogTitle>
          <DialogDescription className="mt-1 flex items-center gap-2 truncate text-xs">
            <Badge variant="secondary" className="uppercase">
              {preview.format}
            </Badge>
            <span>{formatBytes(preview.file_size)}</span>
            {preview.estimated_rows !== null && (
              <span>· ~{formatNumber(preview.estimated_rows)} rows</span>
            )}
            <span className="truncate">· {preview.path}</span>
          </DialogDescription>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 space-y-6 overflow-y-auto border-r p-5">
          <Section title="Destination">
            <Field label="Schema">
              {newSchema ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={draft.schema}
                    placeholder="new_schema"
                    onChange={(e) => update({ schema: e.target.value.toLowerCase() })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNewSchema(false);
                      update({ schema: "main" });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Select
                  value={draft.schema}
                  onValueChange={(value) => {
                    if (value === NEW_SCHEMA) {
                      setNewSchema(true);
                      update({ schema: "" });
                    } else update({ schema: value });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(schemas.length ? schemas.map((s) => s.name) : ["main"]).map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SCHEMA}>New schema…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Table name">
              <Input
                value={draft.table}
                onChange={(e) => update({ table: e.target.value.toLowerCase() })}
              />
            </Field>
            {tableExists && (
              <Field label="Table already exists">
                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {(["append", "overwrite"] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => update({ mode: value })}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                        mode === value
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {value === "append" ? "Append rows" : "Replace table"}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field
              label="Partition by"
              hint="Optional. Pick a low-cardinality column such as a date or region."
            >
              <Select
                value={draft.partitionBy ?? NO_PARTITION}
                disabled={mode === "append"}
                onValueChange={(value) =>
                  update({ partitionBy: value === NO_PARTITION ? null : value })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARTITION}>No partitioning</SelectItem>
                  {included.map((c) => (
                    <SelectItem key={c.source} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          {(isText || preview.format === "excel") && (
            <Section title="File options">
              {isText && (
                <Field label="Delimiter">
                  <Select
                    value={draft.options.delimiter ?? "auto"}
                    onValueChange={(value) =>
                      changeOptions({
                        ...draft.options,
                        delimiter: value === "auto" ? null : value,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DELIMITERS.map((d) => (
                        <SelectItem key={d.label} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.options.header}
                  onCheckedChange={(checked) =>
                    changeOptions({ ...draft.options, header: checked === true })
                  }
                />
                First row is a header
              </label>
            </Section>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
          <div className="flex max-h-[45%] min-h-0 flex-col">
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Columns · {included.length} of {draft.columns.length}
            </h3>
            <div className="min-h-0 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={
                          included.length === draft.columns.length
                            ? true
                            : included.length === 0
                              ? false
                              : "indeterminate"
                        }
                        onCheckedChange={(checked) =>
                          update({
                            columns: draft.columns.map((c) => ({
                              ...c,
                              include: checked === true,
                            })),
                          })
                        }
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Column name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.columns.map((column, index) => {
                    const inferred = sourceColumns[index] ?? column;
                    const Icon = typeIcon(column.type);
                    const error = perColumnErrors.get(index);
                    return (
                      <tr
                        key={column.source}
                        className={cn("border-t", !column.include && "opacity-50")}
                      >
                        <td className="px-3 py-1.5">
                          <Checkbox
                            checked={column.include}
                            onCheckedChange={(checked) =>
                              updateColumn(index, { include: checked === true })
                            }
                          />
                        </td>
                        <td className="max-w-48 truncate px-3 py-1.5 text-muted-foreground">
                          {column.source}
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            value={column.name}
                            disabled={!column.include}
                            aria-invalid={!!error}
                            title={error}
                            className="h-7 text-xs"
                            onChange={(e) => updateColumn(index, { name: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Select
                            value={column.type}
                            disabled={!column.include}
                            onValueChange={(type) => updateColumn(index, { type })}
                          >
                            <SelectTrigger size="sm" className="h-7 w-52 text-xs">
                              <Icon className="size-3.5 text-muted-foreground" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {typeOptions(preview.editable_types, column.type, inferred.type).map(
                                (type) => (
                                  <SelectItem key={type} value={type} className="text-xs">
                                    {type}
                                    {type === inferred.type && (
                                      <span className="text-muted-foreground">(detected)</span>
                                    )}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Preview · first {sample.rows.length} rows
              {(livePreview.isFetching || reloading) && <Loader2 className="size-3 animate-spin" />}
            </h3>
            {previewError ? (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs break-words text-destructive select-text">
                {previewError}
              </div>
            ) : (
              <DataPreview data={sample} className="min-h-0 flex-1" />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t px-6 py-3">
        <p className="min-w-0 flex-1 truncate text-xs text-destructive">
          {start.error?.message ?? errors[0] ?? ""}
        </p>
        <Button variant="ghost" onClick={onBack}>
          Choose another file
        </Button>
        <Button
          disabled={errors.length > 0 || !!previewError || reloading || start.isPending}
          onClick={submit}
        >
          {start.isPending && <Loader2 className="animate-spin" />}
          {mode === "append"
            ? "Append to table"
            : mode === "overwrite"
              ? "Replace table"
              : "Import"}
        </Button>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

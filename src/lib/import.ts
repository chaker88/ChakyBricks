import type {
  ColumnSpec,
  ImportMode,
  ImportRequest,
  ImportState,
  PreviewResponse,
  SourceOptions,
} from "@/lib/api-types";

export const DATA_FILE_EXTENSIONS = [
  "csv",
  "tsv",
  "txt",
  "tab",
  "parquet",
  "pq",
  "json",
  "ndjson",
  "jsonl",
  "xlsx",
];

export const DELIMITERS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: ",", label: "Comma (,)" },
  { value: ";", label: "Semicolon (;)" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe (|)" },
];

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const COLUMN_RE = /^[\p{L}_][\p{L}\p{Mn}\p{Mc}\p{Nd}_]{0,127}$/u;

export interface DraftColumn extends ColumnSpec {
  include: boolean;
}

export interface ImportDraft {
  schema: string;
  table: string;
  mode: ImportMode;
  partitionBy: string | null;
  options: SourceOptions;
  columns: DraftColumn[];
}

export function createDraft(preview: PreviewResponse, schema = "main"): ImportDraft {
  return {
    schema,
    table: preview.suggested_table,
    mode: "create",
    partitionBy: null,
    options: { delimiter: null, header: true, sheet: null },
    columns: preview.source_columns.map((c) => ({ ...c, include: true })),
  };
}

export function identifierError(value: string, kind: string): string | null {
  if (!value) return `Enter a ${kind}`;
  if (value.startsWith("__") || !IDENTIFIER_RE.test(value)) {
    return `Use lowercase letters, digits and underscores, starting with a letter`;
  }
  if (
    kind === "schema name" &&
    ["temp", "information_schema", "pg_catalog", "system"].includes(value)
  ) {
    return `'${value}' is reserved`;
  }
  return null;
}

export function columnErrors(columns: DraftColumn[]): Map<number, string> {
  const errors = new Map<number, string>();
  const seen = new Map<string, number>();
  columns.forEach((column, index) => {
    if (!column.include) return;
    if (!COLUMN_RE.test(column.name)) {
      errors.set(index, "Letters, digits and _ only, starting with a letter or _");
      return;
    }
    const key = column.name.toLowerCase();
    if (seen.has(key)) errors.set(index, "Duplicate name");
    else seen.set(key, index);
  });
  return errors;
}

export function draftErrors(draft: ImportDraft): string[] {
  const errors = [
    identifierError(draft.schema, "schema name"),
    identifierError(draft.table, "table name"),
  ].filter((e): e is string => e !== null);
  const included = draft.columns.filter((c) => c.include);
  if (included.length === 0) errors.push("Select at least one column");
  if (columnErrors(draft.columns).size > 0) errors.push("Fix the highlighted column names");
  if (draft.partitionBy && !included.some((c) => c.name === draft.partitionBy)) {
    errors.push("The partition column must be one of the imported columns");
  }
  return errors;
}

export function includedColumns(draft: ImportDraft): ColumnSpec[] {
  return draft.columns
    .filter((c) => c.include)
    .map(({ source, name, type }) => ({ source, name, type }));
}

export function buildImportRequest(preview: PreviewResponse, draft: ImportDraft): ImportRequest {
  return {
    path: preview.path,
    format: preview.format,
    options: draft.options,
    columns: includedColumns(draft),
    schema_name: draft.schema,
    table: draft.table,
    partition_by: draft.partitionBy,
    mode: draft.mode,
  };
}

export function typeOptions(editable: string[], current: string, inferred: string): string[] {
  return [...new Set([inferred, current, ...editable])];
}

export function isTerminal(state: ImportState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

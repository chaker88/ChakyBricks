export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableSummary {
  schema: string;
  name: string;
  version: number;
  row_count: number;
  size_bytes: number;
  updated_at: string;
  columns: ColumnInfo[];
}

export interface TableDetail extends TableSummary {
  location: string;
  source: string | null;
  created_at: string;
  partition_columns: string[];
}

export interface CatalogResponse {
  schemas: { name: string; tables: TableSummary[] }[];
}

export type CellValue =
  string | number | boolean | null | CellValue[] | { [key: string]: CellValue };

export interface RowSet {
  columns: ColumnInfo[];
  rows: CellValue[][];
}

export interface HistoryEntry {
  version: number;
  timestamp: number | null;
  operation: string | null;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export type SourceFormat = "csv" | "tsv" | "parquet" | "json" | "excel";
export type ImportMode = "create" | "overwrite" | "append";
export type ImportState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface SourceOptions {
  delimiter: string | null;
  header: boolean;
  sheet: string | null;
}

export interface ColumnSpec {
  source: string;
  name: string;
  type: string;
}

export interface PreviewResponse {
  path: string;
  format: SourceFormat;
  file_size: number;
  suggested_table: string;
  estimated_rows: number | null;
  source_columns: ColumnSpec[];
  editable_types: string[];
  sample: RowSet;
}

export interface ImportRequest {
  path: string;
  format: SourceFormat;
  options: SourceOptions;
  columns: ColumnSpec[];
  schema_name: string;
  table: string;
  partition_by: string | null;
  mode: ImportMode;
}

export interface ImportJob {
  id: string;
  state: ImportState;
  schema: string;
  table: string;
  source: string;
  rows_written: number;
  estimated_rows: number | null;
  progress: number | null;
  error: string | null;
  elapsed_seconds: number;
}

export interface AppSettings {
  workspace: string;
  memory_limit_mb: number | null;
  effective_memory_limit_mb: number;
  default_memory_limit_mb: number;
  total_memory_mb: number;
  row_limit: number;
  kernel_memory_percent: number;
  kernel_memory_limit_mb: number;
}

export interface WriteOutcome {
  action: "create" | "replace" | "append" | "drop" | "rename" | "skipped";
  table: string;
  message: string;
  rows_written: number | null;
  version: number | null;
}

export interface QueryResult extends RowSet {
  query_id: string;
  kind: "rows" | "write";
  message?: string;
  writes: WriteOutcome[];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
  statement_count: number;
}

export interface ColumnStats {
  column: string;
  type: string;
  rows: number;
  nulls: number;
  distinct: number;
  numeric: boolean;
  min?: CellValue;
  max?: CellValue;
  mean?: number | null;
  stddev?: number | null;
  p25?: number | null;
  median?: number | null;
  p75?: number | null;
  top_values: { value: CellValue; count: number }[];
}

export interface SavedQuery {
  id: number;
  name: string;
  sql: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface QueryHistoryEntry {
  id: number;
  sql: string;
  started_at: string;
  duration_ms: number;
  status: "succeeded" | "failed" | "cancelled";
  row_count: number | null;
  error: string | null;
}

export interface ExportResult {
  path: string;
  size_bytes: number;
  elapsed_ms: number;
}

export interface KernelSummary {
  id: string;
  notebook: string;
  status: string;
  pid: number | null;
  started_at: string;
  memory_bytes: number | null;
  memory_limit_mb: number;
}

export interface PackageInfo {
  name: string;
  version: string;
  overridden?: boolean;
}

export interface PackageListing {
  environment: {
    path: string;
    python: string;
    python_version: string;
    ready: boolean;
    created_at: string | null;
  };
  installed: PackageInfo[];
  defaults: PackageInfo[];
}

export interface PackageJob {
  id: string;
  action: "install" | "uninstall" | "reset";
  packages: string[];
  state: "queued" | "running" | "succeeded" | "failed";
  output: string;
  error: string | null;
  elapsed_seconds: number;
}

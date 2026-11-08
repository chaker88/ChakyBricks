import type { CellValue, ColumnInfo } from "@/lib/api-types";

export type Grain = "day" | "week" | "month" | "quarter" | "year";
export type Aggregation = "sum" | "avg" | "count" | "count_distinct" | "min" | "max";
export type ChartKind =
  "bar" | "stacked_bar" | "line" | "area" | "pie" | "donut" | "scatter" | "heatmap" | "combo";
export type TileType = "chart" | "kpi" | "table" | "text";
export type PaletteName = "classic" | "sunset" | "lagoon" | "twilight";
export type BackgroundName = "default" | "muted" | "canvas";
export type FormatType = "auto" | "number" | "compact" | "percent" | "currency";

export interface NumberFormat {
  type: FormatType;
  decimals?: number | null;
  currency?: string;
}

export interface Source {
  kind: "table" | "query";
  table?: string | null;
  query_id?: number | null;
}

export interface FieldRef {
  column: string;
  grain?: Grain | null;
}

export interface Metric {
  agg: Aggregation;
  column: string | null;
  label?: string;
  format?: NumberFormat;
  shape?: "bar" | "line" | null;
  axis?: "left" | "right";
}

export interface Sort {
  by: "dimension" | "metric";
  index: number;
  direction: "asc" | "desc";
}

export interface Compare {
  mode: "previous_period" | "previous_year";
  column: string;
}

export interface TileConfig {
  chart?: ChartKind;
  dimension?: FieldRef | null;
  breakdown?: FieldRef | null;
  dimensions?: FieldRef[];
  metrics?: Metric[];
  sort?: Sort | null;
  limit?: number | null;
  compare?: Compare | null;
  trend?: FieldRef | null;
  text?: string;
  labels?: boolean;
  /** Per-tile colour overrides: series name → palette slot. */
  colors?: Record<string, number>;
  lowerIsBetter?: boolean;
}

export interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileSpec {
  id: string;
  type: TileType;
  title: string;
  layout: Layout;
  source?: Source | null;
  config: TileConfig;
}

export type FilterType = "date_range" | "select" | "number_range";

export interface FilterSpec {
  id: string;
  type: FilterType;
  label: string;
  source: Source;
  column: string;
  multi?: boolean;
  default?: FilterValue | null;
}

export interface FilterValue {
  preset?: string;
  start?: string | null;
  end?: string | null;
  values?: (string | number | boolean | null)[];
  minimum?: number | null;
  maximum?: number | null;
}

export interface DashboardSpec {
  version: number;
  theme: { palette: PaletteName; background: BackgroundName };
  refresh_seconds: number | null;
  cross_filter: boolean;
  filters: FilterSpec[];
  tiles: TileSpec[];
}

export interface DashboardSummary {
  id: number;
  name: string;
  description: string;
  tile_count: number;
  filter_count: number;
  created_at: string;
  updated_at: string;
}

export interface Dashboard {
  id: number;
  name: string;
  description: string;
  spec: DashboardSpec;
  created_at: string;
  updated_at: string;
}

export interface Condition {
  column: string;
  kind: "date_range" | "in" | "number_range";
  start?: string | null;
  end?: string | null;
  values?: (string | number | boolean | null)[];
  minimum?: number | null;
  maximum?: number | null;
  grain?: Grain | null;
}

export interface TileComparison {
  previous: number | null;
  change: number | null;
  percent: number | null;
  label: string;
}

export interface TileData {
  columns: ColumnInfo[];
  rows: CellValue[][];
  truncated: boolean;
  series_truncated?: boolean;
  cached: boolean;
  elapsed_ms: number;
  comparison?: TileComparison | null;
  note?: string | null;
  trend?: { columns: ColumnInfo[]; rows: CellValue[][] } | null;
}

export type FilterOptions =
  | { kind: "values"; type: string; values: CellValue[]; truncated: boolean }
  | { kind: "range"; type: string; minimum: CellValue; maximum: CellValue };

export interface CrossFilter {
  tileId: string;
  conditions: Condition[];
  labels: string[];
}

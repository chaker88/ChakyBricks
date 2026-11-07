import type {
  Condition,
  CrossFilter,
  DashboardSpec,
  FilterSpec,
  FilterValue,
  Layout,
  TileConfig,
  TileSpec,
  TileType,
} from "@/lib/dashboard-types";
import { toISODate } from "@/lib/number-format";

export const GRID_COLUMNS = 24;
export const ROW_HEIGHT = 30;
export const GRID_MARGIN = 12;

export const EMPTY_SPEC: DashboardSpec = {
  version: 1,
  theme: { palette: "classic", background: "default" },
  refresh_seconds: null,
  cross_filter: true,
  filters: [],
  tiles: [],
};

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

const DEFAULT_SIZE: Record<TileType, { w: number; h: number }> = {
  chart: { w: 12, h: 9 },
  kpi: { w: 6, h: 5 },
  table: { w: 12, h: 9 },
  text: { w: 12, h: 4 },
};

export const MIN_SIZE: Record<TileType, { w: number; h: number }> = {
  chart: { w: 4, h: 5 },
  kpi: { w: 3, h: 3 },
  table: { w: 4, h: 5 },
  text: { w: 2, h: 2 },
};

export function bottomOf(tiles: TileSpec[]): number {
  return tiles.reduce((max, t) => Math.max(max, t.layout.y + t.layout.h), 0);
}

export function newTile(type: TileType, tiles: TileSpec[], source?: TileSpec["source"]): TileSpec {
  const size = DEFAULT_SIZE[type];
  const config: TileConfig =
    type === "chart"
      ? { chart: "bar", metrics: [] }
      : type === "text"
        ? { text: "## Heading\nWrite **markdown** here." }
        : { metrics: [] };
  return {
    id: newId(),
    type,
    title: "",
    layout: { x: 0, y: bottomOf(tiles), ...size },
    source: type === "text" ? null : (source ?? null),
    config,
  };
}

export function duplicateTile(tile: TileSpec, tiles: TileSpec[]): TileSpec {
  return {
    ...structuredClone(tile),
    id: newId(),
    title: tile.title ? `${tile.title} (copy)` : "",
    layout: { ...tile.layout, y: bottomOf(tiles) },
  };
}

export function applyGridLayout(
  tiles: TileSpec[],
  items: readonly { i: string; x: number; y: number; w: number; h: number }[],
): TileSpec[] {
  const byId = new Map(items.map((item) => [item.i, item]));
  let changed = false;
  const next = tiles.map((tile) => {
    const item = byId.get(tile.id);
    if (!item) return tile;
    const layout: Layout = { x: item.x, y: item.y, w: item.w, h: item.h };
    const same = (Object.keys(layout) as (keyof Layout)[]).every(
      (k) => layout[k] === tile.layout[k],
    );
    if (same) return tile;
    changed = true;
    return { ...tile, layout };
  });
  return changed ? next : tiles;
}

/* ---------- date presets ---------- */

export interface DatePreset {
  id: string;
  label: string;
}

export const DATE_PRESETS: DatePreset[] = [
  { id: "all_time", label: "All time" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "last_90_days", label: "Last 90 days" },
  { id: "last_365_days", label: "Last 365 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "this_quarter", label: "This quarter" },
  { id: "this_year", label: "This year" },
  { id: "last_year", label: "Last year" },
];

function shiftDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function resolveDatePreset(
  preset: string,
  today: Date = new Date(),
): { start: string | null; end: string | null } {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const range = (start: Date | null, end: Date | null) => ({
    start: start ? toISODate(start) : null,
    end: end ? toISODate(end) : null,
  });
  const year = day.getFullYear();
  const month = day.getMonth();
  switch (preset) {
    case "today":
      return range(day, day);
    case "yesterday":
      return range(shiftDays(day, -1), shiftDays(day, -1));
    case "last_7_days":
      return range(shiftDays(day, -6), day);
    case "last_30_days":
      return range(shiftDays(day, -29), day);
    case "last_90_days":
      return range(shiftDays(day, -89), day);
    case "last_365_days":
      return range(shiftDays(day, -364), day);
    case "this_month":
      return range(new Date(year, month, 1), day);
    case "last_month":
      return range(new Date(year, month - 1, 1), new Date(year, month, 0));
    case "this_quarter":
      return range(new Date(year, Math.floor(month / 3) * 3, 1), day);
    case "this_year":
      return range(new Date(year, 0, 1), day);
    case "last_year":
      return range(new Date(year - 1, 0, 1), new Date(year - 1, 11, 31));
    default:
      return range(null, null);
  }
}

export function datePresetLabel(value: FilterValue | undefined): string {
  if (!value || (!value.preset && !value.start && !value.end)) return "All time";
  if (value.preset) return DATE_PRESETS.find((p) => p.id === value.preset)?.label ?? "Custom";
  return `${value.start ?? "…"} – ${value.end ?? "…"}`;
}

/* ---------- filters ---------- */

export type FilterState = Record<string, FilterValue>;

export function initialFilterState(filters: FilterSpec[]): FilterState {
  const state: FilterState = {};
  for (const filter of filters) {
    if (filter.default) state[filter.id] = filter.default;
  }
  return state;
}

export function filterIsActive(filter: FilterSpec, value: FilterValue | undefined): boolean {
  if (!value) return false;
  switch (filter.type) {
    case "date_range": {
      const range = resolveFilterDates(value);
      return range.start !== null || range.end !== null;
    }
    case "select":
      return (value.values?.length ?? 0) > 0;
    case "number_range":
      return (
        (value.minimum !== null && value.minimum !== undefined) ||
        (value.maximum !== null && value.maximum !== undefined)
      );
  }
}

export function resolveFilterDates(value: FilterValue, today?: Date) {
  if (value.preset) return resolveDatePreset(value.preset, today);
  return { start: value.start ?? null, end: value.end ?? null };
}

export function filterConditions(filters: FilterSpec[], state: FilterState, today?: Date) {
  const conditions: Condition[] = [];
  for (const filter of filters) {
    const value = state[filter.id];
    if (!filterIsActive(filter, value) || !value) continue;
    if (filter.type === "date_range") {
      const { start, end } = resolveFilterDates(value, today);
      conditions.push({ column: filter.column, kind: "date_range", start, end });
    } else if (filter.type === "select") {
      conditions.push({ column: filter.column, kind: "in", values: value.values ?? [] });
    } else {
      conditions.push({
        column: filter.column,
        kind: "number_range",
        minimum: value.minimum ?? null,
        maximum: value.maximum ?? null,
      });
    }
  }
  return conditions;
}

/** Conditions for one tile: global filters plus cross-filters made on other tiles. */
export function conditionsForTile(
  tileId: string,
  filterConditionList: Condition[],
  crossFilters: CrossFilter[],
  enabled: boolean,
): Condition[] {
  if (!enabled) return filterConditionList;
  return [
    ...filterConditionList,
    ...crossFilters.filter((c) => c.tileId !== tileId).flatMap((c) => c.conditions),
  ];
}

/** Toggles `key` in a cross-filter on `tile`'s dimension; additive keeps the other selections. */
export function toggleCrossFilter(
  existing: CrossFilter | undefined,
  tileId: string,
  column: string,
  grain: Condition["grain"],
  key: string | null,
  label: string,
  additive: boolean,
): CrossFilter | null {
  const current = existing?.conditions[0]?.values ?? [];
  const labels = existing?.labels ?? [];
  const index = current.indexOf(key);
  let values: (string | number | boolean | null)[];
  let nextLabels: string[];
  if (index >= 0) {
    values = current.filter((_, i) => i !== index);
    nextLabels = labels.filter((_, i) => i !== index);
  } else if (additive) {
    values = [...current, key];
    nextLabels = [...labels, label];
  } else {
    values = [key];
    nextLabels = [label];
  }
  if (values.length === 0) return null;
  return {
    tileId,
    conditions: [{ column, kind: "in", values, grain: grain ?? null }],
    labels: nextLabels,
  };
}

/* ---------- tile readiness ---------- */

export function tileProblem(tile: TileSpec): string | null {
  if (tile.type === "text") return null;
  if (!tile.source || (tile.source.kind === "table" ? !tile.source.table : !tile.source.query_id)) {
    return "Choose a data source";
  }
  const { config } = tile;
  const metrics = config.metrics ?? [];
  const missingColumn = metrics.some((m) => m.agg !== "count" && !m.column);
  if (tile.type === "kpi") {
    if (metrics.length === 0) return "Add a metric";
    return missingColumn ? "Choose a column for the metric" : null;
  }
  if (tile.type === "table") {
    if ((config.dimensions?.length ?? 0) + metrics.length === 0) return "Add at least one column";
    if (config.dimensions?.some((d) => !d.column)) return "Choose a column for each field";
    return missingColumn ? "Choose a column for each metric" : null;
  }
  if (!config.dimension) return "Choose a dimension";
  if (metrics.length === 0) return "Add a metric";
  if (missingColumn) return "Choose a column for each metric";
  const kind = config.chart ?? "bar";
  if (kind === "scatter" && metrics.length !== 2) return "A scatter chart needs two metrics (X, Y)";
  if (kind === "heatmap" && !config.breakdown) return "A heatmap needs a breakdown";
  return null;
}

/** The part of a tile that changes what the database returns (not labels, formats or colours). */
export function queryShape(tile: TileSpec) {
  const { config } = tile;
  return {
    type: tile.type,
    source: tile.source,
    config: {
      chart: tile.type === "chart" ? config.chart : undefined,
      dimension: config.dimension,
      breakdown: config.breakdown,
      dimensions: config.dimensions,
      metrics: config.metrics?.map((m) => ({ agg: m.agg, column: m.column })),
      sort: config.sort,
      limit: config.limit,
      compare: config.compare,
      trend: config.trend,
    },
  };
}

export function sourceTableName(tile: TileSpec): string | null {
  return tile.source?.kind === "table" ? (tile.source.table ?? null) : null;
}

export function filterSummary(filter: FilterSpec, value: FilterValue | undefined): string {
  if (!value || !filterIsActive(filter, value)) return "All";
  if (filter.type === "date_range") {
    const { start, end } = resolveFilterDates(value);
    return `${start ?? "…"} – ${end ?? "…"}`;
  }
  if (filter.type === "select") return (value.values ?? []).map(String).join(", ");
  return `${value.minimum ?? "…"} – ${value.maximum ?? "…"}`;
}

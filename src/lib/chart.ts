import type { ColumnInfo, RowSet } from "@/lib/api-types";
import { typeCategory } from "@/lib/column-types";

export type ChartKind = "bar" | "line" | "area" | "scatter" | "pie";

export interface ChartConfig {
  kind: ChartKind;
  x: number | null;
  y: number[];
}

export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

export interface ChartData {
  categories: string[];
  series: ChartSeries[];
}

export const CHART_PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export const CHART_INK = {
  light: { text: "#18181b", muted: "#71717a", grid: "#e4e4e7", surface: "#ffffff" },
  dark: { text: "#f4f4f5", muted: "#a1a1aa", grid: "#2e2e33", surface: "#1c1c1f" },
};

export const MAX_SERIES = 8;
export const MAX_SCATTER_SERIES = 3;
export const MAX_PIE_SLICES = 8;

export function isNumericColumn(column: ColumnInfo): boolean {
  return typeCategory(column.type) === "number";
}

export function defaultChartConfig(columns: ColumnInfo[]): ChartConfig | null {
  const numeric = columns.flatMap((c, i) => (isNumericColumn(c) ? [i] : []));
  const dimension = columns.findIndex((c) => !isNumericColumn(c));
  const x = dimension >= 0 ? dimension : numeric.length > 1 ? numeric[0] : null;
  const y = numeric.filter((i) => i !== x).slice(0, 3);
  if (y.length === 0) return null;
  const isTime = x !== null && typeCategory(columns[x].type) === "date";
  return { kind: isTime ? "line" : "bar", x, y };
}

export function maxSeries(kind: ChartKind): number {
  if (kind === "pie") return 1;
  return kind === "scatter" ? MAX_SCATTER_SERIES : MAX_SERIES;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function label(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function chartData(config: ChartConfig, data: RowSet): ChartData {
  const y = config.y.slice(0, maxSeries(config.kind));
  const categories = data.rows.map((row, i) =>
    config.x === null ? String(i + 1) : label(row[config.x]),
  );
  const series = y.map((index) => ({
    name: data.columns[index].name,
    values: data.rows.map((row) => toNumber(row[index])),
  }));
  if (config.kind !== "pie" || series.length === 0) return { categories, series };

  const totals = new Map<string, number>();
  categories.forEach((category, i) => {
    totals.set(category, (totals.get(category) ?? 0) + (series[0].values[i] ?? 0));
  });
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const kept = sorted.slice(0, MAX_PIE_SLICES - (sorted.length > MAX_PIE_SLICES ? 1 : 0));
  const rest = sorted.slice(kept.length);
  if (rest.length) kept.push(["Other", rest.reduce((sum, [, v]) => sum + v, 0)]);
  return {
    categories: kept.map(([c]) => c),
    series: [{ name: series[0].name, values: kept.map(([, v]) => v) }],
  };
}

export interface ChartTokens {
  text: string;
  muted: string;
  grid: string;
  surface: string;
  palette: string[];
}

export function buildChartOption(
  config: ChartConfig,
  data: ChartData,
  tokens: ChartTokens,
): Record<string, unknown> {
  const textStyle = { color: tokens.muted, fontFamily: "Inter Variable, sans-serif", fontSize: 11 };
  const tooltip = {
    trigger: config.kind === "pie" || config.kind === "scatter" ? "item" : "axis",
    axisPointer: { type: config.kind === "bar" ? "shadow" : "line" },
    backgroundColor: tokens.surface,
    borderColor: tokens.grid,
    textStyle: { color: tokens.text, fontSize: 12 },
    confine: true,
  };
  const legend =
    data.series.length > 1
      ? { top: 0, textStyle: { color: tokens.text, fontSize: 12 }, itemWidth: 10, itemHeight: 10 }
      : undefined;

  if (config.kind === "pie") {
    return {
      color: tokens.palette,
      tooltip,
      legend: { type: "scroll", bottom: 0, textStyle: { color: tokens.text, fontSize: 12 } },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: { borderColor: tokens.surface, borderWidth: 2 },
          label: { color: tokens.text, fontSize: 11 },
          data: data.categories.map((name, i) => ({ name, value: data.series[0].values[i] })),
        },
      ],
    };
  }

  const axisLine = { lineStyle: { color: tokens.grid } };
  const splitLine = { lineStyle: { color: tokens.grid, opacity: 0.6 } };
  const scatter = config.kind === "scatter";
  return {
    color: tokens.palette,
    tooltip,
    legend,
    grid: { left: 8, right: 16, top: legend ? 32 : 12, bottom: 8, containLabel: true },
    xAxis: scatter
      ? { type: "value", axisLine, splitLine, axisLabel: textStyle, scale: true }
      : {
          type: "category",
          data: data.categories,
          axisLine,
          axisLabel: { ...textStyle, hideOverlap: true },
        },
    yAxis: { type: "value", axisLine, splitLine, axisLabel: textStyle, scale: scatter },
    series: data.series.map((s) => ({
      name: s.name,
      type: config.kind === "area" ? "line" : config.kind,
      data: scatter ? data.categories.map((c, i) => [toNumber(c), s.values[i]]) : s.values,
      ...(config.kind === "bar"
        ? { barMaxWidth: 32, itemStyle: { borderRadius: [4, 4, 0, 0] } }
        : {}),
      ...(config.kind === "line" || config.kind === "area"
        ? { lineStyle: { width: 2 }, symbolSize: 8, showSymbol: data.categories.length <= 60 }
        : {}),
      ...(config.kind === "area" ? { areaStyle: { opacity: 0.15 } } : {}),
      ...(scatter
        ? { symbolSize: 8, itemStyle: { borderColor: tokens.surface, borderWidth: 2 } }
        : {}),
    })),
  };
}

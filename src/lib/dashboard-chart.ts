import type { CellValue } from "@/lib/api-types";
import { toNumber, type ChartTokens } from "@/lib/chart";
import type {
  ChartKind,
  Grain,
  Metric,
  NumberFormat,
  PaletteName,
  TileConfig,
  TileData,
} from "@/lib/dashboard-types";
import { formatBucket, formatValue, nextBucket } from "@/lib/number-format";

export const PALETTE_START: Record<PaletteName, number> = {
  classic: 0,
  sunset: 1,
  lagoon: 2,
  twilight: 6,
};

export const PALETTE_LABELS: Record<PaletteName, string> = {
  classic: "Classic",
  sunset: "Sunset",
  lagoon: "Lagoon",
  twilight: "Twilight",
};

/** One-hue ramps for magnitude (heatmap), from the validated blue ramp. */
export const SEQUENTIAL = {
  light: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  dark: ["#0d366b", "#104281", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
};

export const MAX_PIE_SLICES = 8;
const MAX_FILLED_BUCKETS = 2000;
export const BLANK = "(blank)";

export function rotatePalette(palette: string[], name: PaletteName): string[] {
  const start = PALETTE_START[name] % palette.length;
  return [...palette.slice(start), ...palette.slice(0, start)];
}

const AGG_LABELS = {
  sum: "Sum",
  avg: "Average",
  count: "Count",
  count_distinct: "Distinct",
  min: "Min",
  max: "Max",
};

export function metricLabel(metric: Metric): string {
  if (metric.label?.trim()) return metric.label.trim();
  if (!metric.column) return "Count";
  return `${AGG_LABELS[metric.agg]} of ${metric.column}`;
}

export interface SeriesModel {
  name: string;
  values: (number | null)[];
  format: NumberFormat | undefined;
  shape: "bar" | "line";
}

export interface ChartModel {
  kind: ChartKind;
  grain: Grain | null;
  /** Raw dimension values, used for cross-filtering. */
  keys: (string | null)[];
  labels: string[];
  shortLabels: string[];
  series: SeriesModel[];
  /** Raw breakdown values, one per series. */
  seriesKeys: (string | null)[];
  /** Heatmap cells as [x index, y index, value]; y labels are the series names. */
  cells: [number, number, number][];
  /** Scatter points as [x, y]. */
  points: [number | null, number | null][];
}

function dimensionKey(value: CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function dimensionLabel(
  key: string | null,
  grain: Grain | null | undefined,
  long: boolean,
): string {
  if (key === null) return BLANK;
  return grain ? formatBucket(key, grain, long) : key;
}

function fillBuckets(keys: (string | null)[], grain: Grain): (string | null)[] | null {
  const real = keys.filter((k): k is string => k !== null);
  if (real.length < 2 || real.length !== keys.length) return null;
  const sorted = real.every((k, i) => i === 0 || real[i - 1] < k);
  if (!sorted) return null;
  const filled: string[] = [];
  let current: string | null = real[0];
  const last = real[real.length - 1];
  while (current !== null && current <= last) {
    filled.push(current);
    if (filled.length > MAX_FILLED_BUCKETS) return null;
    current = nextBucket(current, grain);
  }
  return filled.length > real.length ? filled : null;
}

export function buildChartModel(config: TileConfig, data: TileData): ChartModel {
  const kind = config.chart ?? "bar";
  const grain = config.dimension?.grain ?? null;
  const metrics = config.metrics ?? [];
  const shapeOf = (index: number): "bar" | "line" =>
    kind === "line" || kind === "area"
      ? "line"
      : kind === "combo"
        ? (metrics[index]?.shape ?? (index === 0 ? "bar" : "line"))
        : "bar";
  const empty: ChartModel = {
    kind,
    grain,
    keys: [],
    labels: [],
    shortLabels: [],
    series: [],
    seriesKeys: [],
    cells: [],
    points: [],
  };

  let keys: (string | null)[] = [];
  let seriesKeys: (string | null)[] = [];
  let series: SeriesModel[];
  const hasBreakdown = !!config.breakdown;

  if (hasBreakdown) {
    const dimIndex = new Map<string | null, number>();
    const seriesIndex = new Map<string | null, number>();
    for (const row of data.rows) {
      const d = dimensionKey(row[0]);
      const b = dimensionKey(row[1]);
      if (!dimIndex.has(d)) dimIndex.set(d, dimIndex.size);
      if (!seriesIndex.has(b)) seriesIndex.set(b, seriesIndex.size);
    }
    keys = [...dimIndex.keys()];
    seriesKeys = [...seriesIndex.keys()];
    const format = metrics[0]?.format;
    series = [...seriesIndex.keys()].map((b) => ({
      name: dimensionLabel(b, config.breakdown?.grain, true),
      values: keys.map(() => null),
      format,
      shape: shapeOf(0),
    }));
    for (const row of data.rows) {
      const target = series[seriesIndex.get(dimensionKey(row[1])) ?? 0];
      target.values[dimIndex.get(dimensionKey(row[0])) ?? 0] = toNumber(row[2]);
    }
  } else {
    keys = data.rows.map((row) => dimensionKey(row[0]));
    series = metrics.map((metric, i) => ({
      name: metricLabel(metric),
      values: data.rows.map((row) => toNumber(row[1 + i])),
      format: metric.format,
      shape: shapeOf(i),
    }));
  }

  const ordered = !config.sort || config.sort.by === "dimension";
  const filled =
    grain && ordered && kind !== "pie" && kind !== "donut" ? fillBuckets(keys, grain) : null;
  if (filled) {
    const position = new Map(keys.map((k, i) => [k, i]));
    series = series.map((s) => ({
      ...s,
      values: filled.map((k) => {
        const at = position.get(k);
        return at === undefined ? null : s.values[at];
      }),
    }));
    keys = filled;
  }

  const labels = keys.map((k) => dimensionLabel(k, grain, true));
  const shortLabels = keys.map((k) => dimensionLabel(k, grain, false));
  if (!series.length && !keys.length) return empty;

  if (kind === "heatmap") {
    const cells: [number, number, number][] = [];
    series.forEach((s, y) =>
      s.values.forEach((v, x) => {
        if (v !== null) cells.push([x, y, v]);
      }),
    );
    return { ...empty, keys, labels, shortLabels, series, seriesKeys, cells };
  }
  if (kind === "scatter") {
    const points = data.rows.map(
      (row) => [toNumber(row[1]), toNumber(row[2])] as [number | null, number | null],
    );
    return { ...empty, keys, labels, shortLabels, series, points };
  }
  if (kind === "pie" || kind === "donut") {
    return foldSlices({ ...empty, keys, labels, shortLabels, series });
  }
  return { ...empty, keys, labels, shortLabels, series };
}

function foldSlices(model: ChartModel): ChartModel {
  const series = model.series[0];
  if (!series || model.keys.length <= MAX_PIE_SLICES) return model;
  const order = model.keys
    .map((_, i) => i)
    .sort((a, b) => (series.values[b] ?? 0) - (series.values[a] ?? 0));
  const kept = order.slice(0, MAX_PIE_SLICES - 1);
  const rest = order.slice(MAX_PIE_SLICES - 1);
  const other = rest.reduce((sum, i) => sum + (series.values[i] ?? 0), 0);
  return {
    ...model,
    keys: [...kept.map((i) => model.keys[i]), OTHER_KEY],
    labels: [...kept.map((i) => model.labels[i]), "Other"],
    shortLabels: [...kept.map((i) => model.shortLabels[i]), "Other"],
    series: [{ ...series, values: [...kept.map((i) => series.values[i]), other] }],
  };
}

/** Marks the folded "Other" slice, which cannot be used as a filter. */
export const OTHER_KEY = "\u0000other";

export interface ChartContext {
  tokens: ChartTokens;
  color: (name: string) => string;
  ramp: string[];
  /** Keys selected by a cross-filter on this tile; everything else is dimmed. */
  selected: ReadonlySet<string | null> | null;
  showLabels: boolean;
  dark: boolean;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function axisFormat(model: ChartModel): NumberFormat | undefined {
  const formats = model.series.map((s) => JSON.stringify(s.format ?? null));
  return new Set(formats).size === 1 ? model.series[0]?.format : undefined;
}

function dim(ctx: ChartContext, key: string | null): number {
  return !ctx.selected || ctx.selected.has(key) ? 1 : 0.3;
}

export function buildDashboardOption(
  model: ChartModel,
  ctx: ChartContext,
): Record<string, unknown> {
  const { tokens } = ctx;
  const textStyle = { color: tokens.muted, fontFamily: "Inter Variable, sans-serif", fontSize: 11 };
  const tooltipBase = {
    backgroundColor: tokens.surface,
    borderColor: tokens.grid,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tokens.text, fontSize: 12 },
    confine: true,
    extraCssText: "box-shadow:0 4px 16px rgba(0,0,0,.12);border-radius:8px;",
  };
  const legend = {
    type: "scroll",
    top: 0,
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: tokens.text, fontSize: 12 },
    pageIconColor: tokens.muted,
    pageTextStyle: { color: tokens.muted },
  };
  const common = { animationDuration: 350, animationDurationUpdate: 250, textStyle };
  const full = (s: SeriesModel) => (v: unknown) => formatValue(toNumber(v), s.format, false);

  switch (model.kind) {
    case "pie":
    case "donut":
      return pieOption(model, ctx, tooltipBase, common);
    case "scatter":
      return scatterOption(model, ctx, tooltipBase, common);
    case "heatmap":
      return heatmapOption(model, ctx, tooltipBase, common);
  }

  const multi = model.series.length > 1;
  const stacked = model.kind === "stacked_bar" || (model.kind === "area" && multi);
  const axisLine = { lineStyle: { color: tokens.grid } };
  const yFormat = axisFormat(model);
  const lastBar = model.series.map((s) => s.shape).lastIndexOf("bar");
  const dense = model.keys.length > 40;
  return {
    ...common,
    legend: multi ? legend : undefined,
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      axisPointer: {
        type: model.series.some((s) => s.shape === "bar") ? "shadow" : "line",
        shadowStyle: { color: tokens.muted, opacity: 0.08 },
        lineStyle: { color: tokens.muted, opacity: 0.5 },
      },
    },
    grid: { left: 4, right: 12, top: multi ? 34 : 14, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: model.labels,
      axisLine,
      axisTick: { show: false },
      axisLabel: {
        ...textStyle,
        hideOverlap: true,
        formatter: (_: string, index: number) => model.shortLabels[index] ?? "",
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: tokens.grid, opacity: 0.6 } },
      axisLabel: { ...textStyle, formatter: (v: number) => formatValue(v, yFormat, true, 2) },
    },
    series: model.series.map((s, index) => {
      const color = ctx.color(s.name);
      const data = s.values.map((v, i) => ({
        value: v,
        itemStyle: ctx.selected ? { opacity: dim(ctx, model.keys[i]) } : undefined,
      }));
      const base = {
        name: s.name,
        data,
        tooltip: { valueFormatter: full(s) },
        itemStyle: { color },
        emphasis: { focus: "none" },
        label: ctx.showLabels
          ? {
              show: true,
              color: tokens.text,
              fontSize: 11,
              formatter: (p: { value: unknown }) => formatValue(toNumber(p.value), s.format, true),
            }
          : undefined,
      };
      if (s.shape === "line") {
        return {
          ...base,
          type: "line",
          smooth: false,
          lineStyle: { width: 2, color },
          symbolSize: 8,
          showSymbol: !dense,
          itemStyle: { color, borderColor: tokens.surface, borderWidth: 2 },
          ...(model.kind === "area"
            ? { areaStyle: { opacity: 0.16 }, stack: stacked ? "total" : undefined }
            : {}),
        };
      }
      const rounded = !stacked || index === lastBar;
      return {
        ...base,
        type: "bar",
        stack: stacked ? "total" : undefined,
        barMaxWidth: 36,
        itemStyle: {
          color,
          borderRadius: rounded ? [4, 4, 0, 0] : 0,
          borderColor: stacked ? tokens.surface : undefined,
          borderWidth: stacked ? 1 : 0,
        },
      };
    }),
  };
}

type Shared = Record<string, unknown>;

function pieOption(model: ChartModel, ctx: ChartContext, tooltip: Shared, common: Shared) {
  const { tokens } = ctx;
  const series = model.series[0];
  const donut = model.kind === "donut";
  const total = series.values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const labelFormat = (v: unknown) => formatValue(toNumber(v), series.format, false);
  return {
    ...common,
    tooltip: {
      ...tooltip,
      trigger: "item",
      valueFormatter: labelFormat,
    },
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: tokens.text, fontSize: 12 },
      pageIconColor: tokens.muted,
      pageTextStyle: { color: tokens.muted },
    },
    graphic: donut
      ? [
          {
            type: "text",
            left: "center",
            top: "38%",
            silent: true,
            style: {
              text: `${formatValue(total, series.format, true)}\n{sub|${series.name}}`,
              textAlign: "center",
              fill: tokens.text,
              fontSize: 22,
              fontWeight: 600,
              fontFamily: "Inter Variable, sans-serif",
              rich: { sub: { fontSize: 11, fill: tokens.muted, fontWeight: 400 } },
            },
          },
        ]
      : undefined,
    series: [
      {
        type: "pie",
        radius: donut ? ["50%", "74%"] : [0, "74%"],
        center: ["50%", "46%"],
        minAngle: 3,
        itemStyle: { borderColor: tokens.surface, borderWidth: 2, borderRadius: donut ? 4 : 0 },
        label: ctx.showLabels
          ? { color: tokens.text, fontSize: 11, formatter: "{b}: {d}%" }
          : { show: false },
        labelLine: { show: ctx.showLabels },
        emphasis: { scale: true, scaleSize: 4 },
        data: model.labels.map((name, i) => ({
          name,
          value: series.values[i],
          itemStyle: {
            color: ctx.color(name),
            opacity: model.keys[i] === OTHER_KEY ? 1 : dim(ctx, model.keys[i]),
          },
        })),
      },
    ],
  };
}

function scatterOption(model: ChartModel, ctx: ChartContext, tooltip: Shared, common: Shared) {
  const { tokens } = ctx;
  const [xs, ys] = model.series;
  const textStyle = { color: tokens.muted, fontFamily: "Inter Variable, sans-serif", fontSize: 11 };
  const axis = (s: SeriesModel | undefined, bottom: boolean) => ({
    type: "value",
    scale: true,
    name: s?.name,
    nameLocation: bottom ? "middle" : "end",
    nameGap: bottom ? 28 : 10,
    nameTextStyle: { color: tokens.muted, fontSize: 11, align: bottom ? "center" : "left" },
    axisLine: { lineStyle: { color: tokens.grid } },
    splitLine: { lineStyle: { color: tokens.grid, opacity: 0.6 } },
    axisLabel: { ...textStyle, formatter: (v: number) => formatValue(v, s?.format, true, 2) },
  });
  const color = ctx.color(model.series[1]?.name ?? "");
  return {
    ...common,
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const [x, y] = model.points[p.dataIndex] ?? [null, null];
        return (
          `<div style="font-weight:600">${escapeHtml(model.labels[p.dataIndex] ?? "")}</div>` +
          `<div>${escapeHtml(xs?.name ?? "X")}: <b>${formatValue(x, xs?.format, false)}</b></div>` +
          `<div>${escapeHtml(ys?.name ?? "Y")}: <b>${formatValue(y, ys?.format, false)}</b></div>`
        );
      },
    },
    grid: { left: 8, right: 20, top: 34, bottom: 28, containLabel: true },
    xAxis: axis(xs, true),
    yAxis: axis(ys, false),
    series: [
      {
        type: "scatter",
        symbolSize: 12,
        data: model.points.map((point, i) => ({
          value: point,
          itemStyle: {
            color,
            borderColor: tokens.surface,
            borderWidth: 2,
            opacity: dim(ctx, model.keys[i]),
          },
        })),
        emphasis: { scale: 1.4 },
        label: ctx.showLabels
          ? {
              show: true,
              position: "top",
              color: tokens.text,
              fontSize: 11,
              formatter: (p: { dataIndex: number }) => model.labels[p.dataIndex] ?? "",
            }
          : undefined,
      },
    ],
  };
}

function heatmapOption(model: ChartModel, ctx: ChartContext, tooltip: Shared, common: Shared) {
  const { tokens } = ctx;
  const s = model.series[0];
  const textStyle = { color: tokens.muted, fontFamily: "Inter Variable, sans-serif", fontSize: 11 };
  const values = model.cells.map((c) => c[2]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const names = model.series.map((x) => x.name);
  const showCellLabels = model.cells.length <= 80 && model.labels.length <= 12;
  return {
    ...common,
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (p: { value: [number, number, number] }) =>
        `<div style="font-weight:600">${escapeHtml(names[p.value[1]] ?? "")} · ${escapeHtml(model.labels[p.value[0]] ?? "")}</div>` +
        `<div><b>${formatValue(p.value[2], s?.format, false)}</b></div>`,
    },
    grid: { left: 4, right: 12, top: 8, bottom: 40, containLabel: true },
    xAxis: {
      type: "category",
      data: model.labels,
      splitArea: { show: false },
      axisLine: { lineStyle: { color: tokens.grid } },
      axisTick: { show: false },
      axisLabel: {
        ...textStyle,
        interval: 0,
        width: 64,
        overflow: "truncate",
        formatter: (_: string, index: number) => model.shortLabels[index] ?? "",
      },
    },
    yAxis: {
      type: "category",
      data: names,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: textStyle,
    },
    visualMap: {
      type: "continuous",
      min,
      max: max === min ? min + 1 : max,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 120,
      text: [formatValue(max, s?.format, true), formatValue(min, s?.format, true)],
      textStyle: { color: tokens.muted, fontSize: 11 },
      inRange: { color: ctx.ramp },
    },
    series: [
      {
        type: "heatmap",
        data: model.cells.map(([x, y, v]) => {
          const ratio = max === min ? 0 : (v - min) / (max - min);
          const strong = ctx.dark ? ratio < 0.45 : ratio > 0.5;
          return {
            value: [x, y, v],
            itemStyle: { opacity: dim(ctx, model.keys[x]) },
            label: { color: strong ? "#ffffff" : "#0b0b0b" },
          };
        }),
        itemStyle: { borderColor: tokens.surface, borderWidth: 2, borderRadius: 3 },
        label: showCellLabels
          ? {
              show: true,
              fontSize: 10,
              formatter: (p: { value: [number, number, number] }) =>
                formatValue(p.value[2], s?.format, true),
            }
          : { show: false },
        emphasis: { itemStyle: { borderColor: tokens.text, borderWidth: 1 } },
      },
    ],
  };
}

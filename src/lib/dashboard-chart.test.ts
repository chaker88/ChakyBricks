import { describe, expect, it } from "vitest";
import { CHART_INK, CHART_PALETTE } from "@/lib/chart";
import {
  OTHER_KEY,
  buildChartModel,
  buildDashboardOption,
  metricLabel,
  rotatePalette,
} from "@/lib/dashboard-chart";
import type { TileConfig, TileData } from "@/lib/dashboard-types";

function data(rows: TileData["rows"], extra: Partial<TileData> = {}): TileData {
  return {
    columns: [],
    rows,
    truncated: false,
    cached: false,
    elapsed_ms: 1,
    ...extra,
  };
}

const ctx = {
  tokens: { ...CHART_INK.light, palette: CHART_PALETTE.light },
  color: () => "#2a78d6",
  ramp: ["#cde2fb", "#0d366b"],
  selected: null,
  showLabels: false,
  dark: false,
};

describe("chart model", () => {
  it("builds one series per metric and labels date buckets", () => {
    const config: TileConfig = {
      chart: "line",
      dimension: { column: "d", grain: "month" },
      metrics: [{ agg: "sum", column: "v", label: "Revenue" }],
    };
    const model = buildChartModel(
      config,
      data([
        ["2025-01-01", 5],
        ["2025-02-01", 7],
      ]),
    );
    expect(model.series[0].name).toBe("Revenue");
    expect(model.labels).toEqual(["Jan 2025", "Feb 2025"]);
  });

  it("fills gaps between date buckets", () => {
    const config: TileConfig = {
      chart: "bar",
      dimension: { column: "d", grain: "month" },
      metrics: [{ agg: "count", column: null }],
    };
    const model = buildChartModel(
      config,
      data([
        ["2025-01-01", 5],
        ["2025-04-01", 7],
      ]),
    );
    expect(model.keys).toEqual(["2025-01-01", "2025-02-01", "2025-03-01", "2025-04-01"]);
    expect(model.series[0].values).toEqual([5, null, null, 7]);
  });

  it("pivots a breakdown into series and keeps Arabic names", () => {
    const config: TileConfig = {
      chart: "stacked_bar",
      dimension: { column: "d" },
      breakdown: { column: "b" },
      metrics: [{ agg: "sum", column: "v" }],
    };
    const model = buildChartModel(
      config,
      data([
        ["شاي", "شمال", 1],
        ["شاي", "جنوب", 2],
        ["قهوة", "جنوب", 3],
      ]),
    );
    expect(model.keys).toEqual(["شاي", "قهوة"]);
    expect(model.series.map((s) => s.name)).toEqual(["شمال", "جنوب"]);
    expect(model.series[0].values).toEqual([1, null]);
  });

  it("folds extra pie slices into Other", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`s${i}`, 12 - i] as [string, number]);
    const model = buildChartModel(
      { chart: "pie", dimension: { column: "d" }, metrics: [{ agg: "sum", column: "v" }] },
      data(rows),
    );
    expect(model.keys).toHaveLength(8);
    expect(model.keys[7]).toBe(OTHER_KEY);
    expect(model.series[0].values[7]).toBe(5 + 4 + 3 + 2 + 1);
  });

  it("turns heatmap data into cells", () => {
    const model = buildChartModel(
      {
        chart: "heatmap",
        dimension: { column: "d" },
        breakdown: { column: "b" },
        metrics: [{ agg: "count", column: null }],
      },
      data([
        ["a", "x", 1],
        ["a", "y", 2],
        ["b", "x", 3],
      ]),
    );
    expect(model.cells).toEqual([
      [0, 0, 1],
      [1, 0, 3],
      [0, 1, 2],
    ]);
  });
});

describe("chart options", () => {
  it("dims unselected bars and escapes tooltip text", () => {
    const config: TileConfig = {
      chart: "bar",
      dimension: { column: "d" },
      metrics: [{ agg: "count", column: null }],
    };
    const model = buildChartModel(
      config,
      data([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const option = buildDashboardOption(model, { ...ctx, selected: new Set(["a"]) }) as {
      series: { data: { itemStyle: { opacity: number } }[] }[];
    };
    expect(option.series[0].data.map((d) => d.itemStyle.opacity)).toEqual([1, 0.3]);
  });

  it("builds every chart kind without throwing", () => {
    const kinds = [
      "bar",
      "stacked_bar",
      "line",
      "area",
      "combo",
      "pie",
      "donut",
      "scatter",
      "heatmap",
    ] as const;
    for (const chart of kinds) {
      const breakdown = chart === "heatmap";
      const metrics =
        chart === "scatter" || chart === "combo"
          ? [
              { agg: "sum" as const, column: "v" },
              { agg: "avg" as const, column: "v" },
            ]
          : [{ agg: "sum" as const, column: "v" }];
      const rows = breakdown
        ? [["a", "x", 1]]
        : chart === "scatter" || chart === "combo"
          ? [["a", 1, 2]]
          : [["a", 1]];
      const config: TileConfig = {
        chart,
        dimension: { column: "d" },
        breakdown: breakdown ? { column: "b" } : null,
        metrics,
      };
      const model = buildChartModel(config, data(rows));
      expect(() => buildDashboardOption(model, ctx)).not.toThrow();
    }
  });
});

describe("combo secondary axis", () => {
  const config: TileConfig = {
    chart: "combo",
    dimension: { column: "d" },
    metrics: [
      { agg: "sum", column: "v", format: { type: "currency" } },
      { agg: "count", column: null, shape: "line", axis: "right", format: { type: "percent" } },
    ],
  };

  it("adds a right axis only when a metric asks for it", () => {
    const model = buildChartModel(config, data([["a", 1, 2]]));
    const option = buildDashboardOption(model, ctx) as {
      yAxis: { position?: string }[];
      series: { yAxisIndex: number }[];
    };
    expect(option.yAxis).toHaveLength(2);
    expect(option.yAxis[1].position).toBe("right");
    expect(option.series.map((s) => s.yAxisIndex)).toEqual([0, 1]);
    const plain = buildChartModel(
      { ...config, metrics: config.metrics!.map((m) => ({ ...m, axis: undefined })) },
      data([["a", 1, 2]]),
    );
    expect((buildDashboardOption(plain, ctx) as { yAxis: unknown[] }).yAxis).toHaveLength(1);
  });
});

describe("palettes and labels", () => {
  it("rotates without changing colours", () => {
    const rotated = rotatePalette(CHART_PALETTE.light, "sunset");
    expect(rotated[0]).toBe(CHART_PALETTE.light[1]);
    expect([...rotated].sort()).toEqual([...CHART_PALETTE.light].sort());
  });

  it("names metrics", () => {
    expect(metricLabel({ agg: "count", column: null })).toBe("Count");
    expect(metricLabel({ agg: "sum", column: "revenue" })).toBe("Sum of revenue");
    expect(metricLabel({ agg: "sum", column: "x", label: " Sales " })).toBe("Sales");
  });
});

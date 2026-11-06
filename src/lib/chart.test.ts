import type { RowSet } from "@/lib/api-types";
import {
  CHART_PALETTE,
  buildChartOption,
  chartData,
  defaultChartConfig,
  toNumber,
  type ChartConfig,
} from "@/lib/chart";

const data: RowSet = {
  columns: [
    { name: "region", type: "VARCHAR" },
    { name: "revenue", type: "DOUBLE" },
    { name: "orders", type: "BIGINT" },
    { name: "big", type: "DECIMAL(38,2)" },
  ],
  rows: [
    ["north", 10.5, 3, "123456789012345678901.50"],
    ["south", 20, 5, "1.5"],
    ["east", null, 1, null],
  ],
};

const tokens = {
  text: "#111",
  muted: "#666",
  grid: "#ddd",
  surface: "#fff",
  palette: CHART_PALETTE.light,
};

describe("chart", () => {
  it("picks a dimension and numeric measures by default", () => {
    expect(defaultChartConfig(data.columns)).toEqual({ kind: "bar", x: 0, y: [1, 2, 3] });
    expect(
      defaultChartConfig([
        { name: "day", type: "DATE" },
        { name: "n", type: "INTEGER" },
      ]),
    ).toEqual({ kind: "line", x: 0, y: [1] });
    expect(defaultChartConfig([{ name: "a", type: "VARCHAR" }])).toBeNull();
    expect(
      defaultChartConfig([
        { name: "x", type: "DOUBLE" },
        { name: "y", type: "DOUBLE" },
      ]),
    ).toEqual({ kind: "bar", x: 0, y: [1] });
  });

  it("converts values to numbers safely", () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber("1.5")).toBe(1.5);
    expect(toNumber("NaN")).toBeNull();
    expect(toNumber("Infinity")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(true)).toBe(1);
  });

  it("builds series from rows", () => {
    const result = chartData({ kind: "bar", x: 0, y: [1, 2] }, data);
    expect(result.categories).toEqual(["north", "south", "east"]);
    expect(result.series).toEqual([
      { name: "revenue", values: [10.5, 20, null] },
      { name: "orders", values: [3, 5, 1] },
    ]);
  });

  it("caps series per chart kind", () => {
    const config: ChartConfig = { kind: "scatter", x: 1, y: [1, 2, 3, 2, 1] };
    expect(chartData(config, data).series).toHaveLength(3);
    expect(chartData({ kind: "pie", x: 0, y: [1, 2] }, data).series).toHaveLength(1);
  });

  it("folds pie slices beyond eight into Other, largest first", () => {
    const many: RowSet = {
      columns: [
        { name: "k", type: "VARCHAR" },
        { name: "v", type: "INTEGER" },
      ],
      rows: Array.from({ length: 12 }, (_, i) => [`k${i}`, i + 1]),
    };
    const result = chartData({ kind: "pie", x: 0, y: [1] }, many);
    expect(result.categories).toHaveLength(8);
    expect(result.categories[0]).toBe("k11");
    expect(result.categories[7]).toBe("Other");
    expect(result.series[0].values[7]).toBe(1 + 2 + 3 + 4 + 5);
  });

  it("builds single-axis options with a legend only for multiple series", () => {
    const single = buildChartOption(
      { kind: "line", x: 0, y: [1] },
      chartData({ kind: "line", x: 0, y: [1] }, data),
      tokens,
    );
    expect(single.legend).toBeUndefined();
    expect(Array.isArray(single.yAxis)).toBe(false);
    const multi = buildChartOption(
      { kind: "bar", x: 0, y: [1, 2] },
      chartData({ kind: "bar", x: 0, y: [1, 2] }, data),
      tokens,
    );
    expect(multi.legend).toBeDefined();
    expect(multi.color).toBe(CHART_PALETTE.light);
    const pie = buildChartOption(
      { kind: "pie", x: 0, y: [1] },
      chartData({ kind: "pie", x: 0, y: [1] }, data),
      tokens,
    );
    expect((pie.series as { type: string }[])[0].type).toBe("pie");
  });
});

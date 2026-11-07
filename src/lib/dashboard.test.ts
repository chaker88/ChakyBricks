import { describe, expect, it } from "vitest";
import {
  applyGridLayout,
  conditionsForTile,
  duplicateTile,
  filterConditions,
  initialFilterState,
  newTile,
  queryShape,
  resolveDatePreset,
  tileProblem,
  toggleCrossFilter,
} from "@/lib/dashboard";
import type { FilterSpec, TileSpec } from "@/lib/dashboard-types";

const TODAY = new Date(2025, 5, 15);
const source = { kind: "table", table: "main.sales" } as const;

function filter(partial: Partial<FilterSpec> & Pick<FilterSpec, "type" | "column">): FilterSpec {
  return { id: partial.column, label: "", source, ...partial };
}

describe("date presets", () => {
  it("resolves relative ranges inclusively", () => {
    expect(resolveDatePreset("last_7_days", TODAY)).toEqual({
      start: "2025-06-09",
      end: "2025-06-15",
    });
    expect(resolveDatePreset("last_month", TODAY)).toEqual({
      start: "2025-05-01",
      end: "2025-05-31",
    });
    expect(resolveDatePreset("this_quarter", TODAY)).toEqual({
      start: "2025-04-01",
      end: "2025-06-15",
    });
    expect(resolveDatePreset("last_year", TODAY)).toEqual({
      start: "2024-01-01",
      end: "2024-12-31",
    });
    expect(resolveDatePreset("all_time", TODAY)).toEqual({ start: null, end: null });
  });
});

describe("filter conditions", () => {
  const filters = [
    filter({ type: "date_range", column: "day", default: { preset: "last_30_days" } }),
    filter({ type: "select", column: "region" }),
    filter({ type: "number_range", column: "amount" }),
  ];

  it("starts from defaults and skips inactive filters", () => {
    const state = initialFilterState(filters);
    const conditions = filterConditions(filters, state, TODAY);
    expect(conditions).toEqual([
      { column: "day", kind: "date_range", start: "2025-05-17", end: "2025-06-15" },
    ]);
  });

  it("emits select and range conditions", () => {
    const conditions = filterConditions(
      filters,
      {
        region: { values: ["north", "جنوب"] },
        amount: { minimum: 5, maximum: null },
        day: { preset: "all_time" },
      },
      TODAY,
    );
    expect(conditions).toEqual([
      { column: "region", kind: "in", values: ["north", "جنوب"] },
      { column: "amount", kind: "number_range", minimum: 5, maximum: null },
    ]);
  });
});

describe("cross-filters", () => {
  it("toggles single and additive selections", () => {
    const first = toggleCrossFilter(undefined, "t1", "region", null, "north", "north", false);
    expect(first?.conditions[0].values).toEqual(["north"]);
    const both = toggleCrossFilter(first!, "t1", "region", null, "south", "south", true);
    expect(both?.conditions[0].values).toEqual(["north", "south"]);
    const replaced = toggleCrossFilter(both!, "t1", "region", null, "east", "east", false);
    expect(replaced?.conditions[0].values).toEqual(["east"]);
    const cleared = toggleCrossFilter(first!, "t1", "region", null, "north", "north", false);
    expect(cleared).toBeNull();
  });

  it("keeps the grain and excludes a tile's own selection", () => {
    const cross = toggleCrossFilter(
      undefined,
      "t1",
      "day",
      "month",
      "2025-01-01",
      "Jan 2025",
      false,
    )!;
    expect(cross.conditions[0].grain).toBe("month");
    const global = [{ column: "day", kind: "date_range" as const, start: null, end: null }];
    expect(conditionsForTile("t1", global, [cross], true)).toEqual(global);
    expect(conditionsForTile("t2", global, [cross], true)).toHaveLength(2);
    expect(conditionsForTile("t2", global, [cross], false)).toEqual(global);
  });
});

describe("tiles", () => {
  it("places new tiles below existing ones", () => {
    const first = newTile("chart", [], source);
    const second = newTile("kpi", [first], source);
    expect(second.layout.y).toBe(first.layout.y + first.layout.h);
    const copy = duplicateTile({ ...first, title: "Sales" }, [first, second]);
    expect(copy.id).not.toBe(first.id);
    expect(copy.title).toBe("Sales (copy)");
  });

  it("explains what is missing", () => {
    const tile: TileSpec = { ...newTile("chart", [], source) };
    expect(tileProblem(tile)).toBe("Choose a dimension");
    tile.config = { chart: "bar", dimension: { column: "a" }, metrics: [] };
    expect(tileProblem(tile)).toBe("Add a metric");
    tile.config.metrics = [{ agg: "sum", column: null }];
    expect(tileProblem(tile)).toBe("Choose a column for each metric");
    tile.config.metrics = [{ agg: "count", column: null }];
    expect(tileProblem(tile)).toBeNull();
    expect(tileProblem({ ...tile, source: null })).toBe("Choose a data source");
    expect(tileProblem(newTile("text", []))).toBeNull();
  });

  it("ignores cosmetic changes in the query shape", () => {
    const tile = newTile("chart", [], source);
    tile.config = {
      chart: "bar",
      dimension: { column: "a" },
      metrics: [{ agg: "count", column: null }],
    };
    const renamed = structuredClone(tile);
    renamed.config.metrics![0].label = "Orders";
    renamed.config.metrics![0].format = { type: "percent" };
    renamed.title = "x";
    expect(JSON.stringify(queryShape(renamed))).toBe(JSON.stringify(queryShape(tile)));
  });

  it("only reports layout changes", () => {
    const tile = newTile("chart", [], source);
    const same = applyGridLayout([tile], [{ i: tile.id, ...tile.layout }]);
    expect(same[0]).toBe(tile);
    const moved = applyGridLayout([tile], [{ i: tile.id, ...tile.layout, x: 3 }]);
    expect(moved[0].layout.x).toBe(3);
  });
});

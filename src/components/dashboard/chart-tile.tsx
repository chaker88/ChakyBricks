import { useMemo } from "react";
import { EChart, type ChartClick } from "@/components/dashboard/echart";
import { CHART_INK, CHART_PALETTE } from "@/lib/chart";
import { toggleCrossFilter } from "@/lib/dashboard";
import {
  OTHER_KEY,
  SEQUENTIAL,
  buildChartModel,
  buildDashboardOption,
  dimensionLabel,
} from "@/lib/dashboard-chart";
import { useDashboardView } from "@/lib/dashboard-context";
import type { CrossFilter, TileData, TileSpec } from "@/lib/dashboard-types";
import { useTheme } from "@/lib/theme";

export function ChartTile({ tile, data }: { tile: TileSpec; data: TileData }) {
  const view = useDashboardView();
  const { theme } = useTheme();
  const { config } = tile;
  const kind = config.chart ?? "bar";
  const own = view.crossFilters.find((c) => c.tileId === tile.id);
  const dimensionColumn = config.dimension?.column;

  const model = useMemo(() => buildChartModel(config, data), [config, data]);
  const selected = useMemo(() => {
    const condition = own?.conditions.find((c) => c.column === dimensionColumn);
    return condition?.values?.length ? new Set<string | null>(condition.values.map(String)) : null;
  }, [own, dimensionColumn]);

  const option = useMemo(() => {
    if (model.keys.length === 0 && model.points.length === 0) return null;
    return buildDashboardOption(model, {
      tokens: { ...CHART_INK[theme], palette: CHART_PALETTE[theme] },
      color: (name) => view.colorFor(tile.id, name),
      ramp: SEQUENTIAL[theme],
      selected,
      showLabels: config.labels === true,
      dark: theme === "dark",
    });
  }, [model, theme, view, tile.id, selected, config.labels]);

  const crossFilterable = view.spec.cross_filter && !view.editing && !!config.dimension;

  const onClick = (click: ChartClick) => {
    if (!config.dimension) return;
    const additive =
      !!click.event && (click.event.ctrlKey || click.event.shiftKey || click.event.metaKey);
    const dimension = config.dimension;
    if (kind === "heatmap") {
      const cell = click.value as [number, number, number] | undefined;
      if (!cell || !config.breakdown) return;
      const key = model.keys[cell[0]];
      const seriesKey = model.seriesKeys[cell[1]];
      const same =
        own?.conditions.length === 2 &&
        own.conditions[0].values?.[0] === key &&
        own.conditions[1].values?.[0] === seriesKey;
      const next: CrossFilter | null = same
        ? null
        : {
            tileId: tile.id,
            conditions: [
              {
                column: dimension.column,
                kind: "in",
                values: [key],
                grain: dimension.grain ?? null,
              },
              {
                column: config.breakdown.column,
                kind: "in",
                values: [seriesKey],
                grain: config.breakdown.grain ?? null,
              },
            ],
            labels: [
              `${dimensionLabel(key, dimension.grain, true)} · ${dimensionLabel(seriesKey, config.breakdown.grain, true)}`,
            ],
          };
      view.setCrossFilter(tile.id, next);
      return;
    }
    const key = model.keys[click.dataIndex];
    if (click.dataIndex < 0 || key === OTHER_KEY || key === undefined) return;
    const next = toggleCrossFilter(
      own,
      tile.id,
      dimension.column,
      dimension.grain,
      key,
      model.labels[click.dataIndex],
      additive,
    );
    view.setCrossFilter(tile.id, next);
  };

  if (!option) {
    return (
      <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
        No data for the current filters
      </div>
    );
  }
  return (
    <div className="relative size-full min-h-0">
      <EChart option={option} onClick={crossFilterable ? onClick : undefined} />
    </div>
  );
}

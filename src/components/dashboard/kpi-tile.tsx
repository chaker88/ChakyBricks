import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useMemo } from "react";
import { EChart } from "@/components/dashboard/echart";
import { CHART_INK } from "@/lib/chart";
import { useDashboardView } from "@/lib/dashboard-context";
import type { TileData, TileSpec } from "@/lib/dashboard-types";
import { formatPercentChange, formatValue } from "@/lib/number-format";
import { toNumber } from "@/lib/chart";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const DELTA_TEXT = {
  light: { good: "#006300", bad: "#c32f2f" },
  dark: { good: "#0ca30c", bad: "#e66767" },
};

export function KpiTile({ tile, data }: { tile: TileSpec; data: TileData }) {
  const view = useDashboardView();
  const { theme } = useTheme();
  const metric = tile.config.metrics?.[0];
  const value = toNumber(data.rows[0]?.[0]);
  const comparison = data.comparison;
  const lowerIsBetter = tile.config.lowerIsBetter === true;

  const trendOption = useMemo(() => {
    const points = data.trend?.rows.map((row) => toNumber(row[1])) ?? [];
    if (points.length < 2) return null;
    const kpiIndex = view.spec.tiles
      .filter((t) => t.type === "kpi")
      .findIndex((t) => t.id === tile.id);
    const color = view.palette[Math.max(kpiIndex, 0) % view.palette.length];
    return {
      animationDuration: 300,
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: "category", show: false, data: points.map((_, i) => i) },
      yAxis: { type: "value", show: false, scale: true },
      series: [
        {
          type: "line",
          data: points,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 2, color },
          areaStyle: { color, opacity: 0.14 },
          silent: true,
        },
      ],
    };
  }, [data.trend, tile.id, view]);

  const change = comparison?.percent ?? null;
  const direction = comparison?.change ? Math.sign(comparison.change) : 0;
  const good = lowerIsBetter ? direction < 0 : direction > 0;
  const tone =
    direction === 0
      ? CHART_INK[theme].muted
      : good
        ? DELTA_TEXT[theme].good
        : DELTA_TEXT[theme].bad;
  const Icon = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : Minus;

  return (
    <div className="flex size-full min-h-0 flex-col justify-between gap-1">
      <div className="min-w-0">
        <div className="truncate text-[2rem] leading-tight font-semibold tracking-tight">
          {formatValue(value, metric?.format, true)}
        </div>
        {comparison && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
              style={{
                color: tone,
                backgroundColor: `color-mix(in oklab, ${tone} 12%, transparent)`,
              }}
            >
              <Icon className="size-3.5" strokeWidth={2.25} />
              {change !== null
                ? formatPercentChange(change)
                : formatValue(comparison.change, metric?.format, true)}
            </span>
            <span className="truncate text-muted-foreground">
              {comparison.label}
              {comparison.previous !== null &&
                ` (${formatValue(comparison.previous, metric?.format, true)})`}
            </span>
          </div>
        )}
        {!comparison && data.note && (
          <div className="mt-1 text-xs text-muted-foreground">{data.note}</div>
        )}
      </div>
      {trendOption && (
        <div className={cn("min-h-8 flex-1")}>
          <EChart option={trendOption} />
        </div>
      )}
    </div>
  );
}

import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RowSet } from "@/lib/api-types";
import {
  CHART_INK,
  CHART_PALETTE,
  buildChartOption,
  chartData,
  defaultChartConfig,
  isNumericColumn,
  maxSeries,
  type ChartConfig,
  type ChartKind,
} from "@/lib/chart";
import { useTheme } from "@/lib/theme";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const KINDS: { value: ChartKind; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "scatter", label: "Scatter" },
  { value: "pie", label: "Donut" },
];
const ROW_NUMBER = "__row__";

export function ResultChart({ data }: { data: RowSet }) {
  const [config, setConfig] = useState<ChartConfig | null>(() => defaultChartConfig(data.columns));
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const numericColumns = data.columns.flatMap((c, i) => (isNumericColumn(c) ? [i] : []));

  const option = useMemo(() => {
    if (!config || config.y.length === 0) return null;
    return buildChartOption(config, chartData(config, data), {
      ...CHART_INK[theme],
      palette: CHART_PALETTE[theme],
    });
  }, [config, data, theme]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (option) chartRef.current?.setOption(option, { notMerge: true });
    else chartRef.current?.clear();
  }, [option]);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Charts need at least one numeric column in the result.
      </div>
    );
  }

  const limit = maxSeries(config.kind);
  const toggleY = (index: number, checked: boolean) =>
    setConfig({
      ...config,
      y: checked ? [...config.y, index].slice(-limit) : config.y.filter((i) => i !== index),
    });

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-56 shrink-0 space-y-4 overflow-y-auto border-r p-3 text-xs">
        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground">Chart</div>
          <Select
            value={config.kind}
            onValueChange={(kind) =>
              setConfig({
                ...config,
                kind: kind as ChartKind,
                y: config.y.slice(0, maxSeries(kind as ChartKind)),
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value} className="text-xs">
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground">
            {config.kind === "pie"
              ? "Slices"
              : config.kind === "scatter"
                ? "X axis (numeric)"
                : "X axis"}
          </div>
          <Select
            value={config.x === null ? ROW_NUMBER : String(config.x)}
            onValueChange={(value) =>
              setConfig({ ...config, x: value === ROW_NUMBER ? null : Number(value) })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROW_NUMBER} className="text-xs">
                Row number
              </SelectItem>
              {data.columns.map((c, i) => (
                <SelectItem key={i} value={String(i)} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground">
            {config.kind === "pie" ? "Value" : `Values (max ${limit})`}
          </div>
          {numericColumns.map((index) => (
            <label key={index} className="flex items-center gap-2">
              <Checkbox
                checked={config.y.includes(index)}
                onCheckedChange={(checked) => toggleY(index, checked === true)}
              />
              <span className="truncate">{data.columns[index].name}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Charts the {data.rows.length.toLocaleString()} rows loaded in the grid.
        </p>
      </aside>
      <div className="relative min-w-0 flex-1 p-3">
        <div ref={containerRef} className="h-full w-full" />
        {!option && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Pick at least one value column
          </div>
        )}
      </div>
    </div>
  );
}

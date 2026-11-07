import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  GraphicComponent,
  CanvasRenderer,
]);

export interface ChartClick {
  dataIndex: number;
  value: unknown;
  event: MouseEvent | undefined;
}

export function EChart({
  option,
  onClick,
  className,
}: {
  option: Record<string, unknown> | null;
  onClick?: (click: ChartClick) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);

  useEffect(() => {
    clickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.on("click", (params) => {
      const p = params as { dataIndex?: number; value?: unknown; event?: { event?: MouseEvent } };
      clickRef.current?.({
        dataIndex: p.dataIndex ?? -1,
        value: p.value,
        event: p.event?.event,
      });
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
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

  return (
    <div ref={containerRef} className={cn("size-full", onClick && "cursor-pointer", className)} />
  );
}

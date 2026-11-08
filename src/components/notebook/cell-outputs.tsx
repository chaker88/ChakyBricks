import { useEffect, useRef } from "react";
import { ResultGrid } from "@/components/result-grid";
import type { RowSet } from "@/lib/api-types";
import { parseAnsi } from "@/lib/ansi";
import { formatNumber, plural } from "@/lib/format";
import { renderMarkdown, sanitizeHtml, sanitizeSvg } from "@/lib/markdown";
import {
  PLOTLY_MIME,
  TABLE_MIME,
  applyCarriageReturns,
  joinText,
  type MimeBundle,
  type Output,
} from "@/lib/notebook";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface TablePayload extends RowSet {
  row_count: number;
  truncated: boolean;
}

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 46;
const MAX_TABLE_HEIGHT = 420;

export function CellOutputs({ outputs }: { outputs: Output[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="space-y-2 border-t px-3 py-2.5 text-xs select-text">
      {outputs.map((output, index) => (
        <OutputView key={index} output={output} />
      ))}
    </div>
  );
}

function OutputView({ output }: { output: Output }) {
  if (output.output_type === "stream") {
    return (
      <Ansi
        text={applyCarriageReturns(output.text)}
        className={output.name === "stderr" ? "rounded bg-amber-500/10 px-2 py-1" : undefined}
      />
    );
  }
  if (output.output_type === "error") {
    return (
      <Ansi
        text={
          output.traceback.length
            ? output.traceback.join("\n")
            : `${output.ename}: ${output.evalue}`
        }
        className="rounded bg-destructive/10 px-2 py-1.5"
      />
    );
  }
  return <MimeView data={output.data} />;
}

function MimeView({ data }: { data: MimeBundle }) {
  if (data[TABLE_MIME]) return <TableOutput payload={data[TABLE_MIME] as TablePayload} />;
  if (data[PLOTLY_MIME]) return <PlotlyOutput figure={data[PLOTLY_MIME] as PlotlyFigure} />;
  for (const mime of ["image/png", "image/jpeg", "image/gif"]) {
    if (data[mime]) {
      return (
        <img
          alt="Output"
          className="max-w-full rounded bg-white"
          src={`data:${mime};base64,${joinText(data[mime]).replace(/\n/g, "")}`}
        />
      );
    }
  }
  if (data["image/svg+xml"]) {
    return (
      <div
        className="max-w-full overflow-auto rounded bg-white"
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(joinText(data["image/svg+xml"])) }}
      />
    );
  }
  if (data["text/html"]) {
    return (
      <div
        className="html-output max-w-full overflow-auto"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(joinText(data["text/html"])) }}
      />
    );
  }
  if (data["text/markdown"]) {
    return (
      <div
        className="markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(joinText(data["text/markdown"])) }}
      />
    );
  }
  if (data["application/json"]) {
    return <Ansi text={JSON.stringify(data["application/json"], null, 2)} />;
  }
  return <Ansi text={joinText(data["text/plain"])} />;
}

function TableOutput({ payload }: { payload: TablePayload }) {
  const height = Math.min(MAX_TABLE_HEIGHT, HEADER_HEIGHT + payload.rows.length * ROW_HEIGHT + 2);
  return (
    <div className="space-y-1">
      <div className="overflow-hidden rounded-md border" style={{ height }}>
        <ResultGrid data={payload} className="h-full" />
      </div>
      <div className="text-[11px] text-muted-foreground">
        {payload.truncated
          ? `Showing ${formatNumber(payload.rows.length)} of ${plural(payload.row_count, "row")}`
          : `${formatNumber(payload.row_count)} ${payload.row_count === 1 ? "row" : "rows"}`}
      </div>
    </div>
  );
}

interface PlotlyFigure {
  data: unknown[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

function PlotlyOutput({ figure }: { figure: PlotlyFigure }) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import("plotly.js-dist-min").then(({ default: Plotly }) => {
      if (disposed) return;
      const dark = theme === "dark";
      const layout = {
        ...figure.layout,
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: dark ? "#e4e4e7" : "#27272a" },
        autosize: true,
      };
      void Plotly.newPlot(element, figure.data, layout, {
        responsive: true,
        displaylogo: false,
        ...figure.config,
      });
      observer = new ResizeObserver(() => Plotly.Plots.resize(element));
      observer.observe(element);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      void import("plotly.js-dist-min").then(({ default: Plotly }) => Plotly.purge(element));
    };
  }, [figure, theme]);

  return <div ref={ref} className="h-[420px] w-full" />;
}

function Ansi({ text, className }: { text: string; className?: string }) {
  return (
    <pre className={cn("font-mono text-xs leading-5 break-words whitespace-pre-wrap", className)}>
      {parseAnsi(text).map((segment, index) => (
        <span key={index} className={cn(segment.color, segment.bold && "font-semibold")}>
          {segment.text}
        </span>
      ))}
    </pre>
  );
}

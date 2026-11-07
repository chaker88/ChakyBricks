import {
  ChartArea,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  ChartScatter,
  Donut,
  Grid3x3,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCatalog } from "@/hooks/use-api";
import { useSourceColumns } from "@/hooks/use-dashboards";
import { useSavedQueries } from "@/hooks/use-sql";
import type { ColumnInfo } from "@/lib/api-types";
import { typeCategory } from "@/lib/column-types";
import { metricLabel } from "@/lib/dashboard-chart";
import type {
  Aggregation,
  ChartKind,
  FieldRef,
  FormatType,
  Grain,
  Metric,
  Sort,
  TileConfig,
  TileSpec,
} from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

const CHART_KINDS: { value: ChartKind; label: string; icon: LucideIcon }[] = [
  { value: "bar", label: "Bar", icon: ChartColumn },
  { value: "stacked_bar", label: "Stacked", icon: ChartColumnStacked },
  { value: "line", label: "Line", icon: ChartLine },
  { value: "area", label: "Area", icon: ChartArea },
  { value: "combo", label: "Combo", icon: ChartNoAxesCombined },
  { value: "pie", label: "Pie", icon: ChartPie },
  { value: "donut", label: "Donut", icon: Donut },
  { value: "scatter", label: "Scatter", icon: ChartScatter },
  { value: "heatmap", label: "Heatmap", icon: Grid3x3 },
];

const AGGREGATIONS: { value: Aggregation; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "count", label: "Count" },
  { value: "count_distinct", label: "Count distinct" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

const GRAINS: { value: Grain; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

const FORMATS: { value: FormatType; label: string }[] = [
  { value: "auto", label: "Auto (1.2K)" },
  { value: "number", label: "Number" },
  { value: "compact", label: "Compact" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
];

const NONE = "__none__";

function maxMetrics(kind: ChartKind, hasBreakdown: boolean): number {
  if (kind === "pie" || kind === "donut" || kind === "heatmap" || hasBreakdown) return 1;
  return kind === "scatter" ? 2 : 6;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b px-4 py-3.5 last:border-b-0">
      <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ColumnSelect({
  columns,
  value,
  onChange,
  placeholder = "Choose a column",
  optional = false,
}: {
  columns: ColumnInfo[];
  value: string | null | undefined;
  onChange: (column: string | null) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className="w-full min-w-0 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {optional && (
          <SelectItem value={NONE} className="text-xs text-muted-foreground">
            None
          </SelectItem>
        )}
        {!optional && value == null && (
          <SelectItem value={NONE} disabled className="text-xs">
            {placeholder}
          </SelectItem>
        )}
        {columns.map((c) => (
          <SelectItem key={c.name} value={c.name} className="text-xs">
            <span dir="auto">{c.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FieldEditor({
  columns,
  field,
  onChange,
  placeholder,
  optional,
}: {
  columns: ColumnInfo[];
  field: FieldRef | null | undefined;
  onChange: (field: FieldRef | null) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  const type = columns.find((c) => c.name === field?.column)?.type ?? "";
  const isDate = typeCategory(type) === "date";
  return (
    <div className="flex gap-1.5">
      <div className="min-w-0 flex-1">
        <ColumnSelect
          columns={columns}
          value={field?.column}
          placeholder={placeholder}
          optional={optional}
          onChange={(column) => {
            if (!column) return onChange(null);
            const date =
              typeCategory(columns.find((c) => c.name === column)?.type ?? "") === "date";
            onChange({ column, grain: date ? (field?.grain ?? "day") : null });
          }}
        />
      </div>
      {field && isDate && (
        <Select
          value={field.grain ?? NONE}
          onValueChange={(v) => onChange({ ...field, grain: v === NONE ? null : (v as Grain) })}
        >
          <SelectTrigger size="sm" className="w-24 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs">
              Raw
            </SelectItem>
            {GRAINS.map((g) => (
              <SelectItem key={g.value} value={g.value} className="text-xs">
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function MetricEditor({
  columns,
  metric,
  onChange,
  onRemove,
  combo,
}: {
  columns: ColumnInfo[];
  metric: Metric;
  onChange: (metric: Metric) => void;
  onRemove?: () => void;
  combo?: boolean;
}) {
  const numeric = columns.filter((c) => typeCategory(c.type) === "number");
  const usable = metric.agg === "sum" || metric.agg === "avg" ? numeric : columns;
  const format = metric.format?.type ?? "auto";
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
      <div className="flex gap-1.5">
        <Select
          value={metric.agg}
          onValueChange={(agg) => {
            const next = agg as Aggregation;
            const needsNumeric = next === "sum" || next === "avg";
            const keep =
              metric.column &&
              (!needsNumeric ||
                typeCategory(columns.find((c) => c.name === metric.column)?.type ?? "") ===
                  "number");
            onChange({
              ...metric,
              agg: next,
              column: next === "count" ? null : keep ? metric.column : null,
            });
          }}
        >
          <SelectTrigger size="sm" className="w-28 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGGREGATIONS.map((a) => (
              <SelectItem key={a.value} value={a.value} className="text-xs">
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 flex-1">
          <ColumnSelect
            columns={usable}
            value={metric.column}
            optional={metric.agg === "count"}
            placeholder={metric.agg === "count" ? "All rows" : "Choose a column"}
            onChange={(column) => onChange({ ...metric, column })}
          />
        </div>
        {onRemove && (
          <Button size="icon-sm" variant="ghost" aria-label="Remove metric" onClick={onRemove}>
            <X />
          </Button>
        )}
      </div>
      <div className="flex gap-1.5">
        <Input
          dir="auto"
          value={metric.label ?? ""}
          onChange={(e) => onChange({ ...metric, label: e.target.value })}
          placeholder={metricLabel({ ...metric, label: "" })}
          className="h-8 min-w-0 flex-1 text-xs md:text-xs"
        />
        <Select
          value={format}
          onValueChange={(type) =>
            onChange({ ...metric, format: { ...metric.format, type: type as FormatType } })
          }
        >
          <SelectTrigger size="sm" className="w-28 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {combo && (
        <Select
          value={metric.shape ?? "bar"}
          onValueChange={(shape) => onChange({ ...metric, shape: shape as "bar" | "line" })}
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bar" className="text-xs">
              Draw as bars
            </SelectItem>
            <SelectItem value="line" className="text-xs">
              Draw as line
            </SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function SortEditor({
  sort,
  onChange,
  dimensionCount,
  metrics,
  dimensionLabels,
}: {
  sort: Sort | null | undefined;
  onChange: (sort: Sort | null) => void;
  dimensionCount: number;
  metrics: Metric[];
  dimensionLabels: string[];
}) {
  const options: { value: string; label: string }[] = [
    ...Array.from({ length: Math.max(dimensionCount, 1) }, (_, i) => ({
      value: `dimension:${i}`,
      label: dimensionLabels[i] ?? "Dimension",
    })),
    ...metrics.map((m, i) => ({ value: `metric:${i}`, label: metricLabel(m) })),
  ];
  const current = sort ? `${sort.by}:${sort.index}` : NONE;
  return (
    <div className="flex gap-1.5">
      <Select
        value={current}
        onValueChange={(value) => {
          if (value === NONE) return onChange(null);
          const [by, index] = value.split(":");
          onChange({
            by: by as Sort["by"],
            index: Number(index),
            direction: sort?.direction ?? (by === "metric" ? "desc" : "asc"),
          });
        }}
      >
        <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-xs">
            Automatic
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              <span dir="auto">{o.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={sort?.direction ?? "desc"}
        disabled={!sort}
        onValueChange={(direction) =>
          sort && onChange({ ...sort, direction: direction as Sort["direction"] })
        }
      >
        <SelectTrigger size="sm" className="w-24 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc" className="text-xs">
            High → low
          </SelectItem>
          <SelectItem value="asc" className="text-xs">
            Low → high
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function LimitInput({
  value,
  onCommit,
  max,
}: {
  value: number | null | undefined;
  onCommit: (value: number | null) => void;
  max: number;
}) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  return (
    <Input
      inputMode="numeric"
      value={draft}
      placeholder="Automatic"
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
      onBlur={() => {
        const parsed = draft ? Math.min(Math.max(1, Number(draft)), max) : null;
        setDraft(parsed ? String(parsed) : "");
        onCommit(parsed);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-8 text-xs md:text-xs"
    />
  );
}

function SourceEditor({ tile, onChange }: { tile: TileSpec; onChange: (tile: TileSpec) => void }) {
  const catalog = useCatalog();
  const saved = useSavedQueries();
  const kind = tile.source?.kind ?? "table";
  const tables = catalog.data?.schemas.flatMap((s) => s.tables) ?? [];

  const setSource = (source: TileSpec["source"]) =>
    onChange({
      ...tile,
      source,
      config: {
        ...tile.config,
        dimension: null,
        breakdown: null,
        dimensions: [],
        metrics: [],
        sort: null,
        compare: null,
        trend: null,
      },
    });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5 text-xs">
        {(["table", "query"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() =>
              k !== kind &&
              setSource(
                k === "table" ? { kind: "table", table: null } : { kind: "query", query_id: null },
              )
            }
            className={cn(
              "rounded px-2 py-1 font-medium transition-colors",
              kind === k
                ? "bg-background shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "table" ? "Table" : "Saved query"}
          </button>
        ))}
      </div>
      {kind === "table" ? (
        <Select
          value={tile.source?.table ?? ""}
          onValueChange={(table) => setSource({ kind: "table", table })}
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue placeholder="Choose a table" />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem
                key={`${t.schema}.${t.name}`}
                value={`${t.schema}.${t.name}`}
                className="text-xs"
              >
                {t.schema}.{t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select
          value={tile.source?.query_id ? String(tile.source.query_id) : ""}
          onValueChange={(id) => setSource({ kind: "query", query_id: Number(id) })}
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue placeholder="Choose a saved query" />
          </SelectTrigger>
          <SelectContent>
            {(saved.data ?? []).map((q) => (
              <SelectItem key={q.id} value={String(q.id)} className="text-xs">
                <span dir="auto">{q.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {kind === "query" && (saved.data ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground">
          Save a query from the SQL editor to use it here.
        </p>
      )}
    </div>
  );
}

export function TileEditor({
  tile,
  onChange,
  onClose,
}: {
  tile: TileSpec;
  onChange: (tile: TileSpec) => void;
  onClose: () => void;
}) {
  const columnsQuery = useSourceColumns(tile.type === "text" ? null : tile.source);
  const columns = columnsQuery.data ?? [];
  const { config } = tile;
  const patch = (changes: Partial<TileConfig>) =>
    onChange({ ...tile, config: { ...config, ...changes } });
  const metrics = config.metrics ?? [];
  const kind = config.chart ?? "bar";
  const dates = columns.filter((c) => typeCategory(c.type) === "date");
  const dimensions = config.dimensions ?? [];

  const setMetric = (index: number, metric: Metric) =>
    patch({ metrics: metrics.map((m, i) => (i === index ? metric : m)) });
  const addMetric = () =>
    patch({
      metrics: [
        ...metrics,
        { agg: "count", column: null, ...(kind === "combo" ? { shape: "line" as const } : {}) },
      ],
    });
  const limit = maxMetrics(kind, !!config.breakdown);

  const metricList = (max: number, combo = false) => (
    <div className="space-y-2">
      {metrics.map((metric, i) => (
        <MetricEditor
          key={i}
          columns={columns}
          metric={metric}
          combo={combo}
          onChange={(m) => setMetric(i, m)}
          onRemove={
            metrics.length > 1 || tile.type === "table"
              ? () => patch({ metrics: metrics.filter((_, j) => j !== i) })
              : undefined
          }
        />
      ))}
      {metrics.length < max && (
        <Button size="xs" variant="outline" onClick={addMetric}>
          <Plus /> Add metric
        </Button>
      )}
    </div>
  );

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <h3 className="text-sm font-semibold capitalize">{tile.type} settings</h3>
        <Button size="icon-xs" variant="ghost" aria-label="Close settings" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Title">
          <Input
            dir="auto"
            value={tile.title}
            onChange={(e) => onChange({ ...tile, title: e.target.value })}
            placeholder="Untitled"
            className="h-8 text-sm md:text-sm"
          />
        </Section>

        {tile.type === "text" && (
          <Section title="Content (markdown)">
            <Textarea
              dir="auto"
              value={config.text ?? ""}
              onChange={(e) => patch({ text: e.target.value })}
              rows={10}
              className="font-mono text-xs"
            />
          </Section>
        )}

        {tile.type !== "text" && (
          <Section title="Data">
            <SourceEditor tile={tile} onChange={onChange} />
            {columnsQuery.isError && (
              <p className="text-xs text-destructive">{columnsQuery.error.message}</p>
            )}
          </Section>
        )}

        {tile.type === "chart" && columns.length > 0 && (
          <>
            <Section title="Chart type">
              <div className="grid grid-cols-3 gap-1.5">
                {CHART_KINDS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      const cap = maxMetrics(value, false);
                      patch({
                        chart: value,
                        metrics: metrics.slice(0, cap),
                        breakdown:
                          value === "pie" ||
                          value === "donut" ||
                          value === "scatter" ||
                          value === "combo"
                            ? null
                            : config.breakdown,
                      });
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition-colors hover:bg-accent",
                      kind === value && "border-primary bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                    {label}
                  </button>
                ))}
              </div>
            </Section>
            <Section title={kind === "scatter" ? "Point (one per value)" : "Dimension"}>
              <FieldEditor
                columns={columns}
                field={config.dimension}
                onChange={(dimension) => patch({ dimension })}
              />
            </Section>
            {(kind === "bar" ||
              kind === "stacked_bar" ||
              kind === "line" ||
              kind === "area" ||
              kind === "heatmap") && (
              <Section title={kind === "heatmap" ? "Breakdown (rows)" : "Breakdown (optional)"}>
                <FieldEditor
                  columns={columns}
                  field={config.breakdown}
                  optional={kind !== "heatmap"}
                  placeholder="None"
                  onChange={(breakdown) =>
                    patch({
                      breakdown,
                      metrics: breakdown ? metrics.slice(0, 1) : metrics,
                    })
                  }
                />
              </Section>
            )}
            <Section
              title={
                kind === "scatter" ? "Metrics (X, then Y)" : limit === 1 ? "Metric" : "Metrics"
              }
            >
              {metricList(limit, kind === "combo")}
              {kind === "combo" && (
                <p className="text-[11px] text-muted-foreground">
                  Bars and lines share one axis, so combine measures with the same unit.
                </p>
              )}
            </Section>
            <Section title="Sort and limit">
              <SortEditor
                sort={config.sort}
                onChange={(sort) => patch({ sort })}
                dimensionCount={1}
                dimensionLabels={[config.dimension?.column ?? "Dimension"]}
                metrics={config.breakdown ? metrics.slice(0, 1) : metrics}
              />
              <Row label="Max values">
                <LimitInput
                  value={config.limit}
                  max={5000}
                  onCommit={(value) => patch({ limit: value })}
                />
              </Row>
            </Section>
            <Section title="Display">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={config.labels === true}
                  onCheckedChange={(checked) => patch({ labels: checked === true })}
                />
                Show data labels
              </label>
            </Section>
          </>
        )}

        {tile.type === "kpi" && columns.length > 0 && (
          <>
            <Section title="Metric">
              <MetricEditor
                columns={columns}
                metric={metrics[0] ?? { agg: "count", column: null }}
                onChange={(m) => patch({ metrics: [m] })}
              />
            </Section>
            <Section title="Comparison">
              <Select
                value={config.compare?.mode ?? NONE}
                onValueChange={(mode) =>
                  patch({
                    compare:
                      mode === NONE
                        ? null
                        : {
                            mode: mode as "previous_period" | "previous_year",
                            column: config.compare?.column ?? dates[0]?.name ?? "",
                          },
                  })
                }
              >
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">
                    No comparison
                  </SelectItem>
                  <SelectItem value="previous_period" className="text-xs">
                    Previous period
                  </SelectItem>
                  <SelectItem value="previous_year" className="text-xs">
                    Same period last year
                  </SelectItem>
                </SelectContent>
              </Select>
              {config.compare && (
                <Row label="Date column (uses the dashboard's date filter)">
                  <ColumnSelect
                    columns={dates}
                    value={config.compare.column}
                    onChange={(column) =>
                      column && patch({ compare: { ...config.compare!, column } })
                    }
                  />
                </Row>
              )}
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={config.lowerIsBetter === true}
                  onCheckedChange={(checked) => patch({ lowerIsBetter: checked === true })}
                />
                Lower is better (flips the colours)
              </label>
            </Section>
            <Section title="Trend line">
              <FieldEditor
                columns={dates}
                field={config.trend}
                optional
                placeholder="None"
                onChange={(trend) => patch({ trend })}
              />
            </Section>
          </>
        )}

        {tile.type === "table" && columns.length > 0 && (
          <>
            <Section title="Columns">
              <div className="space-y-2">
                {dimensions.map((field, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      <FieldEditor
                        columns={columns}
                        field={field}
                        onChange={(next) =>
                          patch({
                            dimensions: dimensions.flatMap((d, j) =>
                              j === i ? (next ? [next] : []) : [d],
                            ),
                          })
                        }
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove column"
                      onClick={() => patch({ dimensions: dimensions.filter((_, j) => j !== i) })}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => patch({ dimensions: [...dimensions, { column: "" }] })}
                >
                  <Plus /> Add column
                </Button>
              </div>
            </Section>
            <Section title="Metrics (optional)">{metricList(8)}</Section>
            <Section title="Sort and limit">
              <SortEditor
                sort={config.sort}
                onChange={(sort) => patch({ sort })}
                dimensionCount={dimensions.length}
                dimensionLabels={dimensions.map((d) => d.column || "Column")}
                metrics={metrics}
              />
              <Row label="Max rows (up to 1,000)">
                <LimitInput
                  value={config.limit}
                  max={1000}
                  onCommit={(value) => patch({ limit: value })}
                />
              </Row>
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

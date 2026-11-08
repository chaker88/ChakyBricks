import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  ListFilter,
  MousePointerClick,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { FilterEditorDialog } from "@/components/dashboard/filter-editor";
import { TileEditor } from "@/components/dashboard/tile-editor";
import { EmptyState } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/hooks/use-api";
import {
  dashboardKeys,
  requestFreshTiles,
  useDashboard,
  useUpdateDashboard,
} from "@/hooks/use-dashboards";
import { CHART_PALETTE } from "@/lib/chart";
import {
  applyGridLayout,
  duplicateTile,
  filterConditions,
  filterSummary,
  initialFilterState,
  newTile,
  type FilterState,
} from "@/lib/dashboard";
import { PALETTE_LABELS, rotatePalette } from "@/lib/dashboard-chart";
import { ColorAssigner, DashboardViewContext, type DashboardView } from "@/lib/dashboard-context";
import { exportDashboard, type ExportFormat } from "@/lib/dashboard-export";
import type {
  BackgroundName,
  Dashboard,
  CrossFilter,
  DashboardSpec,
  FilterSpec,
  FilterValue,
  PaletteName,
  TileSpec,
  TileType,
} from "@/lib/dashboard-types";
import { SEQUENTIAL } from "@/lib/dashboard-chart";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const BACKGROUNDS: Record<BackgroundName, { label: string; className: string }> = {
  default: { label: "Default", className: "bg-background" },
  muted: { label: "Soft", className: "bg-muted/60" },
  canvas: { label: "Contrast", className: "bg-secondary" },
};

const REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "10", label: "Every 10 seconds" },
  { value: "30", label: "Every 30 seconds" },
  { value: "60", label: "Every minute" },
  { value: "300", label: "Every 5 minutes" },
  { value: "900", label: "Every 15 minutes" },
];

const TILE_TYPES: { type: TileType; label: string }[] = [
  { type: "chart", label: "Chart" },
  { type: "kpi", label: "KPI scorecard" },
  { type: "table", label: "Table" },
  { type: "text", label: "Text" },
];

export default function DashboardPage() {
  const { id } = useParams();
  const dashboard = useDashboard(Number(id));

  if (dashboard.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={LayoutDashboard}
          title="Dashboard not found"
          description={dashboard.error.message}
          action={
            <Button asChild variant="outline">
              <Link to="/dashboards">Back to dashboards</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (!dashboard.data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  return <DashboardEditor key={dashboard.data.id} dashboard={dashboard.data} />;
}

function ThemePopover({
  spec,
  onChange,
}: {
  spec: DashboardSpec;
  onChange: (spec: DashboardSpec) => void;
}) {
  const { theme } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Palette />
          Style
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Colour palette</div>
          <div className="space-y-1">
            {(Object.keys(PALETTE_LABELS) as PaletteName[]).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onChange({ ...spec, theme: { ...spec.theme, palette: name } })}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent",
                  spec.theme.palette === name && "border-primary bg-primary/5",
                )}
              >
                {PALETTE_LABELS[name]}
                <span className="flex gap-0.5">
                  {rotatePalette(CHART_PALETTE[theme], name)
                    .slice(0, 5)
                    .map((color) => (
                      <span
                        key={color}
                        className="size-3.5 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Background</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(BACKGROUNDS) as BackgroundName[]).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onChange({ ...spec, theme: { ...spec.theme, background: name } })}
                className={cn(
                  "rounded-md border px-2 py-2 text-xs hover:bg-accent",
                  BACKGROUNDS[name].className,
                  spec.theme.background === name && "border-primary ring-1 ring-primary",
                )}
              >
                {BACKGROUNDS[name].label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Auto-refresh</div>
          <Select
            value={String(spec.refresh_seconds ?? 0)}
            onValueChange={(value) =>
              onChange({ ...spec, refresh_seconds: value === "0" ? null : Number(value) })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFRESH_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Re-runs the tile queries while this page is open. Results are cached until a table
            changes.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DashboardEditor({ dashboard }: { dashboard: Dashboard }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const update = useUpdateDashboard();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(() => searchParams.has("edit"));
  const [draft, setDraft] = useState({ name: dashboard.name, spec: dashboard.spec });
  const [filterState, setFilterState] = useState<FilterState>(() =>
    initialFilterState(dashboard.spec.filters),
  );
  const [crossFilters, setCrossFilters] = useState<CrossFilter[]>([]);
  const [viewCross, setViewCross] = useState(dashboard.spec.cross_filter);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [colors] = useState(() => new ColorAssigner());
  const [seriesNames, setSeriesNames] = useState<Record<string, string[]>>({});
  const reportSeries = useCallback(
    (tileId: string, names: string[]) =>
      setSeriesNames((current) =>
        current[tileId]?.join(" ") === names.join(" ") ? current : { ...current, [tileId]: names },
      ),
    [],
  );
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchParams.has("edit")) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const spec: DashboardSpec = editing ? draft.spec : dashboard.spec;
  const crossEnabled = editing ? draft.spec.cross_filter : viewCross;
  const dirty =
    editing &&
    (draft.name !== dashboard.name ||
      JSON.stringify(draft.spec) !== JSON.stringify(dashboard.spec));

  const palette = useMemo(
    () => rotatePalette(CHART_PALETTE[theme], spec.theme.palette),
    [theme, spec.theme.palette],
  );
  const colorsFor = useCallback(
    (tileId: string, names: readonly string[], overrides: Record<string, number> | undefined) => {
      const slots = colors.assign(tileId, names);
      return (name: string) => {
        const slot = overrides?.[name] ?? slots.get(name) ?? 0;
        return palette[slot % palette.length];
      };
    },
    [palette, colors],
  );
  const conditions = useMemo(
    () => filterConditions(spec.filters, filterState),
    [spec.filters, filterState],
  );
  const selectedTile = editing ? spec.tiles.find((t) => t.id === selectedTileId) : undefined;

  const setCrossFilter = useCallback((tileId: string, filter: CrossFilter | null) => {
    setCrossFilters((current) => [
      ...current.filter((c) => c.tileId !== tileId),
      ...(filter ? [filter] : []),
    ]);
  }, []);

  const view: DashboardView = useMemo(
    () => ({
      spec: { ...spec, cross_filter: crossEnabled },
      editing,
      conditions,
      crossFilters: crossEnabled ? crossFilters : [],
      selectedTileId,
      colorsFor,
      palette,
      seriesNames,
      reportSeries,
      ramp: SEQUENTIAL[theme],
      setCrossFilter,
      selectTile: setSelectedTileId,
    }),
    [
      spec,
      crossEnabled,
      editing,
      conditions,
      crossFilters,
      selectedTileId,
      colorsFor,
      palette,
      seriesNames,
      reportSeries,
      theme,
      setCrossFilter,
    ],
  );

  const updateSpec = useCallback(
    (change: (spec: DashboardSpec) => DashboardSpec) =>
      setDraft((current) => ({ ...current, spec: change(current.spec) })),
    [],
  );
  const updateTile = (tile: TileSpec) =>
    updateSpec((s) => ({ ...s, tiles: s.tiles.map((t) => (t.id === tile.id ? tile : t)) }));

  const startEditing = () => {
    setDraft({ name: dashboard.name, spec: structuredClone(dashboard.spec) });
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setSelectedTileId(null);
    setCrossFilters([]);
    setViewCross(dashboard.spec.cross_filter);
  };
  const save = () => {
    update.mutate(
      { id: dashboard.id, name: draft.name, spec: draft.spec },
      {
        onSuccess: (saved) => {
          toast.success("Dashboard saved");
          setViewCross(saved.spec.cross_filter);
          setEditing(false);
          setSelectedTileId(null);
          setCrossFilters([]);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const addTile = (type: TileType) => {
    const last = [...spec.tiles].reverse().find((t) => t.source);
    const source = selectedTile?.source ?? last?.source ?? undefined;
    const tile = newTile(type, spec.tiles, source ? structuredClone(source) : undefined);
    updateSpec((s) => ({ ...s, tiles: [...s.tiles, tile] }));
    setSelectedTileId(tile.id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-tile-id="${tile.id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  const onLayoutChange = useCallback(
    (items: readonly { i: string; x: number; y: number; w: number; h: number }[]) =>
      updateSpec((s) => {
        const tiles = applyGridLayout(s.tiles, items);
        return tiles === s.tiles ? s : { ...s, tiles };
      }),
    [updateSpec],
  );

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) save();
      } else if (
        !typing &&
        selectedTileId &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        updateSpec((s) => ({ ...s, tiles: s.tiles.filter((t) => t.id !== selectedTileId) }));
        setSelectedTileId(null);
      } else if (event.key === "Escape" && selectedTileId && !typing) {
        setSelectedTileId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const refresh = () => {
    requestFreshTiles();
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.tile });
  };

  const runExport = async (format: ExportFormat) => {
    if (!client || !exportRef.current) return;
    setExporting(format);
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const background = getComputedStyle(exportRef.current).backgroundColor;
      const saved = await exportDashboard(
        client,
        exportRef.current,
        background === "rgba(0, 0, 0, 0)" ? (theme === "dark" ? "#18181b" : "#fafafa") : background,
        dashboard.name,
        format,
      );
      if (saved) toast.success(`Exported to ${saved}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const setFilter = (filterId: string, value: FilterValue | undefined) =>
    setFilterState((current) => {
      const next = { ...current };
      if (value) next[filterId] = value;
      else delete next[filterId];
      return next;
    });

  const activeFilters = spec.filters.filter((f) => filterState[f.id]);

  return (
    <DashboardViewContext.Provider value={view}>
      <div className="flex h-full min-h-0 flex-col">
        <header
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2.5",
            editing && "border-primary/30 bg-primary/5",
          )}
        >
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to dashboards">
            <Link to="/dashboards">
              <ArrowLeft />
            </Link>
          </Button>
          {editing ? (
            <Input
              dir="auto"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-8 max-w-sm min-w-40 flex-1 text-base font-semibold md:text-base"
              aria-label="Dashboard name"
            />
          ) : (
            <h1 dir="auto" className="min-w-0 truncate text-lg font-semibold tracking-tight">
              {dashboard.name}
            </h1>
          )}
          {editing && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
              Editing{dirty ? " · unsaved" : ""}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={crossEnabled}
              onClick={() => {
                if (editing) updateSpec((s) => ({ ...s, cross_filter: !s.cross_filter }));
                else setViewCross((v) => !v);
                setCrossFilters([]);
              }}
              className={cn(crossEnabled && "border-primary/50 bg-primary/10 text-primary")}
              title="Clicking a bar, slice or cell filters the other tiles"
            >
              <MousePointerClick />
              Cross-filter {crossEnabled ? "on" : "off"}
            </Button>
            {editing ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Plus />
                      Add tile
                      <ChevronDown className="opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {TILE_TYPES.map((t) => (
                      <DropdownMenuItem key={t.type} onSelect={() => addTile(t.type)}>
                        {t.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
                  <ListFilter />
                  Filters
                </Button>
                <ThemePopover spec={draft.spec} onChange={(next) => updateSpec(() => next)} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (dirty ? setConfirmDiscard(true) : stopEditing())}
                >
                  <Undo2 />
                  {dirty ? "Discard" : "Cancel"}
                </Button>
                <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
                  <Save />
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={refresh}>
                  <RefreshCw />
                  Refresh
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={exporting !== null}>
                      <Download />
                      {exporting ? "Exporting…" : "Export"}
                      <ChevronDown className="opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void runExport("png")}>
                      <ImageIcon />
                      PNG image
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void runExport("pdf")}>
                      <FileText />
                      PDF document
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" onClick={startEditing}>
                  <Pencil />
                  Edit
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div
            className="min-w-0 flex-1 overflow-y-auto"
            onClick={() => editing && setSelectedTileId(null)}
          >
            <div
              ref={exportRef}
              className={cn(
                "min-h-full space-y-4 p-5",
                BACKGROUNDS[spec.theme.background].className,
              )}
            >
              {exporting && (
                <div className="flex items-baseline justify-between gap-4 pb-1">
                  <div>
                    <h2 dir="auto" className="text-xl font-semibold tracking-tight">
                      {dashboard.name}
                    </h2>
                    {activeFilters.length > 0 && (
                      <p dir="auto" className="mt-0.5 text-xs text-muted-foreground">
                        {activeFilters
                          .map(
                            (f: FilterSpec) =>
                              `${f.label || f.column}: ${filterSummary(f, filterState[f.id])}`,
                          )
                          .join("  ·  ")}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date().toLocaleString()}
                  </span>
                </div>
              )}
              <div
                onClick={(event) => event.stopPropagation()}
                className={cn(exporting && "no-export")}
              >
                <FilterBar
                  filters={spec.filters}
                  state={filterState}
                  onChange={setFilter}
                  onReset={() => setFilterState(initialFilterState(spec.filters))}
                  crossFilters={crossEnabled ? crossFilters : []}
                  onClearCross={(tileId) =>
                    setCrossFilters((current) =>
                      tileId === null ? [] : current.filter((c) => c.tileId !== tileId),
                    )
                  }
                  editing={editing}
                  onEditFilters={() => setFiltersOpen(true)}
                />
              </div>
              {spec.tiles.length === 0 ? (
                <div className="flex min-h-80 items-center justify-center">
                  <EmptyState
                    icon={LayoutDashboard}
                    title="This dashboard is empty"
                    description="Add charts, KPI scorecards, tables and text, then arrange them on the grid."
                    action={
                      !editing && (
                        <Button onClick={startEditing}>
                          <Pencil /> Start editing
                        </Button>
                      )
                    }
                  />
                </div>
              ) : (
                <DashboardGrid
                  tiles={spec.tiles}
                  editing={editing}
                  onLayoutChange={onLayoutChange}
                  onDuplicate={(tile) => {
                    const copy = duplicateTile(tile, spec.tiles);
                    updateSpec((s) => ({ ...s, tiles: [...s.tiles, copy] }));
                    setSelectedTileId(copy.id);
                  }}
                  onDelete={(tile) => {
                    updateSpec((s) => ({ ...s, tiles: s.tiles.filter((t) => t.id !== tile.id) }));
                    setSelectedTileId((current) => (current === tile.id ? null : current));
                    setCrossFilters((current) => current.filter((c) => c.tileId !== tile.id));
                  }}
                />
              )}
            </div>
          </div>
          {selectedTile && (
            <TileEditor
              key={selectedTile.id}
              tile={selectedTile}
              onChange={updateTile}
              onClose={() => setSelectedTileId(null)}
            />
          )}
        </div>
      </div>

      <FilterEditorDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={spec.filters}
        state={filterState}
        onChange={(filters) => updateSpec((s) => ({ ...s, filters }))}
      />
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The dashboard goes back to how it was when you last saved it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false);
                stopEditing();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardViewContext.Provider>
  );
}

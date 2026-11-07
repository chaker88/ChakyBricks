import {
  AlertTriangle,
  Copy,
  GripVertical,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChartTile } from "@/components/dashboard/chart-tile";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { TableTile } from "@/components/dashboard/table-tile";
import { TextTile } from "@/components/dashboard/text-tile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardKeys, requestFreshTiles, useTileData } from "@/hooks/use-dashboards";
import { conditionsForTile, queryShape, tileProblem } from "@/lib/dashboard";
import { useDashboardView } from "@/lib/dashboard-context";
import type { TileSpec } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

function TileBody({ tile }: { tile: TileSpec }) {
  const view = useDashboardView();
  const problem = tileProblem(tile);
  const query = useTileData({
    tile,
    conditions: conditionsForTile(
      tile.id,
      view.conditions,
      view.crossFilters,
      view.spec.cross_filter,
    ),
    enabled: tile.type !== "text" && !problem,
    refreshSeconds: view.spec.refresh_seconds,
  });

  if (tile.type === "text") return <TextTile text={tile.config.text ?? ""} />;
  if (problem) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
        <SlidersHorizontal className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">{problem}</p>
        {view.editing && view.selectedTileId !== tile.id && (
          <Button size="xs" variant="outline" onClick={() => view.selectTile(tile.id)}>
            Configure
          </Button>
        )}
      </div>
    );
  }
  if (query.isError && !query.data) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 px-2 text-center">
        <AlertTriangle className="size-5 text-destructive" strokeWidth={1.5} />
        <p className="line-clamp-4 text-xs break-words text-muted-foreground">
          {query.error.message}
        </p>
        <Button size="xs" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!query.data) return <Skeleton className="size-full" />;
  const stale = query.isPlaceholderData || (query.isFetching && !query.isRefetching);
  return (
    <div className={cn("size-full min-h-0 transition-opacity duration-200", stale && "opacity-50")}>
      {tile.type === "kpi" ? (
        <KpiTile tile={tile} data={query.data} />
      ) : tile.type === "table" ? (
        <TableTile tile={tile} data={query.data} />
      ) : (
        <ChartTile tile={tile} data={query.data} />
      )}
      {query.data.series_truncated && (
        <div className="pointer-events-none absolute right-3 bottom-1 text-[10px] text-muted-foreground">
          Top series only
        </div>
      )}
    </div>
  );
}

export function Tile({
  tile,
  onDuplicate,
  onDelete,
}: {
  tile: TileSpec;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const view = useDashboardView();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const selected = view.editing && view.selectedTileId === tile.id;
  const plain = tile.type === "text" && !view.editing;
  const showHeader = view.editing || !!tile.title.trim();

  return (
    <div
      onClick={
        view.editing
          ? (event) => {
              event.stopPropagation();
              view.selectTile(tile.id);
            }
          : undefined
      }
      className={cn(
        "group/tile relative flex size-full flex-col overflow-hidden rounded-xl p-3 transition-shadow",
        plain ? "bg-transparent" : "border bg-card",
        view.editing && "cursor-grab hover:border-primary/40 active:cursor-grabbing",
        selected && "border-primary ring-2 ring-primary/30 hover:border-primary",
      )}
    >
      {showHeader && (
        <div
          className={cn(
            "tile-drag -mx-1 mb-1.5 flex min-h-6 shrink-0 items-center gap-1",
            !view.editing && "pointer-events-none",
          )}
        >
          {view.editing && <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />}
          <h3
            dir="auto"
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] font-medium",
              !tile.title.trim() && "font-normal text-muted-foreground",
            )}
          >
            {tile.title.trim() || (tile.type === "text" ? "Text" : "Untitled")}
          </h3>
          {view.editing && (
            <div className="no-drag flex shrink-0 opacity-0 transition-opacity group-hover/tile:opacity-100">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Duplicate tile"
                onClick={(event) => {
                  event.stopPropagation();
                  onDuplicate();
                }}
              >
                <Copy />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Delete tile"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>
      )}
      {!view.editing && tile.type !== "text" && (
        <div className="no-export absolute top-2 right-2 z-10 flex rounded-md bg-card/90 opacity-0 transition-opacity group-hover/tile:opacity-100">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh tile"
            onClick={() => {
              requestFreshTiles();
              void queryClient.invalidateQueries({
                queryKey: [...dashboardKeys.tile, queryShape(tile)],
              });
            }}
          >
            <RefreshCw />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Expand tile"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 />
          </Button>
        </div>
      )}
      <div className={cn("relative min-h-0 flex-1", view.editing && "pointer-events-none")}>
        <TileBody tile={tile} />
      </div>
      {expanded && (
        <Dialog open onOpenChange={setExpanded}>
          <DialogContent className="flex h-[80vh] max-w-6xl flex-col sm:max-w-6xl">
            <DialogHeader>
              <DialogTitle dir="auto">{tile.title || "Tile"}</DialogTitle>
            </DialogHeader>
            <div className="relative min-h-0 flex-1">
              <TileBody tile={tile} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

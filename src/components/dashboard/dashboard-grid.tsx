import ReactGridLayout, { useContainerWidth, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Tile } from "@/components/dashboard/tile";
import { GRID_COLUMNS, GRID_MARGIN, MIN_SIZE, ROW_HEIGHT } from "@/lib/dashboard";
import type { TileSpec } from "@/lib/dashboard-types";
import { cn } from "@/lib/utils";

export function DashboardGrid({
  tiles,
  editing,
  onLayoutChange,
  onDuplicate,
  onDelete,
}: {
  tiles: TileSpec[];
  editing: boolean;
  onLayoutChange: (
    items: readonly { i: string; x: number; y: number; w: number; h: number }[],
  ) => void;
  onDuplicate: (tile: TileSpec) => void;
  onDelete: (tile: TileSpec) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const layout = tiles.map((tile) => ({
    i: tile.id,
    ...tile.layout,
    minW: MIN_SIZE[tile.type].w,
    minH: MIN_SIZE[tile.type].h,
  }));

  return (
    <div ref={containerRef} className={cn("dashboard-grid", editing && "dashboard-grid-editing")}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: GRID_COLUMNS,
            rowHeight: ROW_HEIGHT,
            margin: [GRID_MARGIN, GRID_MARGIN],
            containerPadding: [0, 0],
          }}
          dragConfig={{ enabled: editing, handle: ".tile-drag", cancel: ".no-drag" }}
          resizeConfig={{ enabled: editing, handles: ["se", "e", "s"] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => editing && onLayoutChange(next)}
        >
          {tiles.map((tile) => (
            <div key={tile.id} data-tile-id={tile.id}>
              <Tile
                tile={tile}
                onDuplicate={() => onDuplicate(tile)}
                onDelete={() => onDelete(tile)}
              />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}

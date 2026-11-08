import { createContext, useContext } from "react";
import type { Condition, CrossFilter, DashboardSpec } from "@/lib/dashboard-types";

export const PALETTE_SIZE = 8;

/** FNV-1a over UTF-16 code units: a stable, platform-independent slot for a value. */
export function hashSlot(name: string, size = PALETTE_SIZE): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % size;
}

/**
 * The same value gets the same colour in every tile: its slot comes from a hash of the value.
 * Within one tile, values that hash to the same slot are separated (in sorted order, so the result
 * does not depend on query completion order) and remembered while the page is open, so filtering
 * never repaints the survivors.
 */
export class ColorAssigner {
  private readonly scopes = new Map<string, Map<string, number>>();

  assign(scope: string, names: readonly string[]): ReadonlyMap<string, number> {
    let slots = this.scopes.get(scope);
    if (!slots) {
      slots = new Map();
      this.scopes.set(scope, slots);
    }
    const fresh = [...new Set(names)].filter((n) => !slots.has(n)).sort();
    for (const name of fresh) {
      const taken = new Set(slots.values());
      let slot = hashSlot(name);
      if (taken.size < PALETTE_SIZE) {
        while (taken.has(slot)) slot = (slot + 1) % PALETTE_SIZE;
      }
      slots.set(name, slot);
    }
    return slots;
  }
}

export interface DashboardView {
  spec: DashboardSpec;
  editing: boolean;
  conditions: Condition[];
  crossFilters: CrossFilter[];
  selectedTileId: string | null;
  /** Colour lookup for the series names of one tile, honouring its overrides. */
  colorsFor: (
    tileId: string,
    names: readonly string[],
    overrides: Record<string, number> | undefined,
  ) => (name: string) => string;
  palette: string[];
  /** Series names last drawn by each chart tile, for the colour overrides in the editor. */
  seriesNames: Record<string, string[]>;
  reportSeries: (tileId: string, names: string[]) => void;
  ramp: string[];
  setCrossFilter: (tileId: string, filter: CrossFilter | null) => void;
  selectTile: (id: string | null) => void;
}

export const DashboardViewContext = createContext<DashboardView | null>(null);

export function useDashboardView(): DashboardView {
  const view = useContext(DashboardViewContext);
  if (!view) throw new Error("useDashboardView must be used inside a dashboard");
  return view;
}

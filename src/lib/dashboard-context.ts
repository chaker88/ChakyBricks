import { createContext, useContext } from "react";
import type { Condition, CrossFilter, DashboardSpec } from "@/lib/dashboard-types";

/**
 * Gives each series name a stable palette slot within its tile, so filtering never repaints the
 * survivors and colours do not depend on which tile's query finishes first.
 */
export class ColorAssigner {
  private readonly scopes = new Map<string, Map<string, number>>();

  slot(scope: string, name: string): number {
    let slots = this.scopes.get(scope);
    if (!slots) {
      slots = new Map();
      this.scopes.set(scope, slots);
    }
    let slot = slots.get(name);
    if (slot === undefined) {
      slot = slots.size;
      slots.set(name, slot);
    }
    return slot;
  }
}

export interface DashboardView {
  spec: DashboardSpec;
  editing: boolean;
  conditions: Condition[];
  crossFilters: CrossFilter[];
  selectedTileId: string | null;
  colorFor: (scope: string, name: string) => string;
  palette: string[];
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

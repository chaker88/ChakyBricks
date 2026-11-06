import { createContext, useContext } from "react";
import type { BackendClient, HealthResponse } from "@/lib/backend";

export type BackendState =
  | { status: "connecting" }
  | { status: "ready"; client: BackendClient; health: HealthResponse }
  | { status: "error"; error: string };

export const BackendContext = createContext<BackendState>({ status: "connecting" });

export function useBackend(): BackendState {
  return useContext(BackendContext);
}

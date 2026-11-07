import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/hooks/use-api";
import type { ColumnInfo } from "@/lib/api-types";
import type { BackendClient } from "@/lib/backend";
import { queryShape } from "@/lib/dashboard";
import type {
  Condition,
  Dashboard,
  DashboardSpec,
  DashboardSummary,
  FilterOptions,
  Source,
  TileData,
  TileSpec,
} from "@/lib/dashboard-types";

export const dashboardKeys = {
  list: ["dashboards"] as const,
  one: (id: number) => ["dashboard", id] as const,
  tile: ["tile"] as const,
};

function requireClient(client: BackendClient | null): BackendClient {
  if (!client) throw new Error("Engine is not running");
  return client;
}

export function useDashboards() {
  const client = useClient();
  return useQuery({
    queryKey: dashboardKeys.list,
    queryFn: () => requireClient(client).get<DashboardSummary[]>("/api/dashboards"),
    enabled: !!client,
  });
}

export function useDashboard(id: number) {
  const client = useClient();
  return useQuery({
    queryKey: dashboardKeys.one(id),
    queryFn: () => requireClient(client).get<Dashboard>(`/api/dashboards/${id}`),
    enabled: !!client && Number.isFinite(id),
    staleTime: Infinity,
    retry: false,
  });
}

export function useCreateDashboard() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; spec?: DashboardSpec }) =>
      requireClient(client).post<Dashboard>("/api/dashboards", args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.list }),
  });
}

export function useCreateSampleDashboard() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requireClient(client).post<Dashboard>("/api/dashboards/sample"),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useUpdateDashboard() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: number;
      name?: string;
      description?: string;
      spec?: DashboardSpec;
    }) => {
      const { id, ...changes } = args;
      return requireClient(client).put<Dashboard>(`/api/dashboards/${id}`, changes);
    },
    onSuccess: (dashboard) => {
      queryClient.setQueryData(dashboardKeys.one(dashboard.id), dashboard);
      return queryClient.invalidateQueries({ queryKey: dashboardKeys.list });
    },
  });
}

export function useDuplicateDashboard() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      requireClient(client).post<Dashboard>(`/api/dashboards/${id}/duplicate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.list }),
  });
}

export function useDeleteDashboard() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => requireClient(client).delete(`/api/dashboards/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: dashboardKeys.one(id) });
      return queryClient.invalidateQueries({ queryKey: dashboardKeys.list });
    },
  });
}

export function sourceKey(source: Source | null | undefined): string {
  if (!source) return "";
  return source.kind === "table" ? `t:${source.table}` : `q:${source.query_id}`;
}

export function useSourceColumns(source: Source | null | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: ["dashboard-columns", sourceKey(source)],
    queryFn: () => requireClient(client).post<ColumnInfo[]>("/api/dashboards/columns", { source }),
    enabled: !!client && !!source && sourceKey(source) !== "t:" && sourceKey(source) !== "q:null",
    staleTime: 60_000,
    retry: false,
  });
}

export function useFilterOptions(source: Source, column: string, search: string, enabled: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: ["dashboard-options", sourceKey(source), column, search],
    queryFn: () =>
      requireClient(client).post<FilterOptions>("/api/dashboards/options", {
        source,
        column,
        search,
      }),
    enabled: !!client && enabled && !!column,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

let forceUntil = 0;

/** The next tile fetches skip the server's result cache (the Refresh button). */
export function requestFreshTiles(): void {
  forceUntil = Date.now() + 3000;
}

export interface TileQueryOptions {
  tile: TileSpec;
  conditions: Condition[];
  enabled: boolean;
  refreshSeconds?: number | null;
}

export function useTileData({ tile, conditions, enabled, refreshSeconds }: TileQueryOptions) {
  const client = useClient();
  const shape = queryShape(tile);
  return useQuery({
    queryKey: [...dashboardKeys.tile, shape, conditions],
    queryFn: async ({ signal }) => {
      const api = requireClient(client);
      const queryId = crypto.randomUUID().replaceAll("-", "");
      const cancel = () => {
        void api.post(`/api/sql/cancel/${queryId}`).catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await api.request<TileData>("/api/dashboards/query", {
          method: "POST",
          body: JSON.stringify({
            ...shape,
            conditions,
            query_id: queryId,
            force: Date.now() < forceUntil,
          }),
          signal,
        });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    enabled: !!client && enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: false,
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
}

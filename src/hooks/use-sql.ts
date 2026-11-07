import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { queryKeys, useClient } from "@/hooks/use-api";
import type {
  ColumnStats,
  ExportResult,
  ImportJob,
  QueryHistoryEntry,
  QueryResult,
  SavedQuery,
} from "@/lib/api-types";
import { ApiError, type BackendClient } from "@/lib/backend";

export const sqlKeys = {
  saved: ["saved-queries"] as const,
  history: ["sql-history"] as const,
};

function requireClient(client: BackendClient | null): BackendClient {
  if (!client) throw new Error("Engine is not running");
  return client;
}

export const CANCELLED_STATUS = 499;

export interface RunState {
  status: "running" | "done" | "error" | "cancelled";
  queryId: string;
  sql: string;
  startedAt: number;
  result?: QueryResult;
  error?: string;
}

export function useQueryRunner() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  const run = useCallback(
    async (tabId: string, sql: string) => {
      if (!client || !sql.trim()) return;
      const queryId = crypto.randomUUID();
      const startedAt = Date.now();
      setRuns((current) => ({
        ...current,
        [tabId]: { status: "running", queryId, sql, startedAt, result: current[tabId]?.result },
      }));
      const settle = (state: Omit<RunState, "queryId" | "sql" | "startedAt">) =>
        setRuns((current) =>
          current[tabId]?.queryId === queryId
            ? { ...current, [tabId]: { queryId, sql, startedAt, ...state } }
            : current,
        );
      try {
        const result = await client.post<QueryResult>("/api/sql/run", { sql, query_id: queryId });
        settle({ status: "done", result });
        if (result.writes.length > 0) {
          queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
          queryClient.invalidateQueries({ queryKey: ["table"] });
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === CANCELLED_STATUS)
          settle({ status: "cancelled" });
        else
          settle({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
      } finally {
        queryClient.invalidateQueries({ queryKey: sqlKeys.history });
      }
    },
    [client, queryClient],
  );

  const cancel = useCallback(
    (tabId: string) => {
      const state = runs[tabId];
      if (client && state?.status === "running") {
        client.post(`/api/sql/cancel/${state.queryId}`).catch(() => {});
      }
    },
    [client, runs],
  );

  const forget = useCallback((tabId: string) => {
    setRuns((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  }, []);

  return { runs, run, cancel, forget };
}

export function useColumnStats(sql: string, column: string) {
  const client = useClient();
  return useQuery({
    queryKey: ["column-stats", sql, column],
    queryFn: () => requireClient(client).post<ColumnStats>("/api/sql/stats", { sql, column }),
    enabled: !!client,
    staleTime: 60_000,
    retry: false,
  });
}

export function useExportResult() {
  const client = useClient();
  return useMutation({
    mutationFn: (args: { sql: string; path: string; format: "csv" | "parquet" }) =>
      requireClient(client).post<ExportResult>("/api/sql/export", args),
  });
}

export function useSaveAsTable() {
  const client = useClient();
  return useMutation({
    mutationFn: (args: { sql: string; schema_name: string; table: string; mode: string }) =>
      requireClient(client).post<ImportJob>("/api/sql/save-table", args),
  });
}

export function useSavedQueries() {
  const client = useClient();
  return useQuery({
    queryKey: sqlKeys.saved,
    queryFn: () => requireClient(client).get<SavedQuery[]>("/api/saved-queries"),
    enabled: !!client,
  });
}

export function useCreateSavedQuery() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; sql: string; description?: string }) =>
      requireClient(client).post<SavedQuery>("/api/saved-queries", args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sqlKeys.saved }),
  });
}

export function useUpdateSavedQuery() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...changes }: { id: number; name?: string; sql?: string }) =>
      requireClient(client).put<SavedQuery>(`/api/saved-queries/${id}`, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sqlKeys.saved }),
  });
}

export function useDeleteSavedQuery() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => requireClient(client).delete(`/api/saved-queries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sqlKeys.saved }),
  });
}

export function useQueryHistory() {
  const client = useClient();
  return useQuery({
    queryKey: sqlKeys.history,
    queryFn: () => requireClient(client).get<QueryHistoryEntry[]>("/api/sql/history?limit=200"),
    enabled: !!client,
  });
}

export function useClearHistory() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requireClient(client).delete("/api/sql/history"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sqlKeys.history }),
  });
}

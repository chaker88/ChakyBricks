import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppSettings,
  CatalogResponse,
  ColumnSpec,
  HistoryEntry,
  ImportJob,
  ImportRequest,
  PreviewResponse,
  RowSet,
  SourceOptions,
  TableDetail,
  TableSummary,
} from "@/lib/api-types";
import type { BackendClient } from "@/lib/backend";
import { useBackend } from "@/lib/backend-context";
import { isTerminal } from "@/lib/import";

export interface PreviewRequest {
  path: string;
  options?: SourceOptions;
  columns?: ColumnSpec[];
}

export const queryKeys = {
  catalog: ["catalog"] as const,
  table: (schema: string, name: string) => ["table", schema, name] as const,
  settings: ["settings"] as const,
};

export function useClient(): BackendClient | null {
  const backend = useBackend();
  return backend.status === "ready" ? backend.client : null;
}

function requireClient(client: BackendClient | null): BackendClient {
  if (!client) throw new Error("Engine is not running");
  return client;
}

function tablePath(schema: string, name: string): string {
  return `/api/tables/${encodeURIComponent(schema)}/${encodeURIComponent(name)}`;
}

export function useCatalog() {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: () => requireClient(client).get<CatalogResponse>("/api/catalog"),
    enabled: !!client,
  });
}

export function useTable(schema: string, name: string) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.table(schema, name),
    queryFn: () => requireClient(client).get<TableDetail>(tablePath(schema, name)),
    enabled: !!client,
    retry: false,
  });
}

export function useTableSample(
  schema: string,
  name: string,
  version: number | null,
  enabled = true,
) {
  const client = useClient();
  const query = version === null ? "" : `&version=${version}`;
  return useQuery({
    queryKey: [...queryKeys.table(schema, name), "sample", version],
    queryFn: () =>
      requireClient(client).get<RowSet>(`${tablePath(schema, name)}/sample?limit=100${query}`),
    enabled: !!client && enabled,
  });
}

export function useTableHistory(schema: string, name: string, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: [...queryKeys.table(schema, name), "history"],
    queryFn: () => requireClient(client).get<HistoryEntry[]>(`${tablePath(schema, name)}/history`),
    enabled: !!client && enabled,
  });
}

export function useRenameTable() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { schema: string; name: string; newSchema: string; newName: string }) =>
      requireClient(client).post<TableSummary>(`${tablePath(args.schema, args.name)}/rename`, {
        schema_name: args.newSchema,
        name: args.newName,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.catalog }),
  });
}

export function useDropTable() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { schema: string; name: string }) =>
      requireClient(client).delete(tablePath(args.schema, args.name)),
    onSuccess: (_, args) => {
      queryClient.removeQueries({ queryKey: queryKeys.table(args.schema, args.name) });
      return queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
    },
  });
}

export function useCreateSchema() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      requireClient(client).post<{ name: string }>("/api/schemas", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.catalog }),
  });
}

export function useDropSchema() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      requireClient(client).delete(`/api/schemas/${encodeURIComponent(name)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.catalog }),
  });
}

export function usePreview(request: PreviewRequest | null, initial?: PreviewResponse) {
  const client = useClient();
  return useQuery({
    queryKey: ["import-preview", request],
    queryFn: () => requireClient(client).post<PreviewResponse>("/api/imports/preview", request),
    enabled: !!client && !!request,
    placeholderData: keepPreviousData,
    initialData: initial,
    initialDataUpdatedAt: 0,
    retry: false,
  });
}

export function useStartImport() {
  const client = useClient();
  return useMutation({
    mutationFn: (request: ImportRequest) =>
      requireClient(client).post<ImportJob>("/api/imports", request),
  });
}

export function useCancelImport() {
  const client = useClient();
  return useMutation({
    mutationFn: (id: string) => requireClient(client).post<ImportJob>(`/api/imports/${id}/cancel`),
  });
}

export function useImportJob(id: string | null) {
  const client = useClient();
  return useQuery({
    queryKey: ["import", id],
    queryFn: () => requireClient(client).get<ImportJob>(`/api/imports/${id}`),
    enabled: !!client && !!id,
    refetchInterval: (query) =>
      query.state.data && isTerminal(query.state.data.state) ? false : 400,
  });
}

export function useSettings() {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => requireClient(client).get<AppSettings>("/api/settings"),
    enabled: !!client,
  });
}

export function useUpdateSettings() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: {
      workspace?: string;
      memory_limit_mb?: number | null;
      row_limit?: number;
      kernel_memory_percent?: number;
      dashboard_concurrency?: number;
      keep_running_in_background?: boolean;
      start_with_system?: boolean;
    }) => requireClient(client).put<AppSettings>("/api/settings", changes),
    onSuccess: (settings, changes) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      if (changes.workspace) return queryClient.invalidateQueries();
    },
  });
}

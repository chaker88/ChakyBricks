import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/hooks/use-api";
import type { BackendClient } from "@/lib/backend";
import type { CellSpec, Ipynb } from "@/lib/notebook";

export interface NotebookEntry {
  name: string;
  updated_at: string;
  size_bytes: number;
}

export const notebookKeys = {
  list: ["notebooks"] as const,
  one: (name: string) => ["notebook", name] as const,
};

function requireClient(client: BackendClient | null): BackendClient {
  if (!client) throw new Error("Engine is not running");
  return client;
}

export function notebookPath(name: string): string {
  return `/api/notebooks/${encodeURIComponent(name)}`;
}

export function useNotebooks() {
  const client = useClient();
  return useQuery({
    queryKey: notebookKeys.list,
    queryFn: () => requireClient(client).get<NotebookEntry[]>("/api/notebooks"),
    enabled: !!client,
  });
}

export function useNotebook(name: string) {
  const client = useClient();
  return useQuery({
    queryKey: notebookKeys.one(name),
    queryFn: () => requireClient(client).get<Ipynb>(notebookPath(name)),
    enabled: !!client,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

export function useCreateNotebook() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { name?: string; cells?: CellSpec[] }) =>
      requireClient(client).post<{ name: string }>("/api/notebooks", args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notebookKeys.list }),
  });
}

export function useSaveNotebook(name: string) {
  const client = useClient();
  return useMutation({
    mutationFn: (content: Ipynb) =>
      requireClient(client).put<NotebookEntry>(notebookPath(name), content),
  });
}

export function useRenameNotebook() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) =>
      requireClient(client).post<{ name: string }>(`${notebookPath(name)}/rename`, {
        name: newName,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notebookKeys.list }),
  });
}

export function useDeleteNotebook() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => requireClient(client).delete(notebookPath(name)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notebookKeys.list }),
  });
}

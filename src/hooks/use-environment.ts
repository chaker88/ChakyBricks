import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/hooks/use-api";
import type { KernelSummary, PackageJob, PackageListing } from "@/lib/api-types";
import type { BackendClient } from "@/lib/backend";

export const environmentKeys = {
  kernels: ["kernels"] as const,
  packages: ["packages"] as const,
  job: (id: string) => ["package-job", id] as const,
};

function requireClient(client: BackendClient | null): BackendClient {
  if (!client) throw new Error("Engine is not running");
  return client;
}

export function useKernels() {
  const client = useClient();
  return useQuery({
    queryKey: environmentKeys.kernels,
    queryFn: () => requireClient(client).get<KernelSummary[]>("/api/kernels"),
    enabled: !!client,
    refetchInterval: 3000,
  });
}

export function useShutdownKernel() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requireClient(client).delete(`/api/kernels/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: environmentKeys.kernels }),
  });
}

export function usePackages() {
  const client = useClient();
  return useQuery({
    queryKey: environmentKeys.packages,
    queryFn: () => requireClient(client).get<PackageListing>("/api/packages"),
    enabled: !!client,
  });
}

export function usePackageJob(id: string | null) {
  const client = useClient();
  return useQuery({
    queryKey: environmentKeys.job(id ?? ""),
    queryFn: () => requireClient(client).get<PackageJob>(`/api/packages/jobs/${id}`),
    enabled: !!client && !!id,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "succeeded" || state === "failed" ? false : 700;
    },
  });
}

export function usePackageAction() {
  const client = useClient();
  return useMutation({
    mutationFn: (
      action:
        | { kind: "install"; packages: string }
        | { kind: "uninstall"; name: string }
        | { kind: "reset" },
    ) => {
      const api = requireClient(client);
      if (action.kind === "install") {
        return api.post<PackageJob>("/api/packages/install", { packages: action.packages });
      }
      if (action.kind === "uninstall") {
        return api.post<PackageJob>(`/api/packages/${encodeURIComponent(action.name)}/uninstall`);
      }
      return api.post<PackageJob>("/api/packages/reset");
    },
  });
}

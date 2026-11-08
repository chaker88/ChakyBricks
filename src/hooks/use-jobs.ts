import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/hooks/use-api";
import { useSavedQueries } from "@/hooks/use-sql";
import type { BackendClient } from "@/lib/backend";
import type { Job, JobInput, JobRun, SchedulePreview, ScheduleSpec } from "@/lib/jobs";

export const jobKeys = {
  list: ["jobs"] as const,
  one: (id: number) => ["job", id] as const,
  runs: (id: number) => ["job-runs", id] as const,
  run: (id: number) => ["job-run", id] as const,
};

function requireClient(client: BackendClient | null): BackendClient {
  if (!client) throw new Error("Engine is not running");
  return client;
}

export function useJobs() {
  const client = useClient();
  return useQuery({
    queryKey: jobKeys.list,
    queryFn: () => requireClient(client).get<Job[]>("/api/jobs"),
    enabled: !!client,
    refetchInterval: (query) => (query.state.data?.some((job) => job.running) ? 1500 : 15_000),
  });
}

export function useJob(id: number) {
  const client = useClient();
  return useQuery({
    queryKey: jobKeys.one(id),
    queryFn: () => requireClient(client).get<Job>(`/api/jobs/${id}`),
    enabled: !!client && Number.isFinite(id),
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : 15_000),
  });
}

export function useJobRuns(id: number, active: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: jobKeys.runs(id),
    queryFn: () => requireClient(client).get<JobRun[]>(`/api/jobs/${id}/runs?limit=100`),
    enabled: !!client && Number.isFinite(id),
    refetchInterval: active ? 1500 : 15_000,
  });
}

export function useJobRun(id: number | null) {
  const client = useClient();
  return useQuery({
    queryKey: jobKeys.run(id ?? -1),
    queryFn: () => requireClient(client).get<JobRun>(`/api/job-runs/${id}`),
    enabled: !!client && id !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });
}

function useInvalidateJobs() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ predicate: (q) => /^job/.test(String(q.queryKey[0])) });
}

export function useCreateJob() {
  const client = useClient();
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (input: JobInput) => requireClient(client).post<Job>("/api/jobs", input),
    onSuccess: invalidate,
  });
}

export function useUpdateJob() {
  const client = useClient();
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: ({ id, ...changes }: { id: number } & Partial<JobInput>) =>
      requireClient(client).put<Job>(`/api/jobs/${id}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteJob() {
  const client = useClient();
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (id: number) => requireClient(client).delete(`/api/jobs/${id}`),
    onSuccess: invalidate,
  });
}

export function useRunJob() {
  const client = useClient();
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (id: number) => requireClient(client).post<JobRun>(`/api/jobs/${id}/run`),
    onSuccess: invalidate,
  });
}

export function useCancelRun() {
  const client = useClient();
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (runId: number) =>
      requireClient(client).post<JobRun>(`/api/job-runs/${runId}/cancel`),
    onSuccess: invalidate,
  });
}

export function useSchedulePreview(schedule: ScheduleSpec, enabled: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: ["job-schedule-preview", schedule],
    queryFn: () =>
      requireClient(client).post<SchedulePreview>("/api/jobs/schedule-preview", { schedule }),
    enabled: !!client && enabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
}

/** Display name of what a job runs: the notebook name or the saved query's name. */
export function useTargetLabel() {
  const queries = useSavedQueries();
  return (job: Pick<Job, "kind" | "target">) =>
    job.kind === "notebook"
      ? job.target
      : (queries.data?.find((q) => String(q.id) === job.target)?.name ?? "Deleted query");
}

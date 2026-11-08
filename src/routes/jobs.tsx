import {
  CalendarClock,
  Code2,
  Info,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { JobDialog } from "@/components/jobs/job-dialog";
import { StatusBadge } from "@/components/jobs/status-badge";
import { EmptyState, ErrorState, Page } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/hooks/use-api";
import {
  useDeleteJob,
  useJobs,
  useJobsPaused,
  useRunJob,
  useSetJobsPaused,
  useTargetLabel,
  useUpdateJob,
} from "@/hooks/use-jobs";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { Job } from "@/lib/jobs";

function PausedBanner() {
  const paused = useJobsPaused();
  const setPaused = useSetJobsPaused();
  if (!paused.data?.paused) return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
      <Pause className="size-4 shrink-0" />
      <span className="flex-1">
        All scheduled jobs are paused. Nothing runs on its own until you resume (Run now still
        works).
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={setPaused.isPending}
        onClick={() => setPaused.mutate(false, { onError: (e) => toast.error(e.message) })}
      >
        Resume all
      </Button>
    </div>
  );
}

function JobsNotice() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>
        Jobs run only while ChakyBricks is open. Runs that were due while the app was closed are
        skipped, not made up later.
      </span>
    </div>
  );
}

export function JobsPage() {
  const jobs = useJobs();
  const client = useClient();
  const label = useTargetLabel();
  const run = useRunJob();
  const update = useUpdateJob();
  const remove = useDeleteJob();
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [deleting, setDeleting] = useState<Job | null>(null);

  return (
    <Page
      title="Jobs"
      description="Run notebooks and saved queries on a schedule."
      actions={
        <Button onClick={() => setEditing("new")} disabled={!client}>
          <Plus />
          New job
        </Button>
      }
    >
      <PausedBanner />
      <JobsNotice />
      {jobs.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : jobs.isError ? (
        <ErrorState
          title="Couldn't load jobs"
          error={jobs.error}
          onRetry={() => void jobs.refetch()}
        />
      ) : !jobs.data?.length ? (
        <EmptyState
          icon={CalendarClock}
          title="No jobs yet"
          description="Schedule a notebook or a saved query to refresh your tables automatically while ChakyBricks is open."
          action={<Button onClick={() => setEditing("new")}>New job</Button>}
        />
      ) : (
        <div className="divide-y rounded-xl border">
          {jobs.data.map((job) => (
            <div key={job.id} className="flex items-center gap-4 px-4 py-3">
              {job.kind === "notebook" ? (
                <NotebookPen className="size-4 shrink-0 text-primary" />
              ) : (
                <Code2 className="size-4 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  to={`/jobs/${job.id}`}
                  dir="auto"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {job.name}
                </Link>
                <div dir="auto" className="truncate text-xs text-muted-foreground">
                  {label(job)} · {job.schedule_text}
                </div>
              </div>
              <div className="hidden w-44 text-xs text-muted-foreground tabular-nums md:block">
                {job.enabled
                  ? job.next_run_at
                    ? `Next: ${formatDateTime(job.next_run_at)}`
                    : "Manual only"
                  : "Paused"}
              </div>
              <div className="hidden w-40 sm:block">
                {job.last_run ? (
                  <div className="space-y-0.5">
                    <StatusBadge status={job.last_run.status} />
                    <div className="text-[11px] text-muted-foreground">
                      {formatDateTime(job.last_run.started_at)}
                      {job.last_run.duration_ms !== null &&
                        job.last_run.status !== "running" &&
                        ` · ${formatDuration(job.last_run.duration_ms / 1000)}`}
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Never run</span>
                )}
              </div>
              <Switch
                checked={job.enabled}
                aria-label={job.enabled ? "Pause job" : "Enable job"}
                onCheckedChange={(enabled) =>
                  update.mutate(
                    { id: job.id, enabled },
                    { onError: (error) => toast.error(error.message) },
                  )
                }
              />
              <Button
                variant="outline"
                size="sm"
                disabled={job.running || run.isPending}
                onClick={() =>
                  run.mutate(job.id, {
                    onSuccess: () => toast.success(`Started “${job.name}”`),
                    onError: (error) => toast.error(error.message),
                  })
                }
              >
                <Play />
                Run now
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(job)}>
                    <Pencil />
                    Edit…
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(job)}>
                    <Trash2 />
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <JobDialog
          job={editing === "new" ? undefined : editing}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The job and its run history are deleted. The notebook or query it runs is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, { onError: (error) => toast.error(error.message) })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

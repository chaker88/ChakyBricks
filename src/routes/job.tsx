import { ArrowLeft, CalendarClock, Pencil, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { JobDialog } from "@/components/jobs/job-dialog";
import { StatusBadge } from "@/components/jobs/status-badge";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useCancelRun,
  useJob,
  useJobRun,
  useJobRuns,
  useRunJob,
  useTargetLabel,
  useUpdateJob,
} from "@/hooks/use-jobs";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { JobRun } from "@/lib/jobs";
import { cn } from "@/lib/utils";

function LogViewer({ runId }: { runId: number }) {
  const run = useJobRun(runId);
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const log = run.data?.log ?? "";
  const running = run.data?.status === "running";

  useEffect(() => {
    const element = ref.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [log]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {run.data && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={run.data.status} />
          <span className="text-muted-foreground">
            {formatDateTime(run.data.started_at)} ·{" "}
            {run.data.trigger === "manual" ? "started manually" : "scheduled"}
          </span>
          {run.data.message && (
            <span dir="auto" className="min-w-0 truncate text-muted-foreground">
              — {run.data.message}
            </span>
          )}
        </div>
      )}
      <pre
        ref={ref}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        dir="auto"
        className="min-h-64 flex-1 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap select-text"
      >
        {log || (running ? "Starting…" : "This run wrote no log.")}
      </pre>
    </div>
  );
}

export default function JobPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const job = useJob(jobId);
  const runs = useJobRuns(jobId, !!job.data?.running);
  const label = useTargetLabel();
  const run = useRunJob();
  const cancel = useCancelRun();
  const update = useUpdateJob();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  if (job.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={CalendarClock}
          title="Job not found"
          description={job.error.message}
          action={
            <Button asChild variant="outline">
              <Link to="/jobs">Back to jobs</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (!job.data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const data = job.data;
  const history: JobRun[] = runs.data ?? [];
  const selected = picked ?? history[0]?.id ?? null;
  const activeRun = history.find((r) => r.status === "running");

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to jobs">
          <Link to="/jobs">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="truncate text-xl font-semibold tracking-tight">
            {data.name}
          </h1>
          <p dir="auto" className="truncate text-sm text-muted-foreground">
            {data.kind === "notebook" ? "Notebook" : "Saved query"}: {label(data)} ·{" "}
            {data.schedule_text}
            {data.enabled && data.next_run_at && ` · next ${formatDateTime(data.next_run_at)}`}
            {!data.enabled && " · paused"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={data.enabled}
            onCheckedChange={(enabled) =>
              update.mutate(
                { id: data.id, enabled },
                { onError: (error) => toast.error(error.message) },
              )
            }
          />
          {data.enabled ? "Enabled" : "Paused"}
        </label>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
        {activeRun ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              cancel.mutate(activeRun.id, { onError: (error) => toast.error(error.message) })
            }
          >
            <Square />
            Cancel run
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={run.isPending}
            onClick={() =>
              run.mutate(data.id, {
                onSuccess: (started) => setPicked(started.id),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            <Play />
            Run now
          </Button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="min-h-0 overflow-y-auto rounded-xl border">
          {history.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(item.id)}
                    className={cn(
                      "flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-accent/50",
                      selected === item.id && "bg-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <StatusBadge status={item.status} />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {item.duration_ms !== null && item.status !== "running"
                          ? formatDuration(item.duration_ms / 1000)
                          : ""}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(item.started_at)} ·{" "}
                      {item.trigger === "manual" ? "manual" : "scheduled"}
                    </span>
                    {item.message && (
                      <span dir="auto" className="line-clamp-2 text-xs">
                        {item.message}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected !== null ? (
          <LogViewer key={selected} runId={selected} />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
            Run the job to see its log here.
          </div>
        )}
      </div>

      {editing && <JobDialog job={data} onOpenChange={(open) => !open && setEditing(false)} />}
    </div>
  );
}

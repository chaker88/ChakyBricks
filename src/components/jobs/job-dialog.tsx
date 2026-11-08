import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateJob, useSchedulePreview, useUpdateJob } from "@/hooks/use-jobs";
import { useNotebooks } from "@/hooks/use-notebooks";
import { useSavedQueries } from "@/hooks/use-sql";
import { formatDateTime } from "@/lib/format";
import {
  SCHEDULE_TYPES,
  WEEKDAYS,
  defaultSchedule,
  joinInterval,
  scheduleIsComplete,
  splitInterval,
  type Job,
  type JobKind,
  type ScheduleSpec,
  type ScheduleType,
} from "@/lib/jobs";
import { cn } from "@/lib/utils";

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: ScheduleSpec;
  onChange: (schedule: ScheduleSpec) => void;
}) {
  const interval = splitInterval(schedule.minutes ?? 60);
  return (
    <div className="space-y-2.5">
      <Select
        value={schedule.type}
        onValueChange={(type) => onChange(defaultSchedule(type as ScheduleType))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCHEDULE_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {schedule.type === "interval" && (
        <div className="flex items-center gap-2 text-sm">
          Every
          <Input
            type="number"
            min={1}
            className="w-24"
            value={interval.count}
            onChange={(e) =>
              onChange({
                ...schedule,
                minutes: joinInterval(Number(e.target.value) || 0, interval.unit),
              })
            }
          />
          <Select
            value={interval.unit}
            onValueChange={(unit) =>
              onChange({
                ...schedule,
                minutes: joinInterval(interval.count, unit as "minutes" | "hours"),
              })
            }
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">minutes</SelectItem>
              <SelectItem value="hours">hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {schedule.type === "weekly" && (
        <div className="flex gap-1">
          {WEEKDAYS.map((label, index) => {
            const selected = schedule.days?.includes(index) ?? false;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    ...schedule,
                    days: selected
                      ? (schedule.days ?? []).filter((d) => d !== index)
                      : [...(schedule.days ?? []), index].sort(),
                  })
                }
                className={cn(
                  "flex-1 rounded-md border px-1 py-1.5 text-xs font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {schedule.type === "monthly" && (
        <div className="flex items-center gap-2 text-sm">
          On day
          <Input
            type="number"
            min={1}
            max={31}
            className="w-20"
            value={schedule.day ?? 1}
            onChange={(e) =>
              onChange({ ...schedule, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
            }
          />
          of the month
        </div>
      )}

      {(schedule.type === "daily" || schedule.type === "weekly" || schedule.type === "monthly") && (
        <div className="flex items-center gap-2 text-sm">
          At
          <Input
            type="time"
            className="w-32"
            value={schedule.time ?? ""}
            onChange={(e) => onChange({ ...schedule, time: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">your local time</span>
        </div>
      )}

      {schedule.type === "cron" && (
        <div className="space-y-1">
          <Input
            className="font-mono"
            value={schedule.expression ?? ""}
            onChange={(e) => onChange({ ...schedule, expression: e.target.value })}
            placeholder="minute hour day month weekday"
          />
          <p className="text-xs text-muted-foreground">
            Five fields, for example <code>0 6 * * mon-fri</code> runs at 06:00 on weekdays.
          </p>
        </div>
      )}
    </div>
  );
}

function SchedulePreviewList({ schedule }: { schedule: ScheduleSpec }) {
  const complete = scheduleIsComplete(schedule) && schedule.type !== "manual";
  const preview = useSchedulePreview(schedule, complete);
  if (schedule.type === "manual") {
    return <p className="text-xs text-muted-foreground">Runs only when you press Run now.</p>;
  }
  if (preview.isError) {
    return <p className="text-xs text-destructive">{preview.error.message}</p>;
  }
  if (!preview.data) return <p className="text-xs text-muted-foreground">Checking the schedule…</p>;
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
      <div className="font-medium">{preview.data.description}</div>
      <div className="mt-1 text-muted-foreground">
        Next runs: {preview.data.next_runs.slice(0, 3).map(formatDateTime).join(" · ")}
      </div>
    </div>
  );
}

export function JobDialog({
  job,
  defaults,
  onOpenChange,
  onSaved,
}: {
  job?: Job;
  defaults?: { kind: JobKind; target: string; name: string };
  onOpenChange: (open: boolean) => void;
  onSaved?: (job: Job) => void;
}) {
  const create = useCreateJob();
  const update = useUpdateJob();
  const notebooks = useNotebooks();
  const queries = useSavedQueries();
  const [name, setName] = useState(job?.name ?? defaults?.name ?? "");
  const [kind, setKind] = useState<JobKind>(job?.kind ?? defaults?.kind ?? "notebook");
  const [target, setTarget] = useState(job?.target ?? defaults?.target ?? "");
  const [schedule, setSchedule] = useState<ScheduleSpec>(job?.schedule ?? defaultSchedule("daily"));
  const pending = create.isPending || update.isPending;
  const error = (create.error ?? update.error)?.message;
  const ready = name.trim() !== "" && target !== "" && scheduleIsComplete(schedule);

  const targets =
    kind === "notebook"
      ? (notebooks.data ?? []).map((n) => ({ value: n.name, label: n.name }))
      : (queries.data ?? []).map((q) => ({ value: String(q.id), label: q.name }));

  const submit = () => {
    const callbacks = {
      onSuccess: (saved: Job) => {
        onSaved?.(saved);
        onOpenChange(false);
      },
    };
    if (job) update.mutate({ id: job.id, name, kind, target, schedule }, callbacks);
    else create.mutate({ name, kind, target, schedule, enabled: true }, callbacks);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{job ? "Edit job" : "New job"}</DialogTitle>
            <DialogDescription>
              Run a notebook or a saved query on a schedule. Jobs run only while ChakyBricks is
              open.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              dir="auto"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Refresh daily sales"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">What to run</label>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5 text-sm">
              {(["notebook", "query"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (k !== kind) {
                      setKind(k);
                      setTarget("");
                    }
                  }}
                  className={cn(
                    "rounded px-2 py-1 font-medium transition-colors",
                    kind === k
                      ? "bg-background shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k === "notebook" ? "Notebook" : "Saved query"}
                </button>
              ))}
            </div>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={kind === "notebook" ? "Choose a notebook" : "Choose a saved query"}
                />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span dir="auto">{t.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targets.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {kind === "notebook"
                  ? "Create a notebook first."
                  : "Save a query from the SQL editor first."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Schedule</label>
            <ScheduleEditor schedule={schedule} onChange={setSchedule} />
            <SchedulePreviewList schedule={schedule} />
          </div>

          <p className="min-h-4 text-xs text-destructive">{error}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || pending}>
              {job ? "Save" : "Create job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

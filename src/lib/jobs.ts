export type JobKind = "notebook" | "query";
export type JobStatus = "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export type ScheduleType = "manual" | "interval" | "daily" | "weekly" | "monthly" | "cron";

export interface ScheduleSpec {
  type: ScheduleType;
  minutes?: number | null;
  time?: string | null;
  days?: number[] | null;
  day?: number | null;
  expression?: string | null;
}

export interface JobRun {
  id: number;
  job_id: number;
  trigger: "manual" | "schedule";
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  message: string;
  log?: string;
}

export interface Job {
  id: number;
  name: string;
  kind: JobKind;
  target: string;
  schedule: ScheduleSpec;
  schedule_text: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run: JobRun | null;
  running: boolean;
  created_at: string;
  updated_at: string;
}

export interface JobInput {
  name: string;
  kind: JobKind;
  target: string;
  schedule: ScheduleSpec;
  enabled: boolean;
}

export interface SchedulePreview {
  description: string;
  next_runs: string[];
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
  { value: "manual", label: "Manual only" },
  { value: "interval", label: "Every few minutes or hours" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Certain weekdays" },
  { value: "monthly", label: "Once a month" },
  { value: "cron", label: "Custom (cron)" },
];

export const STATUS_LABELS: Record<JobStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export function defaultSchedule(type: ScheduleType): ScheduleSpec {
  switch (type) {
    case "interval":
      return { type, minutes: 60 };
    case "daily":
      return { type, time: "06:00" };
    case "weekly":
      return { type, time: "06:00", days: [0] };
    case "monthly":
      return { type, time: "06:00", day: 1 };
    case "cron":
      return { type, expression: "0 6 * * *" };
    default:
      return { type: "manual" };
  }
}

/** The interval preset is stored in minutes; the form edits it as a count and a unit. */
export function splitInterval(minutes: number): { count: number; unit: "minutes" | "hours" } {
  return minutes % 60 === 0 && minutes >= 60
    ? { count: minutes / 60, unit: "hours" }
    : { count: minutes, unit: "minutes" };
}

export function joinInterval(count: number, unit: "minutes" | "hours"): number {
  return unit === "hours" ? count * 60 : count;
}

export function scheduleIsComplete(schedule: ScheduleSpec): boolean {
  switch (schedule.type) {
    case "manual":
      return true;
    case "interval":
      return !!schedule.minutes && schedule.minutes >= 1;
    case "daily":
      return !!schedule.time;
    case "weekly":
      return !!schedule.time && (schedule.days?.length ?? 0) > 0;
    case "monthly":
      return !!schedule.time && !!schedule.day;
    case "cron":
      return !!schedule.expression?.trim();
  }
}

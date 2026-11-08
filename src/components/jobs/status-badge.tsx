import { Ban, CircleAlert, CircleCheck, Loader2, SkipForward, type LucideIcon } from "lucide-react";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";

const STYLES: Record<JobStatus, { icon: LucideIcon; className: string }> = {
  running: { icon: Loader2, className: "bg-primary/10 text-primary" },
  succeeded: { icon: CircleCheck, className: "bg-success/15 text-success" },
  failed: { icon: CircleAlert, className: "bg-destructive/10 text-destructive" },
  cancelled: { icon: Ban, className: "bg-muted text-muted-foreground" },
  skipped: { icon: SkipForward, className: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const { icon: Icon, className } = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <Icon className={cn("size-3", status === "running" && "animate-spin")} strokeWidth={2.25} />
      {STATUS_LABELS[status]}
    </span>
  );
}

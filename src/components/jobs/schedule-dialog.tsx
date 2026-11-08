import { useNavigate } from "react-router";
import { toast } from "sonner";
import { JobDialog } from "@/components/jobs/job-dialog";
import type { JobKind } from "@/lib/jobs";

export function ScheduleDialog({
  kind,
  target,
  name,
  onClose,
}: {
  kind: JobKind;
  target: string;
  name: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <JobDialog
      defaults={{ kind, target, name }}
      onOpenChange={(open) => !open && onClose()}
      onSaved={(job) =>
        toast.success(`Scheduled “${job.name}”`, {
          description: job.schedule_text,
          action: { label: "View job", onClick: () => navigate(`/jobs/${job.id}`) },
        })
      }
    />
  );
}

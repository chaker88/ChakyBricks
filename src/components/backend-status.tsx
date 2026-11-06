import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBackend } from "@/lib/backend-context";
import { cn } from "@/lib/utils";

export function BackendStatus({ className }: { className?: string }) {
  const backend = useBackend();
  const { dot, label, detail } = {
    connecting: {
      dot: "bg-amber-500 animate-pulse",
      label: "Starting",
      detail: "Starting engine…",
    },
    ready: {
      dot: "bg-success",
      label: "Engine",
      detail: backend.status === "ready" ? `Engine v${backend.health.version} running` : "",
    },
    error: {
      dot: "bg-destructive",
      label: "Offline",
      detail: backend.status === "error" ? backend.error : "",
    },
  }[backend.status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
          <span className={cn("size-1.5 rounded-full", dot)} />
          {label}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}

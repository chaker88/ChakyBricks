import { Cpu, Power } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useKernels, useShutdownKernel } from "@/hooks/use-environment";
import type { KernelSummary } from "@/lib/api-types";
import { formatBytes, formatDateTime } from "@/lib/format";
import { notebookUrl } from "@/lib/notebook";
import { cn } from "@/lib/utils";

function totalMemory(kernels: KernelSummary[]): number {
  return kernels.reduce((sum, k) => sum + (k.memory_bytes ?? 0), 0);
}

export function RunningKernelsList({ className }: { className?: string }) {
  const { data: kernels = [], isLoading } = useKernels();
  const shutdown = useShutdownKernel();
  const running = kernels.filter((k) => k.status !== "dead");

  if (isLoading) return <p className="p-3 text-xs text-muted-foreground">Loading…</p>;
  if (running.length === 0) {
    return (
      <p className={cn("p-3 text-xs text-muted-foreground", className)}>
        No kernels running. A kernel starts when you open a notebook.
      </p>
    );
  }

  return (
    <ul className={cn("divide-y", className)}>
      {running.map((kernel) => {
        const limit = kernel.memory_limit_mb * 1024 * 1024;
        const used = kernel.memory_bytes ?? 0;
        return (
          <li key={kernel.id} className="flex items-center gap-3 px-3 py-2 text-xs">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                kernel.status === "busy" ? "animate-pulse bg-primary" : "bg-success",
              )}
            />
            <div className="min-w-0 flex-1">
              <Link
                to={notebookUrl(kernel.notebook)}
                className="block truncate font-medium hover:underline"
              >
                {kernel.notebook}
              </Link>
              <div className="text-muted-foreground tabular-nums">
                {kernel.status} · {kernel.memory_bytes === null ? "—" : formatBytes(used)}
                {" · started "}
                {formatDateTime(kernel.started_at)}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={shutdown.isPending}
              onClick={() =>
                shutdown.mutate(kernel.id, {
                  onSuccess: () => toast(`Shut down the kernel for ${kernel.notebook}`),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              <Power />
              Shut down
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function RunningKernelsButton() {
  const { data: kernels = [] } = useKernels();
  const running = kernels.filter((k) => k.status !== "dead");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          title="Running kernels"
        >
          <Cpu />
          {running.length} {running.length === 1 ? "kernel" : "kernels"}
          {running.length > 0 && ` · ${formatBytes(totalMemory(running))}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium">Running kernels</div>
        <RunningKernelsList />
      </PopoverContent>
    </Popover>
  );
}

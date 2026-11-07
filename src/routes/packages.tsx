import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, Package, RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Page } from "@/components/page";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  environmentKeys,
  usePackageAction,
  usePackageJob,
  usePackages,
} from "@/hooks/use-environment";
import { formatDateTime } from "@/lib/format";

export function PackagesPage() {
  const listing = usePackages();
  const action = usePackageAction();
  const queryClient = useQueryClient();
  const [spec, setSpec] = useState("");
  const [filter, setFilter] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const job = usePackageJob(jobId);
  const outputRef = useRef<HTMLPreElement>(null);
  const running = job.data?.state === "queued" || job.data?.state === "running";

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
    const state = job.data?.state;
    if (state === "succeeded" || state === "failed") {
      void queryClient.invalidateQueries({ queryKey: environmentKeys.packages });
      void queryClient.invalidateQueries({ queryKey: environmentKeys.kernels });
    }
  }, [job.data?.output, job.data?.state, queryClient]);

  const start = (request: Parameters<typeof action.mutate>[0]) =>
    action.mutate(request, {
      onSuccess: (started) => setJobId(started.id),
      onError: (error) => toast.error(error.message),
    });

  const data = listing.data;
  const q = filter.trim().toLowerCase();
  const defaults = (data?.defaults ?? []).filter((p) => p.name.toLowerCase().includes(q));

  return (
    <Page
      title="Packages"
      description="Python packages available to notebook kernels in this workspace."
      actions={
        <Button variant="ghost" asChild>
          <Link to="/settings">
            <ArrowLeft />
            Settings
          </Link>
        </Button>
      }
    >
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
            Python {data.environment.python_version} ·{" "}
            <code className="select-text">{data.environment.path}</code>
            {data.environment.created_at &&
              ` · created ${formatDateTime(data.environment.created_at)}`}
            {!data.environment.ready && " · created when a kernel or install first needs it"}
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Install packages</h2>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (spec.trim()) start({ kind: "install", packages: spec });
              }}
            >
              <Input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="xgboost lightgbm==4.5.0"
                className="font-mono text-xs"
              />
              <Button type="submit" disabled={!spec.trim() || running || action.isPending}>
                {running ? <Loader2 className="animate-spin" /> : <Download />}
                Install
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Installs from PyPI into this workspace's notebook environment (needs internet).
              Restart running kernels to use newly installed packages. In a notebook you can also
              run <code className="font-mono">%pip install name</code>.
            </p>
          </section>

          {job.data && (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                {running && <Loader2 className="size-3.5 animate-spin" />}
                {job.data.action === "reset"
                  ? "Reset to defaults"
                  : `${job.data.action === "install" ? "Install" : "Uninstall"} ${job.data.packages.join(" ")}`}
                <Badge
                  variant={job.data.state === "failed" ? "destructive" : "secondary"}
                  className="font-normal"
                >
                  {job.data.state}
                </Badge>
                {job.data.state === "succeeded" && job.data.action !== "reset" && (
                  <span className="text-xs font-normal text-muted-foreground">
                    Restart kernels to pick up the change.
                  </span>
                )}
              </div>
              <pre
                ref={outputRef}
                className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap select-text"
              >
                {job.data.output || "Waiting…"}
                {job.data.error && `\n${job.data.error}`}
              </pre>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Installed by you · {data.installed.length}</h2>
              <Button
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw />
                Reset to defaults
              </Button>
            </div>
            {data.installed.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                Only the default packages are installed.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.installed.map((p) => (
                  <li key={p.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Package className="size-3.5 text-primary" />
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.version}</span>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={running}
                      onClick={() => start({ kind: "uninstall", name: p.name })}
                    >
                      <Trash2 />
                      Uninstall
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Default packages · {data.defaults.length}</h2>
              <div className="relative w-56">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Bundled with ChakyBricks and always available. They cannot be uninstalled; installing
              a newer version overrides them in this workspace.
            </p>
            <div className="grid max-h-80 grid-cols-2 gap-x-6 overflow-y-auto rounded-lg border p-3 text-xs lg:grid-cols-3">
              {defaults.map((p) => (
                <div key={p.name} className="flex items-center gap-2 py-0.5">
                  <span className="truncate">{p.name}</span>
                  <span className="font-mono text-muted-foreground">{p.version}</span>
                  {p.overridden && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
                      upgraded
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the notebook environment?</AlertDialogTitle>
            <AlertDialogDescription>
              All running kernels are shut down and every package you installed is removed. The
              default packages stay available. Notebooks and tables are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => start({ kind: "reset" })}
            >
              Reset to defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

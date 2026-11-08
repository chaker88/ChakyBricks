import { CheckCircle2, FileUp, Loader2, OctagonX, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ConfigureStep } from "@/components/import/configure-step";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useCancelImport, useClient, useImportJob } from "@/hooks/use-api";
import type { PreviewResponse } from "@/lib/api-types";
import { pickDataFile } from "@/lib/files";
import { formatDuration, formatNumber, plural } from "@/lib/format";
import { fileName, isTerminal } from "@/lib/import";

type Step =
  | { kind: "pick"; error?: string }
  | { kind: "loading"; path: string }
  | { kind: "configure"; preview: PreviewResponse }
  | { kind: "progress"; jobId: string; preview: PreviewResponse };

export function ImportWizard({
  open,
  onOpenChange,
  onJobStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobStarted: (jobId: string) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const client = useClient();

  const choose = async () => {
    const path = await pickDataFile();
    if (!path || !client) return;
    setStep({ kind: "loading", path });
    try {
      const preview = await client.post<PreviewResponse>("/api/imports/preview", { path });
      setStep({ kind: "configure", preview });
    } catch (error) {
      setStep({ kind: "pick", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const wide = step.kind === "configure";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={wide ? "flex h-[85vh] flex-col gap-0 p-0 sm:max-w-6xl" : "sm:max-w-lg"}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {wide ? (
          <ConfigureStep
            preview={step.preview}
            onBack={() => setStep({ kind: "pick" })}
            onStarted={(jobId) => {
              onJobStarted(jobId);
              setStep({ kind: "progress", jobId, preview: step.preview });
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import data</DialogTitle>
              <DialogDescription>
                CSV, TSV, Parquet, JSON / NDJSON or Excel. Files are read in place and stored as
                Delta tables in your workspace.
              </DialogDescription>
            </DialogHeader>
            {step.kind === "progress" ? (
              <ProgressStep
                jobId={step.jobId}
                onBack={() => setStep({ kind: "configure", preview: step.preview })}
                onClose={() => onOpenChange(false)}
              />
            ) : (
              <PickStep
                loadingPath={step.kind === "loading" ? step.path : null}
                error={step.kind === "pick" ? step.error : undefined}
                disabled={!client}
                onChoose={choose}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickStep({
  loadingPath,
  error,
  disabled,
  onChoose,
}: {
  loadingPath: string | null;
  error?: string;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <div className="space-y-3">
      <button
        onClick={onChoose}
        disabled={disabled || loadingPath !== null}
        className="flex w-full flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-60"
      >
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {loadingPath ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <FileUp className="size-5" />
          )}
        </div>
        <div>
          <div className="text-sm font-medium">
            {loadingPath ? `Reading ${fileName(loadingPath)}…` : "Choose a file"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Large files are streamed — up to ~10 GB. Excel is limited to 50 MB.
          </div>
        </div>
      </button>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function ProgressStep({
  jobId,
  onBack,
  onClose,
}: {
  jobId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const { data: job } = useImportJob(jobId);
  const cancel = useCancelImport();
  const navigate = useNavigate();

  if (!job) {
    return <Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />;
  }

  const name = `${job.schema}.${job.table}`;
  const finished = isTerminal(job.state);
  const percent = job.progress === null ? null : Math.round(job.progress * 100);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {job.state === "succeeded" ? (
            <CheckCircle2 className="size-5 text-success" />
          ) : job.state === "failed" ? (
            <OctagonX className="size-5 text-destructive" />
          ) : job.state === "cancelled" ? (
            <OctagonX className="size-5 text-muted-foreground" />
          ) : (
            <Upload className="size-5 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {
              {
                queued: `Waiting to import into ${name}…`,
                running: `Importing into ${name}…`,
                succeeded: `Imported into ${name}`,
                failed: `Import into ${name} failed`,
                cancelled: `Import into ${name} cancelled`,
              }[job.state]
            }
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {fileName(job.source)}
          </div>
        </div>
      </div>

      {!finished && (
        <div className="space-y-2">
          {percent === null ? (
            <div className="h-2 overflow-hidden rounded-full bg-primary/20">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          ) : (
            <Progress value={percent} />
          )}
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              {plural(job.rows_written, "row")}
              {job.estimated_rows ? ` of ~${formatNumber(job.estimated_rows)}` : ""}
            </span>
            <span>
              {percent !== null && `${percent}% · `}
              {formatDuration(job.elapsed_seconds)}
            </span>
          </div>
        </div>
      )}

      {job.state === "succeeded" && (
        <p className="text-sm text-muted-foreground">
          {plural(job.rows_written, "row")} in {formatDuration(job.elapsed_seconds)}.
        </p>
      )}
      {job.state === "failed" && (
        <p className="max-h-40 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-destructive select-text">
          {job.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {!finished && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Run in background
            </Button>
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(job.id)}
            >
              Cancel import
            </Button>
          </>
        )}
        {(job.state === "failed" || job.state === "cancelled") && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={onBack}>Back to settings</Button>
          </>
        )}
        {job.state === "succeeded" && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
            <Button
              onClick={() => {
                onClose();
                navigate(`/catalog/${job.schema}/${job.table}`);
              }}
            >
              Open table
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

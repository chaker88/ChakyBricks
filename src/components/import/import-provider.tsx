import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ImportWizard } from "@/components/import/import-wizard";
import { queryKeys, useImportJob } from "@/hooks/use-api";
import { formatNumber } from "@/lib/format";
import { ImportContext } from "@/lib/import-context";
import { isTerminal } from "@/lib/import";

export function ImportProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [jobs, setJobs] = useState<string[]>([]);

  const openImport = useCallback(() => {
    setSession((s) => s + 1);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openImport }), [openImport]);

  return (
    <ImportContext.Provider value={value}>
      {children}
      <ImportWizard
        key={session}
        open={open}
        onOpenChange={setOpen}
        onJobStarted={(id) => setJobs((current) => [...current, id])}
      />
      {jobs.map((id) => (
        <JobWatcher
          key={id}
          jobId={id}
          notify={!open}
          onDone={() => setJobs((current) => current.filter((j) => j !== id))}
        />
      ))}
    </ImportContext.Provider>
  );
}

function JobWatcher({
  jobId,
  notify,
  onDone,
}: {
  jobId: string;
  notify: boolean;
  onDone: () => void;
}) {
  const { data: job } = useImportJob(jobId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notifyRef = useRef(notify);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    notifyRef.current = notify;
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!job || !isTerminal(job.state)) return;
    if (job.state === "succeeded") {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
      queryClient.invalidateQueries({ queryKey: queryKeys.table(job.schema, job.table) });
    }
    if (notifyRef.current) {
      const name = `${job.schema}.${job.table}`;
      if (job.state === "succeeded") {
        toast.success(`Imported ${formatNumber(job.rows_written)} rows into ${name}`, {
          action: { label: "Open", onClick: () => navigate(`/catalog/${job.schema}/${job.table}`) },
        });
      } else if (job.state === "failed") {
        toast.error(`Import into ${name} failed`, { description: job.error ?? undefined });
      } else {
        toast(`Import into ${name} cancelled`);
      }
    }
    onDoneRef.current();
  }, [job, queryClient, navigate]);

  return null;
}

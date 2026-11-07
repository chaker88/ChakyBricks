import {
  Copy,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { EmptyState, Page } from "@/components/page";
import { QueryNameDialog } from "@/components/sql/query-name-dialog";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/hooks/use-api";
import {
  useCreateDashboard,
  useCreateSampleDashboard,
  useDashboards,
  useDeleteDashboard,
  useDuplicateDashboard,
  useUpdateDashboard,
} from "@/hooks/use-dashboards";
import { formatDateTime } from "@/lib/format";
import type { DashboardSummary } from "@/lib/dashboard-types";

export function DashboardsPage() {
  const { data, isLoading } = useDashboards();
  const client = useClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const create = useCreateDashboard();
  const sample = useCreateSampleDashboard();
  const duplicate = useDuplicateDashboard();
  const rename = useUpdateDashboard();
  const remove = useDeleteDashboard();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<DashboardSummary | null>(null);
  const [deleting, setDeleting] = useState<DashboardSummary | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (searchParams.has("new") && !handled.current) {
      handled.current = true;
      setSearchParams({}, { replace: true });
      setCreating(true);
    }
  }, [searchParams, setSearchParams]);

  const openSample = () =>
    sample.mutate(undefined, {
      onSuccess: (dashboard) => navigate(`/dashboards/${dashboard.id}`),
      onError: (error) => toast.error(error.message),
    });

  return (
    <Page
      title="Dashboards"
      description="Interactive dashboards built from tables and saved queries."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={openSample} disabled={sample.isPending || !client}>
            <Sparkles />
            {sample.isPending ? "Generating sample data…" : "Sample dashboard"}
          </Button>
          <Button onClick={() => setCreating(true)} disabled={!client}>
            <Plus />
            New dashboard
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : !data?.length ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No dashboards yet"
          description="Combine charts, KPI scorecards and tables with global filters and cross-filtering. Try the sample dashboard to see what is possible."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={openSample} disabled={sample.isPending}>
                <Sparkles />
                {sample.isPending ? "Generating…" : "Sample dashboard"}
              </Button>
              <Button onClick={() => setCreating(true)}>New dashboard</Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((dashboard) => (
            <div
              key={dashboard.id}
              className="group relative rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <Link
                to={`/dashboards/${dashboard.id}`}
                className="absolute inset-0 rounded-xl"
                aria-label={dashboard.name}
              />
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <LayoutDashboard className="size-4.5 text-primary" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate text-sm font-medium">
                    {dashboard.name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {dashboard.tile_count} {dashboard.tile_count === 1 ? "tile" : "tiles"} ·{" "}
                    {dashboard.filter_count} {dashboard.filter_count === 1 ? "filter" : "filters"}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative z-10 size-7"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(dashboard)}>
                      <Pencil />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        duplicate.mutate(dashboard.id, {
                          onSuccess: (copy) => toast.success(`Created “${copy.name}”`),
                          onError: (error) => toast.error(error.message),
                        })
                      }
                    >
                      <Copy />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(dashboard)}>
                      <Trash2 />
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {dashboard.description && (
                <p dir="auto" className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                  {dashboard.description}
                </p>
              )}
              <div className="mt-3 text-[11px] text-muted-foreground">
                Updated {formatDateTime(dashboard.updated_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <QueryNameDialog
          open
          onOpenChange={(open) => !open && setCreating(false)}
          title="New dashboard"
          description="Give it a name, then add tiles in edit mode."
          initialName=""
          submitLabel="Create"
          pending={create.isPending}
          error={create.error?.message}
          onSubmit={(name) =>
            create.mutate(
              { name },
              {
                onSuccess: (dashboard) => {
                  setCreating(false);
                  navigate(`/dashboards/${dashboard.id}?edit=1`);
                },
              },
            )
          }
        />
      )}
      {renaming && (
        <QueryNameDialog
          open
          onOpenChange={(open) => !open && setRenaming(null)}
          title="Rename dashboard"
          description="The name is shown in the dashboards list and in exports."
          initialName={renaming.name}
          submitLabel="Rename"
          pending={rename.isPending}
          error={rename.error?.message}
          onSubmit={(name) =>
            rename.mutate({ id: renaming.id, name }, { onSuccess: () => setRenaming(null) })
          }
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The dashboard and its layout are deleted. The tables and saved queries it uses are not
              touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, { onError: (error) => toast.error(error.message) })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

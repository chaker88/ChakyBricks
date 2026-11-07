import { MoreHorizontal, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
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
  useCreateNotebook,
  useDeleteNotebook,
  useNotebooks,
  useRenameNotebook,
  type NotebookEntry,
} from "@/hooks/use-notebooks";
import { formatBytes, formatDateTime } from "@/lib/format";
import { notebookUrl, starterCellSpecs } from "@/lib/notebook";

export function NotebooksPage() {
  const { data, isLoading } = useNotebooks();
  const create = useCreateNotebook();
  const navigate = useNavigate();
  const client = useClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const handled = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<NotebookEntry | null>(null);
  const [deleting, setDeleting] = useState<NotebookEntry | null>(null);
  const rename = useRenameNotebook();
  const remove = useDeleteNotebook();

  const createNotebook = (name?: string, table?: string) => {
    create.mutate(
      { name, cells: table ? starterCellSpecs(table) : undefined },
      {
        onSuccess: (result) => navigate(notebookUrl(result.name), { replace: !!table }),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const createNotebookRef = useRef(createNotebook);
  useEffect(() => {
    createNotebookRef.current = createNotebook;
  });

  useEffect(() => {
    const key = searchParams.toString();
    if (!client || !key || handled.current === key) return;
    handled.current = key;
    const table = searchParams.get("table");
    setSearchParams({}, { replace: true });
    if (table) createNotebookRef.current(`Explore ${table}`, table);
    else if (searchParams.has("new")) createNotebookRef.current();
  }, [client, searchParams, setSearchParams]);

  return (
    <Page
      title="Notebooks"
      description="Python notebooks with SQL and Markdown cells. Saved as .ipynb in your workspace."
      actions={
        <Button onClick={() => createNotebook()} disabled={create.isPending || !client}>
          <Plus />
          New notebook
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !data?.length ? (
        <EmptyState
          icon={NotebookPen}
          title="No notebooks yet"
          description="Notebooks run on a local Python kernel with pandas, Polars, DuckDB, scikit-learn and the cb helper preloaded."
          action={<Button onClick={() => createNotebook()}>New notebook</Button>}
        />
      ) : (
        <div className="divide-y rounded-xl border">
          {data.map((entry) => (
            <div key={entry.name} className="group flex items-center gap-3 px-4 py-3">
              <NotebookPen className="size-4 shrink-0 text-primary" />
              <Link
                to={notebookUrl(entry.name)}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {entry.name}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(entry.size_bytes)} · {formatDateTime(entry.updated_at)}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(entry)}>
                    <Pencil />
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(entry)}>
                    <Trash2 />
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <QueryNameDialog
          open
          onOpenChange={(open) => !open && setRenaming(null)}
          title="Rename notebook"
          description="Renames the .ipynb file in your workspace."
          initialName={renaming.name}
          submitLabel="Rename"
          pending={rename.isPending}
          error={rename.error?.message}
          onSubmit={(newName) =>
            rename.mutate({ name: renaming.name, newName }, { onSuccess: () => setRenaming(null) })
          }
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The notebook file and its outputs are deleted and its kernel is stopped. Tables it
              saved stay in the catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.name, { onError: (error) => toast.error(error.message) })
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

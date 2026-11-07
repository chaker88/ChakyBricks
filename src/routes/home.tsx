import {
  Clock,
  Code2,
  LayoutDashboard,
  NotebookPen,
  Table2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { EmptyState, Page } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/hooks/use-api";
import { useBackend } from "@/lib/backend-context";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { useImport } from "@/lib/import-context";

export function HomePage() {
  const backend = useBackend();
  const catalog = useCatalog();
  const { openImport } = useImport();
  const navigate = useNavigate();
  const comingSoon = (label: string) => () => toast(`${label} is coming soon`);

  const actions: { label: string; description: string; icon: LucideIcon; onClick: () => void }[] = [
    {
      label: "Import data",
      description: "CSV, Parquet, JSON or Excel",
      icon: Upload,
      onClick: openImport,
    },
    {
      label: "New notebook",
      description: "Python, SQL and Markdown cells",
      icon: NotebookPen,
      onClick: () => navigate("/notebooks?new=1"),
    },
    {
      label: "New query",
      description: "Explore tables with SQL",
      icon: Code2,
      onClick: () => navigate("/sql?new=1"),
    },
    {
      label: "New dashboard",
      description: "Charts, KPIs and filters",
      icon: LayoutDashboard,
      onClick: comingSoon("Dashboards"),
    },
  ];

  const recent = (catalog.data?.schemas.flatMap((s) => s.tables) ?? [])
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);

  return (
    <Page
      title="Welcome to ChakyBricks"
      description="Your local lakehouse — data never leaves this machine."
    >
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {actions.map(({ label, description, icon: Icon, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className="group flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" />
            </div>
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
            </div>
          </button>
        ))}
      </section>

      <section className="mt-8 flex flex-1 flex-col">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Recent tables
        </h2>
        {backend.status === "connecting" || catalog.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Nothing here yet"
            description="Tables, queries, notebooks and dashboards you work on will show up here. Start by importing a dataset."
          />
        ) : (
          <div className="divide-y rounded-xl border">
            {recent.map((table) => (
              <Link
                key={`${table.schema}.${table.name}`}
                to={`/catalog/${table.schema}/${table.name}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <Table2 className="size-4 text-primary" />
                <span className="text-sm font-medium">
                  <span className="text-muted-foreground">{table.schema}.</span>
                  {table.name}
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatNumber(table.row_count)} rows · {formatBytes(table.size_bytes)} ·{" "}
                  {formatDateTime(table.updated_at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

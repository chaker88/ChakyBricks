import { Clock, Code2, LayoutDashboard, NotebookPen, Upload, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Page } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackend } from "@/lib/backend-context";

const QUICK_ACTIONS: { label: string; description: string; icon: LucideIcon }[] = [
  { label: "Import data", description: "CSV, Parquet, JSON or Excel", icon: Upload },
  { label: "New notebook", description: "Python, SQL and Markdown cells", icon: NotebookPen },
  { label: "New query", description: "Explore tables with SQL", icon: Code2 },
  { label: "New dashboard", description: "Charts, KPIs and filters", icon: LayoutDashboard },
];

export function HomePage() {
  const backend = useBackend();

  return (
    <Page
      title="Welcome to ChakyBricks"
      description="Your local lakehouse — data never leaves this machine."
    >
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {QUICK_ACTIONS.map(({ label, description, icon: Icon }) => (
          <button
            key={label}
            onClick={() => toast(`${label} is coming soon`)}
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
          Recent
        </h2>
        {backend.status === "connecting" ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        ) : (
          <EmptyState
            icon={Clock}
            title="Nothing here yet"
            description="Tables, queries, notebooks and dashboards you open will show up here. Start by importing a dataset."
          />
        )}
      </section>
    </Page>
  );
}

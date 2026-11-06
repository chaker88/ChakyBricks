import { CalendarClock, LayoutDashboard, NotebookPen } from "lucide-react";
import { EmptyState, Page } from "@/components/page";

export function NotebooksPage() {
  return (
    <Page title="Notebooks" description="Python notebooks with SQL and Markdown cells.">
      <EmptyState
        icon={NotebookPen}
        title="No notebooks yet"
        description="Notebooks run on a local Python kernel with pandas, Polars, DuckDB and the cb helper preloaded."
      />
    </Page>
  );
}

export function DashboardsPage() {
  return (
    <Page
      title="Dashboards"
      description="Interactive dashboards built from tables and saved queries."
    >
      <EmptyState
        icon={LayoutDashboard}
        title="No dashboards yet"
        description="Combine charts, KPI scorecards and tables with global filters and cross-filtering."
      />
    </Page>
  );
}

export function JobsPage() {
  return (
    <Page title="Jobs" description="Run notebooks and saved queries on a schedule.">
      <EmptyState
        icon={CalendarClock}
        title="No jobs yet"
        description="Scheduled jobs run only while ChakyBricks is open."
      />
    </Page>
  );
}

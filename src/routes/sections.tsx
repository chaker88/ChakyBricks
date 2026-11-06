import { CalendarClock, Code2, Database, LayoutDashboard, NotebookPen } from "lucide-react";
import { EmptyState, Page } from "@/components/page";

export function CatalogPage() {
  return (
    <Page title="Catalog" description="Schemas, tables and columns in your workspace.">
      <EmptyState
        icon={Database}
        title="No tables yet"
        description="Import a CSV, Parquet, JSON or Excel file to create your first Delta table. It becomes queryable from both SQL and Python."
      />
    </Page>
  );
}

export function SqlPage() {
  return (
    <Page title="SQL editor" description="Query any table in the catalog with DuckDB SQL.">
      <EmptyState
        icon={Code2}
        title="No queries yet"
        description="Write SQL against your tables, chart the results and save queries for dashboards."
      />
    </Page>
  );
}

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

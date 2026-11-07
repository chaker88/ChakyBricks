import { CalendarClock, LayoutDashboard } from "lucide-react";
import { EmptyState, Page } from "@/components/page";

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

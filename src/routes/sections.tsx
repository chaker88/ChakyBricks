import { CalendarClock } from "lucide-react";
import { EmptyState, Page } from "@/components/page";

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

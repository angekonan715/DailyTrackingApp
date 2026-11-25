import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// Phase 5: dashboard with to-do progress, workouts, steps, books and streaks.
export default function SummaryPage() {
  return (
    <>
      <PageHeader title="Summary" />
      <EmptyState title="Your week at a glance" hint="Built in Phase 5." />
    </>
  );
}

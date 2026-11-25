import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// Phase 2: log workouts by hand + weekly summary.
export default function WorkoutsPage() {
  return (
    <>
      <PageHeader
        title="Workouts"
        action={
          <Link
            href="/workouts/import"
            className="text-sm font-medium text-accent"
          >
            Import Samsung
          </Link>
        }
      />
      <EmptyState title="No workouts yet" hint="Built in Phase 2." />
    </>
  );
}

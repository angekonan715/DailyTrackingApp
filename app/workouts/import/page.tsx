import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// Phase 3: upload Samsung Health CSV export, preview, then save.
export default function SamsungImportPage() {
  return (
    <>
      <PageHeader
        title="Import from Samsung Health"
        subtitle="Samsung Health › Settings › Download personal data"
      />
      <EmptyState title="CSV import" hint="Built in Phase 3." />
    </>
  );
}

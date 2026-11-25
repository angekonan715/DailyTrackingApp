import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// Phase 4: books, current page, pages left, estimated finish date.
export default function BooksPage() {
  return (
    <>
      <PageHeader title="Books" />
      <EmptyState title="No books yet" hint="Built in Phase 4." />
    </>
  );
}

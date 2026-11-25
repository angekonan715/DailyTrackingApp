import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// Phase 1 setup: Supabase email magic-link sign-in.
export default function LoginPage() {
  return (
    <>
      <PageHeader title="Sign in" />
      <EmptyState title="Magic-link login" hint="Wired up with Supabase in Phase 1." />
    </>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

const noopSubscribe = () => () => {};
const formatToday = () =>
  new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

// Phase 1: daily to-do list (add, check off, edit, reorder, carry over).
// The date is read in the browser so it uses the phone's local time zone.
export default function TodayPage() {
  const today = useSyncExternalStore(noopSubscribe, formatToday, () => "");

  return (
    <>
      <PageHeader title="Today" subtitle={today} />
      <EmptyState title="No tasks yet" hint="Built in Phase 1." />
    </>
  );
}

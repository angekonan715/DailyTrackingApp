"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "@/components/BottomNav";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showNav = !pathname.startsWith("/login") && !pathname.startsWith("/auth");

  return (
    <>
      <main
        className={`flex-1 w-full max-w-xl mx-auto px-4 ${showNav ? "pb-28" : "pb-10"}`}
        style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
      >
        {children}
      </main>
      {showNav ? <BottomNav /> : null}
    </>
  );
}

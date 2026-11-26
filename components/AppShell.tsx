"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import InstallPrompt, { useInstallVisible } from "@/components/InstallPrompt";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showNav = !pathname.startsWith("/login") && !pathname.startsWith("/auth");
  const installVisible = useInstallVisible();
  const bottomPad = showNav ? (installVisible ? "pb-64" : "pb-28") : installVisible ? "pb-44" : "pb-10";

  return (
    <>
      <main
        className={`flex-1 w-full max-w-xl mx-auto px-4 ${bottomPad}`}
        style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
      >
        {children}
      </main>
      <InstallPrompt aboveNav={showNav} />
      {showNav ? <BottomNav /> : null}
    </>
  );
}

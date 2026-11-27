"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/today", label: "Today", icon: "✓" },
  { href: "/workouts", label: "Workouts", icon: "🏃" },
  { href: "/hobbies", label: "Hobby", icon: "★" },
  { href: "/books", label: "Books", icon: "📖" },
  { href: "/notes", label: "Notes", icon: "✎" },
  { href: "/summary", label: "Summary", icon: "📊" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 border-t border-black/10 dark:border-white/10 bg-background/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="max-w-xl mx-auto grid grid-cols-6">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[11px] leading-none ${
                  active ? "text-accent font-semibold" : "text-muted"
                }`}
              >
                <span className="text-xl leading-none" aria-hidden>
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

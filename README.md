# Daily Hub

A free, personal, mobile-first web app for:

- **Today**: a daily to-do list you check off
- **Workouts**: log by hand or import from Samsung Health (CSV export)
- **Books**: what you're reading and how many pages are left
- **Summary**: your week at a glance

Runs on free tiers: **Next.js** on **Vercel**, **Supabase** for the database and login. Installable on your phone as an app (PWA).

## Project layout

```
app/
  layout.tsx            Root layout + bottom tab bar
  manifest.ts           PWA manifest (home-screen install)
  today/                Phase 1 – to-do list
  workouts/             Phase 2 – workouts + summary
    import/             Phase 3 – Samsung Health CSV import
  books/                Phase 4 – books & reading progress
  summary/              Phase 5 – dashboard
  login/                Magic-link sign in
components/             BottomNav, PageHeader, EmptyState, ServiceWorkerRegister
lib/
  supabase/             Browser + server Supabase clients
  samsung-csv.ts        Samsung export parser (Phase 3)
  dates.ts              Date helpers
types/index.ts          Shared TypeScript types
supabase/migrations/    Database schema + Row Level Security
public/sw.js            Service worker
public/icons/           App icons
docs/CURSOR_PROMPT.md   Prompt to build each phase in Cursor
.cursor/rules/          Project rules Cursor reads automatically
```

## Getting started

1. **Install**: `npm install`
2. **Supabase**: create a free project at [supabase.com](https://supabase.com). In the SQL Editor, paste and run `supabase/migrations/0001_init.sql`.
3. **Keys**: copy `.env.example` to `.env.local` and fill in the URL and anon key (Supabase › Project Settings › API).
4. **Run**: `npm run dev`, then open http://localhost:3000
5. **Build features**: open `docs/CURSOR_PROMPT.md`, paste the prompt into Cursor, and go one phase at a time.

## Put it on your phone

1. Import this repo at [vercel.com](https://vercel.com) (free) and add the same two env variables.
2. Open the Vercel URL in Chrome on your phone › ⋮ › **Add to Home screen**.

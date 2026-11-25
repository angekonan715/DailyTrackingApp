# Cursor build prompt

Paste this into Cursor chat (Agent mode). The project skeleton already exists, so Cursor should fill it in rather than create a new app.

````text
You are a senior full-stack developer. This repository already contains the skeleton of a personal, mobile-first web app called "Daily Hub" (Next.js App Router + TypeScript + Tailwind v4 + Supabase, installable PWA). Read .cursor/rules/project.mdc, types/index.ts and supabase/migrations/0001_init.sql first, then build the features below INTO the existing structure. I use it mainly on my Android phone. It must cost $0/month to run (free tiers only). Build one phase at a time and STOP after each phase so I can test. Explain any setup I must do myself (accounts, keys) in plain, beginner-friendly steps.

## Already in place
- Routes: /today, /workouts, /workouts/import, /books, /summary, /login (placeholder pages)
- Bottom tab bar (components/BottomNav.tsx), PageHeader, EmptyState
- Supabase clients in lib/supabase/client.ts and lib/supabase/server.ts
- Database schema + Row Level Security in supabase/migrations/0001_init.sql
- PWA: app/manifest.ts, public/sw.js, icons in public/icons

## Phase 1 – Login + Daily To-Do list
- Supabase email magic-link login on /login; redirect signed-out users to /login.
- Add a task (title, optional note, optional priority: low/medium/high).
- Tap a checkbox to mark done / not done; done tasks move to the bottom with a strikethrough.
- Edit, delete, and drag to reorder tasks.
- Tasks belong to a date. Default view = today. Arrows to see other days.
- "Carry over" button: moves unfinished tasks from yesterday to today.
- Progress at the top, e.g. "4 of 7 done" with a progress bar.

## Phase 2 – Workouts (manual entry + summary)
- Form to log a workout: date, start time, type (run, walk, ride, strength, yoga, other), duration (min), distance (km/mi, optional), calories (optional), average heart rate (optional), notes.
- List of workouts, newest first, with filter by type.
- Summary cards: this week vs last week (total time, distance, number of workouts, calories), current streak of active days, and a simple bar chart of minutes per day for the last 4 weeks.

## Phase 3 – Samsung Health import (CSV upload)
- On /workouts/import, I upload the CSV files from Samsung Health's "Download personal data" export (Samsung Health > Settings > Download personal data).
- Import the exercise file (CSV with "exercise" in its name) and optionally the step count file into daily_steps.
- Samsung's CSVs have a metadata line before the header row and use column names like "com.samsung.health.exercise.start_time". Detect the real header row, map columns by name, and convert exercise type codes using lib/samsung-csv.ts (with an "other" fallback).
- Parse in the browser, show a preview table, let me confirm, then save with source = "samsung".
- Skip duplicates (the table has a unique constraint on user_id + started_at + type) so I can re-upload a fresh export every week.
- Show short export instructions and the date of my last import.

## Phase 4 – Books
- Add a book: title, author, total pages, status (Want to read / Reading / Finished), optional cover image URL.
- For "Reading" books: quick "update current page" input, then pages left, % complete, and a progress bar.
- Log reading sessions (date + pages read) to calculate average pages per day and an estimated finish date.
- When current page = total pages, mark Finished and record the finish date.
- Show "Finished this year" count and list.

## Phase 5 – Summary dashboard (no AI)
- Today's to-do progress, this week's workouts vs last week, steps (if imported), books in progress with pages left, and streaks (to-do days, active days, reading days).
- All calculations in code, no paid APIs.

## Phase 6 (OPTIONAL, only if I ask) – AI weekly coach
- "Weekly insight" button that sends a short summary of my week to a low-cost AI API (key in AI_API_KEY) and returns 3 short, encouraging tips.
- Cheap model, cache the result for the week, hard monthly spending limit under $5/month.

## Quality rules
- Any schema change goes in a new file in supabase/migrations/ and is mirrored in types/index.ts.
- Handle loading, empty states and errors nicely.
- After each phase, tell me: what you built, how to run it locally, and how to test it on my phone.

Start with Phase 1.
````

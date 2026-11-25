-- Daily Hub: initial schema. Every table is private to its owner (RLS).

-- To-dos -------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null,
  note        text,
  priority    text check (priority in ('low','medium','high')),
  task_date   date not null default current_date,
  done        boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index tasks_user_date on public.tasks (user_id, task_date);

-- Workouts -----------------------------------------------------------
create table public.workouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  started_at      timestamptz not null,
  type            text not null check (type in ('run','walk','ride','strength','yoga','other')),
  duration_min    numeric not null check (duration_min >= 0),
  distance_km     numeric,
  calories        numeric,
  avg_heart_rate  numeric,
  notes           text,
  source          text not null default 'manual' check (source in ('manual','samsung')),
  created_at      timestamptz not null default now(),
  -- Re-uploading a Samsung export must not create duplicates.
  unique (user_id, started_at, type)
);
create index workouts_user_started on public.workouts (user_id, started_at desc);

create table public.daily_steps (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  day      date not null,
  steps    integer not null check (steps >= 0),
  primary key (user_id, day)
);

-- Books --------------------------------------------------------------
create table public.books (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  title         text not null,
  author        text,
  total_pages   integer not null check (total_pages > 0),
  current_page  integer not null default 0 check (current_page >= 0),
  status        text not null default 'want' check (status in ('want','reading','finished')),
  cover_url     text,
  finished_at   date,
  created_at    timestamptz not null default now()
);

create table public.reading_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  book_id     uuid not null references public.books on delete cascade,
  day         date not null default current_date,
  pages_read  integer not null check (pages_read > 0)
);
create index reading_sessions_user_day on public.reading_sessions (user_id, day);

-- Row Level Security: only the owner can read/write their rows -------
do $$
declare t text;
begin
  foreach t in array array['tasks','workouts','daily_steps','books','reading_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner_all" on public.%I for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

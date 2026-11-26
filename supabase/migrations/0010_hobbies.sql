-- Hobbies each person enjoys, and the days they spent time on them.
-- Paste this into the Supabase SQL editor and run it.

create table if not exists public.hobbies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.hobby_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  hobby_id uuid not null references public.hobbies (id) on delete cascade,
  day date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists hobby_sessions_user_day on public.hobby_sessions (user_id, day desc);

alter table public.hobbies enable row level security;
alter table public.hobby_sessions enable row level security;

drop policy if exists "owner_all" on public.hobbies;
create policy "owner_all" on public.hobbies for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on public.hobby_sessions;
create policy "owner_all" on public.hobby_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.hobbies to authenticated;
grant select, insert, update, delete on public.hobby_sessions to authenticated;

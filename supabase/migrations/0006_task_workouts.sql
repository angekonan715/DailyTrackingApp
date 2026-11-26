-- Link exercise and workout tasks to a workout, and store an OpenAI key for the coach.
-- Paste this into the Supabase SQL editor and run it.

alter table public.tasks
  add column if not exists kind text not null default 'task';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_kind_check') then
    alter table public.tasks
      add constraint tasks_kind_check check (kind in ('task', 'exercise', 'workout'));
  end if;
end $$;

alter table public.workouts
  add column if not exists task_id uuid unique references public.tasks (id) on delete cascade;

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  openai_api_key text
);

alter table public.user_settings enable row level security;

drop policy if exists "owner_all" on public.user_settings;
create policy "owner_all" on public.user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_settings to authenticated;

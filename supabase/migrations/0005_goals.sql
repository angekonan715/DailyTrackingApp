-- Weekly and monthly targets. Run this in the Supabase SQL editor.

create table public.goals (
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  metric           text not null check (metric in ('tasks', 'workout_minutes', 'workouts', 'pages', 'steps')),
  weekly_target    integer check (weekly_target is null or weekly_target >= 0),
  monthly_target   integer check (monthly_target is null or monthly_target >= 0),
  primary key (user_id, metric)
);

alter table public.goals enable row level security;

create policy "owner_all" on public.goals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.goals to authenticated;

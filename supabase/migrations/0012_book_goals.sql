-- Reading goals count finished books for the year, split into a month and a week.
-- Pages stay on the daily reading log. Paste this whole script into the Supabase SQL editor and run it.

alter table public.goals
  add column if not exists yearly_target integer check (yearly_target is null or yearly_target >= 0);

do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.goals'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%metric%';
  if cname is not null then
    execute format('alter table public.goals drop constraint %I', cname);
  end if;
end $$;

alter table public.goals
  add constraint goals_metric_check
  check (metric in ('tasks', 'workout_minutes', 'workouts', 'pages', 'steps', 'books'));

update public.books
set finished_at = created_at::date
where status = 'finished' and finished_at is null;

create or replace function public.household_summary(target uuid, today date, tz text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ok boolean;
  week_start date;
  week_end date;
  month_start date;
  month_end date;
  year_start date;
  year_end date;
  zone_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in again.';
  end if;

  if tz is not null and length(tz) <= 64 and exists (select 1 from pg_timezone_names where name = tz) then
    zone_name := tz;
  else
    zone_name := 'UTC';
  end if;

  select exists (
    select 1
    from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    where me.user_id = auth.uid()
      and them.user_id = target
      and (them.user_id = auth.uid() or them.share_summary)
  ) into ok;

  if not ok then
    raise exception 'That summary is not shared.';
  end if;

  week_start := today - (extract(isodow from today)::int - 1);
  week_end := week_start + 7;
  month_start := date_trunc('month', today)::date;
  month_end := (date_trunc('month', today) + interval '1 month')::date;
  year_start := date_trunc('year', today)::date;
  year_end := (date_trunc('year', today) + interval '1 year')::date;

  return jsonb_build_object(
    'tasks', jsonb_build_object(
      'today', (select count(*) from public.tasks where user_id = target and done and task_date = today),
      'week', (select count(*) from public.tasks where user_id = target and done and task_date >= week_start and task_date < week_end),
      'month', (select count(*) from public.tasks where user_id = target and done and task_date >= month_start and task_date < month_end),
      'year', (select count(*) from public.tasks where user_id = target and done and task_date >= year_start and task_date < year_end),
      'weekDays', (
        select coalesce(jsonb_agg(c order by n), '[0,0,0,0,0,0,0]'::jsonb)
        from (
          select d.n, count(t.id)::int as c
          from generate_series(0, 6) as d(n)
          left join public.tasks t
            on t.user_id = target and t.done and t.task_date = week_start + d.n
          group by d.n
        ) days
      )
    ),
    'workout_minutes', jsonb_build_object(
      'today', (select round(coalesce(sum(duration_min), 0))::int from public.workouts where user_id = target and (started_at at time zone zone_name)::date = today),
      'week', (select round(coalesce(sum(duration_min), 0))::int from public.workouts where user_id = target and (started_at at time zone zone_name)::date >= week_start and (started_at at time zone zone_name)::date < week_end),
      'month', (select round(coalesce(sum(duration_min), 0))::int from public.workouts where user_id = target and (started_at at time zone zone_name)::date >= month_start and (started_at at time zone zone_name)::date < month_end),
      'year', (select round(coalesce(sum(duration_min), 0))::int from public.workouts where user_id = target and (started_at at time zone zone_name)::date >= year_start and (started_at at time zone zone_name)::date < year_end),
      'weekDays', (
        select coalesce(jsonb_agg(c order by n), '[0,0,0,0,0,0,0]'::jsonb)
        from (
          select d.n, round(coalesce(sum(w.duration_min), 0))::int as c
          from generate_series(0, 6) as d(n)
          left join public.workouts w
            on w.user_id = target and (w.started_at at time zone zone_name)::date = week_start + d.n
          group by d.n
        ) days
      )
    ),
    'workouts', jsonb_build_object(
      'today', (select count(*) from public.workouts where user_id = target and (started_at at time zone zone_name)::date = today),
      'week', (select count(*) from public.workouts where user_id = target and (started_at at time zone zone_name)::date >= week_start and (started_at at time zone zone_name)::date < week_end),
      'month', (select count(*) from public.workouts where user_id = target and (started_at at time zone zone_name)::date >= month_start and (started_at at time zone zone_name)::date < month_end),
      'year', (select count(*) from public.workouts where user_id = target and (started_at at time zone zone_name)::date >= year_start and (started_at at time zone zone_name)::date < year_end),
      'weekDays', (
        select coalesce(jsonb_agg(c order by n), '[0,0,0,0,0,0,0]'::jsonb)
        from (
          select d.n, count(w.id)::int as c
          from generate_series(0, 6) as d(n)
          left join public.workouts w
            on w.user_id = target and (w.started_at at time zone zone_name)::date = week_start + d.n
          group by d.n
        ) days
      )
    ),
    'books', jsonb_build_object(
      'today', (select count(*) from public.books where user_id = target and status = 'finished' and finished_at = today),
      'week', (select count(*) from public.books where user_id = target and status = 'finished' and finished_at >= week_start and finished_at < week_end),
      'month', (select count(*) from public.books where user_id = target and status = 'finished' and finished_at >= month_start and finished_at < month_end),
      'year', (select count(*) from public.books where user_id = target and status = 'finished' and finished_at >= year_start and finished_at < year_end),
      'weekDays', (
        select coalesce(jsonb_agg(c order by n), '[0,0,0,0,0,0,0]'::jsonb)
        from (
          select d.n, count(b.id)::int as c
          from generate_series(0, 6) as d(n)
          left join public.books b
            on b.user_id = target and b.status = 'finished' and b.finished_at = week_start + d.n
          group by d.n
        ) days
      )
    ),
    'steps', jsonb_build_object(
      'today', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day = today),
      'week', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day >= week_start and day < week_end),
      'month', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day >= month_start and day < month_end),
      'year', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day >= year_start and day < year_end),
      'weekDays', (
        select coalesce(jsonb_agg(c order by n), '[0,0,0,0,0,0,0]'::jsonb)
        from (
          select d.n, coalesce(sum(s.steps), 0)::int as c
          from generate_series(0, 6) as d(n)
          left join public.daily_steps s
            on s.user_id = target and s.day = week_start + d.n
          group by d.n
        ) days
      )
    ),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'metric', metric,
        'weekly_target', weekly_target,
        'monthly_target', monthly_target,
        'yearly_target', yearly_target
      ))
      from public.goals
      where user_id = target
        and metric in ('tasks', 'workout_minutes', 'workouts', 'books', 'steps')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.household_summary(uuid, date, text) from public;
grant execute on function public.household_summary(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';

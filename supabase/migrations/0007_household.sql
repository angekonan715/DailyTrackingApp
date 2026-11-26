-- Family accounts. Each person keeps their own tasks, workouts, and books.
-- A person can let the rest of the family see their summary.
-- Paste this whole script into the Supabase SQL editor and run it.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  email text not null,
  share_summary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create unique index if not exists household_members_user on public.household_members (user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy if exists "member_select" on public.households;
create policy "member_select" on public.households for select
  using (
    exists (
      select 1 from public.household_members me
      where me.household_id = households.id and me.user_id = auth.uid()
    )
  );

drop policy if exists "create_own" on public.households;
create policy "create_own" on public.households for insert
  with check (created_by = auth.uid());

drop policy if exists "member_select" on public.household_members;
create policy "member_select" on public.household_members for select
  using (
    exists (
      select 1 from public.household_members me
      where me.household_id = household_members.household_id and me.user_id = auth.uid()
    )
  );

drop policy if exists "join_own_household" on public.household_members;
create policy "join_own_household" on public.household_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.households house
      where house.id = household_id and house.created_by = auth.uid()
    )
    and not exists (
      select 1 from public.household_members existing
      where existing.user_id = auth.uid()
    )
  );

drop policy if exists "own_update" on public.household_members;
create policy "own_update" on public.household_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.lock_member_identity()
returns trigger
language plpgsql
as $$
begin
  if new.user_id <> old.user_id or new.household_id <> old.household_id or new.email <> old.email then
    raise exception 'cannot change identity';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_member_identity on public.household_members;
create trigger lock_member_identity
  before update on public.household_members
  for each row execute function public.lock_member_identity();

grant select, insert, update, delete on public.households to authenticated;
grant select, insert, update, delete on public.household_members to authenticated;

create or replace function public.add_family_member(member_email text, member_name text, member_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  house uuid;
  found uuid;
  their_house uuid;
  their_count integer;
  clean_name text;
  clean_email text;
  my_email text;
begin
  if me is null then
    raise exception 'Sign in again.';
  end if;

  clean_email := lower(trim(coalesce(member_email, '')));
  clean_name := trim(coalesce(member_name, ''));
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a real email address.';
  end if;
  if clean_name = '' then
    clean_name := split_part(clean_email, '@', 1);
  end if;
  if length(clean_name) > 40 then
    clean_name := left(clean_name, 40);
  end if;
  if member_password is null or length(member_password) < 6 then
    raise exception 'Use at least 6 characters for their password.';
  end if;
  if length(member_password) > 72 then
    raise exception 'Use 72 characters or fewer for their password.';
  end if;

  select id into found from auth.users where lower(email) = clean_email limit 1;
  if found = me then
    raise exception 'That is your own email.';
  end if;

  if found is null then
    found := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000', found, 'authenticated', 'authenticated', clean_email,
      extensions.crypt(member_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', clean_name), now(), now(),
      '', '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), found, found::text,
      jsonb_build_object('sub', found::text, 'email', clean_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    update auth.users
      set encrypted_password = extensions.crypt(member_password, extensions.gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = found;
  end if;

  select household_id into house from public.household_members where user_id = me;
  if house is null then
    my_email := coalesce(auth.jwt() ->> 'email', '');
    insert into public.households (created_by) values (me) returning id into house;
    insert into public.household_members (household_id, user_id, display_name, email)
    values (house, me, split_part(my_email, '@', 1), my_email);
  end if;

  select household_id into their_house from public.household_members where user_id = found;
  if their_house = house then
    update public.household_members
      set display_name = clean_name
      where user_id = found;
    return jsonb_build_object('user_id', found, 'display_name', clean_name, 'email', clean_email, 'share_summary', false);
  end if;

  if (select count(*) from public.household_members where household_id = house) >= 8 then
    raise exception 'This family already has 8 people.';
  end if;

  if their_house is not null then
    select count(*) into their_count from public.household_members where household_id = their_house;
    if their_count > 1 then
      raise exception 'They already share with another family.';
    end if;
    delete from public.household_members where user_id = found;
    delete from public.households where id = their_house;
  end if;

  insert into public.household_members (household_id, user_id, display_name, email)
  values (house, found, clean_name, clean_email);

  return jsonb_build_object('user_id', found, 'display_name', clean_name, 'email', clean_email, 'share_summary', false);
end;
$$;

revoke all on function public.add_family_member(text, text, text) from public;
grant execute on function public.add_family_member(text, text, text) to authenticated;

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

  return jsonb_build_object(
    'tasks', jsonb_build_object(
      'today', (select count(*) from public.tasks where user_id = target and done and task_date = today),
      'week', (select count(*) from public.tasks where user_id = target and done and task_date >= week_start and task_date < week_end),
      'month', (select count(*) from public.tasks where user_id = target and done and task_date >= month_start and task_date < month_end),
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
    'pages', jsonb_build_object(
      'today', (select coalesce(sum(pages_read), 0)::int from public.reading_sessions where user_id = target and day = today),
      'week', (select coalesce(sum(pages_read), 0)::int from public.reading_sessions where user_id = target and day >= week_start and day < week_end),
      'month', (select coalesce(sum(pages_read), 0)::int from public.reading_sessions where user_id = target and day >= month_start and day < month_end),
      'weekDays', (
        select coalesce(jsonb_agg(c order by n), '[0,0,0,0,0,0,0]'::jsonb)
        from (
          select d.n, coalesce(sum(r.pages_read), 0)::int as c
          from generate_series(0, 6) as d(n)
          left join public.reading_sessions r
            on r.user_id = target and r.day = week_start + d.n
          group by d.n
        ) days
      )
    ),
    'steps', jsonb_build_object(
      'today', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day = today),
      'week', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day >= week_start and day < week_end),
      'month', (select coalesce(sum(steps), 0)::int from public.daily_steps where user_id = target and day >= month_start and day < month_end),
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
        'monthly_target', monthly_target
      ))
      from public.goals
      where user_id = target
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.household_summary(uuid, date, text) from public;
grant execute on function public.household_summary(uuid, date, text) to authenticated;

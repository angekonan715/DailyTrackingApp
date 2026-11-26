-- One OpenAI key for the family, a shared $5 cap, daily quotes, and coach chat.
-- Paste this whole script into the Supabase SQL editor and run it.

create table if not exists public.weekly_insights (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  week_start  date not null,
  tips        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);

create table if not exists public.ai_usage (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  month       text not null,
  cost_cents  numeric not null default 0 check (cost_cents >= 0),
  primary key (user_id, month)
);

alter table public.weekly_insights enable row level security;
alter table public.ai_usage enable row level security;
drop policy if exists "owner_all" on public.weekly_insights;
create policy "owner_all" on public.weekly_insights for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "owner_all" on public.ai_usage;
create policy "owner_all" on public.ai_usage for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.weekly_insights to authenticated;
grant select, insert, update, delete on public.ai_usage to authenticated;

alter table public.households
  add column if not exists openai_api_key text;

revoke select (openai_api_key) on public.households from authenticated, anon;
revoke update (openai_api_key) on public.households from authenticated, anon;

create table if not exists public.daily_quotes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  quote text not null check (char_length(quote) between 1 and 220),
  author text not null default 'Daily Hub' check (char_length(author) between 1 and 40),
  primary key (user_id, day)
);

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_user_created
  on public.coach_messages (user_id, created_at desc);

alter table public.daily_quotes enable row level security;
alter table public.coach_messages enable row level security;

drop policy if exists "owner_all" on public.daily_quotes;
create policy "owner_all" on public.daily_quotes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on public.coach_messages;
create policy "owner_all" on public.coach_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.daily_quotes to authenticated;
grant select, insert, update, delete on public.coach_messages to authenticated;

create or replace function public.household_ai_cents(target_month text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(u.cost_cents), 0)
  from public.ai_usage u
  where u.month = target_month
    and u.user_id in (
      select m.user_id
      from public.household_members m
      where m.household_id = (
        select household_id from public.household_members where user_id = auth.uid()
      )
      union
      select auth.uid()
    );
$$;

revoke all on function public.household_ai_cents(text) from public;
grant execute on function public.household_ai_cents(text) to authenticated;

create or replace function public.family_ai_status()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  house uuid;
  owner uuid;
  house_key text;
  own_key text;
begin
  select m.household_id, h.created_by, h.openai_api_key
    into house, owner, house_key
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.user_id = auth.uid();

  select s.openai_api_key into own_key
  from public.user_settings s
  where s.user_id = auth.uid();

  return json_build_object(
    'configured', coalesce(btrim(house_key), btrim(own_key), '') <> '',
    'can_manage', house is null or owner = auth.uid()
  );
end;
$$;

revoke all on function public.family_ai_status() from public;
grant execute on function public.family_ai_status() to authenticated;

create or replace function public.save_family_ai_key(new_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  house uuid;
  owner uuid;
  clean text;
begin
  clean := btrim(coalesce(new_key, ''));
  if clean <> '' and left(clean, 3) <> 'sk-' then
    raise exception 'An OpenAI key starts with sk-.';
  end if;
  if length(clean) > 300 then
    raise exception 'That key is too long.';
  end if;

  select m.household_id, h.created_by into house, owner
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.user_id = auth.uid();

  if house is null then
    insert into public.households (created_by) values (auth.uid()) returning id into house;
    insert into public.household_members (household_id, user_id, display_name, email)
    values (
      house,
      auth.uid(),
      coalesce(nullif(split_part(coalesce(auth.jwt()->>'email', ''), '@', 1), ''), 'Me'),
      coalesce(auth.jwt()->>'email', '')
    );
    owner := auth.uid();
  end if;

  if owner <> auth.uid() then
    raise exception 'Only the person who started the family can save the key.';
  end if;

  update public.households
  set openai_api_key = nullif(clean, '')
  where id = house;
end;
$$;

revoke all on function public.save_family_ai_key(text) from public;
grant execute on function public.save_family_ai_key(text) to authenticated;

create or replace function public.family_openai_key_for(member uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(btrim(h.openai_api_key), '')
      from public.household_members m
      join public.households h on h.id = m.household_id
      where m.user_id = member
      limit 1
    ),
    (
      select nullif(btrim(s.openai_api_key), '')
      from public.user_settings s
      where s.user_id = member
    )
  );
$$;

revoke all on function public.family_openai_key_for(uuid) from public, anon, authenticated;
grant execute on function public.family_openai_key_for(uuid) to service_role;

notify pgrst, 'reload schema';

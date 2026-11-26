-- Weekly coach cache and a per-month spend counter. Run this in the Supabase SQL editor.

create table public.weekly_insights (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  week_start  date not null,
  tips        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);

create table public.ai_usage (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  month       text not null,
  cost_cents  numeric not null default 0 check (cost_cents >= 0),
  primary key (user_id, month)
);

do $$
declare t text;
begin
  foreach t in array array['weekly_insights','ai_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner_all" on public.%I for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

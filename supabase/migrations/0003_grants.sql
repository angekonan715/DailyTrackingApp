-- Let a signed-in user use their own tables. RLS still limits each person to their rows.
-- Newer Supabase projects do not grant this automatically.

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.workouts to authenticated;
grant select, insert, update, delete on public.daily_steps to authenticated;
grant select, insert, update, delete on public.books to authenticated;
grant select, insert, update, delete on public.reading_sessions to authenticated;

do $$
begin
  if to_regclass('public.weekly_insights') is not null then
    execute 'grant select, insert, update, delete on public.weekly_insights to authenticated';
  end if;
  if to_regclass('public.ai_usage') is not null then
    execute 'grant select, insert, update, delete on public.ai_usage to authenticated';
  end if;
end $$;

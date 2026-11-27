-- A book note can live in a folder and still belong to that book.
-- Paste this whole script into the Supabase SQL editor and run it.

alter table public.notes drop constraint if exists notes_one_home;

notify pgrst, 'reload schema';

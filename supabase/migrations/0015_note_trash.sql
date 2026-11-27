-- Soft delete for notes and folders. Paste this whole script into the Supabase SQL editor and run it.
-- Deleted items stay for 30 days. The app then removes them for good.

alter table public.notes add column if not exists deleted_at timestamptz;
alter table public.note_folders add column if not exists deleted_at timestamptz;

create index if not exists notes_user_deleted on public.notes (user_id, deleted_at);
create index if not exists note_folders_user_deleted on public.note_folders (user_id, deleted_at);

notify pgrst, 'reload schema';

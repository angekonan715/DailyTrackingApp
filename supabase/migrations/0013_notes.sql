-- Notes, folders, and book notes. Each person only sees their own.
-- Paste this whole script into the Supabase SQL editor and run it.

create table if not exists public.note_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references public.note_folders (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_folders_name_len check (char_length(btrim(name)) between 1 and 80)
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id uuid references public.note_folders (id) on delete cascade,
  book_id uuid references public.books (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_title_len check (char_length(title) <= 200),
  constraint notes_body_len check (char_length(body) <= 40000),
  constraint notes_one_home check (book_id is null or folder_id is null)
);

create index if not exists note_folders_user_parent on public.note_folders (user_id, parent_id);
create index if not exists notes_user_updated on public.notes (user_id, updated_at desc);
create index if not exists notes_user_book on public.notes (user_id, book_id);

alter table public.note_folders enable row level security;
alter table public.notes enable row level security;

drop policy if exists "owner_all" on public.note_folders;
create policy "owner_all" on public.note_folders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on public.notes;
create policy "owner_all" on public.notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.note_folders to authenticated;
grant select, insert, update, delete on public.notes to authenticated;

notify pgrst, 'reload schema';

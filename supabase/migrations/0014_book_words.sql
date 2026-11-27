-- Words saved while reading a book. Each person only sees their own.
-- Paste this whole script into the Supabase SQL editor and run it.

create table if not exists public.book_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  word text not null,
  definition text not null default '',
  example text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_words_word_len check (char_length(btrim(word)) between 1 and 80),
  constraint book_words_definition_len check (char_length(definition) <= 400),
  constraint book_words_example_len check (char_length(example) <= 280)
);

create unique index if not exists book_words_user_book_word
  on public.book_words (user_id, book_id, lower(btrim(word)));
create index if not exists book_words_user_updated on public.book_words (user_id, updated_at desc);

alter table public.book_words enable row level security;

drop policy if exists "owner_all" on public.book_words;
create policy "owner_all" on public.book_words for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.book_words to authenticated;

notify pgrst, 'reload schema';

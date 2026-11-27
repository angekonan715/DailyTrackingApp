-- How to say a saved word, in simple syllables.
-- Paste this whole script into the Supabase SQL editor and run it.

alter table public.book_words add column if not exists pronunciation text not null default '';

alter table public.book_words drop constraint if exists book_words_pronunciation_len;
alter table public.book_words add constraint book_words_pronunciation_len check (char_length(pronunciation) <= 160);

notify pgrst, 'reload schema';

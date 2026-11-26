-- Photo storage for book covers. Run this in the Supabase SQL editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-covers', 'book-covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "book covers select own" on storage.objects;
drop policy if exists "book covers insert own" on storage.objects;
drop policy if exists "book covers update own" on storage.objects;
drop policy if exists "book covers delete own" on storage.objects;

create policy "book covers select own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "book covers insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "book covers update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "book covers delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

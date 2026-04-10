insert into storage.buckets (id, name, public)
values ('devlog-images', 'devlog-images', true)
on conflict (id) do nothing;

drop policy if exists "Public read devlog images" on storage.objects;
drop policy if exists "Users read own devlog images" on storage.objects;
drop policy if exists "Users upload own devlog images" on storage.objects;
drop policy if exists "Users update own devlog images" on storage.objects;
drop policy if exists "Users delete own devlog images" on storage.objects;

create policy "Public read devlog images"
on storage.objects
for select
to anon
using (bucket_id = 'devlog-images');

create policy "Users read own devlog images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'devlog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users upload own devlog images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'devlog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users update own devlog images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'devlog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users delete own devlog images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'devlog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

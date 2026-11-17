-- Ejecutar después de profiles.sql. Conserva los perfiles existentes.
begin;
alter table public.profiles
  add column if not exists apellido text not null default '',
  add column if not exists usuario text,
  add column if not exists ciudad text not null default '',
  add column if not exists foto_path text;
create unique index if not exists profiles_usuario_unique on public.profiles (lower(usuario));
alter table public.profiles drop constraint if exists profiles_details_valid;
alter table public.profiles add constraint profiles_details_valid check (
  length(apellido) <= 80 and length(ciudad) <= 100
  and (usuario is null or usuario ~ '^[a-z0-9_]{3,24}$')
  and (foto_path is null or (
    split_part(foto_path, '/', 1) = firebase_uid
    and foto_path ~ '^[^/]+/[a-f0-9-]{36}\.(jpg|png|webp)$'
  ))
);
grant select (apellido, usuario, ciudad, foto_path),
  insert (apellido, usuario, ciudad, foto_path),
  update (apellido, usuario, ciudad, foto_path) on public.profiles to authenticated;
grant select on public.profiles to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- El UID de Firebase es texto. No usar auth.uid(), que espera un UUID.
drop policy if exists profile_photos_guard on storage.objects;
create policy profile_photos_guard on storage.objects as restrictive for all to public
using (bucket_id <> 'profile-photos' or (
  (select auth.jwt()->>'role') = 'authenticated'
  and (select auth.jwt()->>'iss') = 'https://securetoken.google.com/chat-dual-f31e5'
  and (select auth.jwt()->>'aud') = 'chat-dual-f31e5'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
))
with check (bucket_id <> 'profile-photos' or (
  (select auth.jwt()->>'role') = 'authenticated'
  and (select auth.jwt()->>'iss') = 'https://securetoken.google.com/chat-dual-f31e5'
  and (select auth.jwt()->>'aud') = 'chat-dual-f31e5'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
));
drop policy if exists profile_photos_owner on storage.objects;
create policy profile_photos_owner on storage.objects for all to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'))
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));
commit;

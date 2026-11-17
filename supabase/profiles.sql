-- Ejecutar en SQL Editor del proyecto lcmrvlnxpnzgqgiwzxpv.
-- Revisar primero el esquema existente con las consultas de docs/firebase-supabase.md.
-- Las políticas comparan el UID de Firebase como texto.
begin;

create table if not exists public.profiles (
  firebase_uid text constraint profiles_firebase_uid_unique primary key,
  nombre text not null check (length(btrim(nombre)) > 0)
);

-- Si hay duplicados o un esquema incompatible, la transacción falla conservando los datos.
create unique index if not exists profiles_firebase_uid_unique
  on public.profiles (firebase_uid);

alter table public.profiles enable row level security;

grant usage on schema public to authenticated;
-- El upsert incluye firebase_uid en la actualización. RLS obliga a conservar el UID propio.
grant select (firebase_uid, nombre), insert (firebase_uid, nombre), update (firebase_uid, nombre)
  on public.profiles to authenticated;

-- Esta política también limita otras políticas permisivas que ya puedan existir.
drop policy if exists profiles_firebase_owner_guard on public.profiles;
create policy profiles_firebase_owner_guard on public.profiles
  as restrictive for all to public
  using (
    (select auth.jwt()->>'role') = 'authenticated'
    and (select auth.jwt()->>'iss') = 'https://securetoken.google.com/chat-dual-f31e5'
    and (select auth.jwt()->>'aud') = 'chat-dual-f31e5'
    and firebase_uid = (select auth.jwt()->>'sub')
  )
  with check (
    (select auth.jwt()->>'role') = 'authenticated'
    and (select auth.jwt()->>'iss') = 'https://securetoken.google.com/chat-dual-f31e5'
    and (select auth.jwt()->>'aud') = 'chat-dual-f31e5'
    and firebase_uid = (select auth.jwt()->>'sub')
  );

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (firebase_uid = (select auth.jwt()->>'sub'));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (firebase_uid = (select auth.jwt()->>'sub'));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (firebase_uid = (select auth.jwt()->>'sub'))
  with check (firebase_uid = (select auth.jwt()->>'sub'));

commit;

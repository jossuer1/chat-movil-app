begin;
create table if not exists public.chat_rooms (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 80),
  owner_uid text not null,
  revision bigint not null,
  created_at timestamptz not null default now()
);
create table if not exists public.chat_participants (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  firebase_uid text not null,
  primary key (room_id, firebase_uid)
);
create table if not exists public.chat_locations (
  id uuid not null,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  firebase_uid text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  primary key (id, room_id, firebase_uid)
);
alter table public.chat_rooms enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_locations enable row level security;
-- Las funciones verifican la sesión Firebase y los permisos de la sala.
revoke all on public.chat_rooms, public.chat_participants, public.chat_locations from anon, authenticated;
grant all on public.chat_rooms, public.chat_participants, public.chat_locations to service_role;
grant select on public.profiles to service_role;

create or replace function public.chat_sync_room(
  p_id uuid, p_title text, p_owner text, p_members text[], p_revision bigint, p_created_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare updated_id uuid;
begin
  insert into public.chat_rooms (id,title,owner_uid,revision,created_at)
  values (p_id,p_title,p_owner,p_revision,p_created_at)
  on conflict (id) do update set title=excluded.title, owner_uid=excluded.owner_uid, revision=excluded.revision
  where public.chat_rooms.revision < excluded.revision
  returning id into updated_id;
  if updated_id is null then return; end if;
  delete from public.chat_participants where room_id = p_id;
  insert into public.chat_participants (room_id,firebase_uid)
  select p_id, unnest(p_members);
end;
$$;
revoke all on function public.chat_sync_room(uuid,text,text,text[],bigint,timestamptz) from public, anon, authenticated;
grant execute on function public.chat_sync_room(uuid,text,text,text[],bigint,timestamptz) to service_role;

insert into storage.buckets (id,name,public,file_size_limit)
values ('chat-files','chat-files',false,10485760)
on conflict (id) do update set public=false, file_size_limit=10485760;
drop policy if exists chat_files_backend_only on storage.objects;
create policy chat_files_backend_only on storage.objects as restrictive for all to public
using (bucket_id <> 'chat-files') with check (bucket_id <> 'chat-files');
commit;

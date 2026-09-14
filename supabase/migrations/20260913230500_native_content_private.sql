-- Private NativePack metadata + private WebP storage, guarded by allowlist.

create table if not exists public.native_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('member', 'editor')),
  created_at timestamptz not null default now()
);

create table if not exists public.native_packs (
  id text primary key,
  provider_id text not null,
  year integer not null check (year between 1900 and 2100),
  edition_id text,
  phase text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  pack jsonb not null,
  published_by uuid not null references auth.users (id),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists native_packs_lookup_idx
  on public.native_packs (provider_id, year, edition_id, phase);

alter table public.native_access enable row level security;
alter table public.native_access force row level security;
alter table public.native_packs enable row level security;
alter table public.native_packs force row level security;

drop policy if exists "native_access: usuário vê a própria permissão" on public.native_access;
create policy "native_access: usuário vê a própria permissão"
  on public.native_access for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.native_access from anon, authenticated;
grant select on public.native_access to authenticated;

drop policy if exists "native_packs: membros leem" on public.native_packs;
drop policy if exists "native_packs: editores inserem" on public.native_packs;
drop policy if exists "native_packs: editores atualizam" on public.native_packs;
drop policy if exists "native_packs: editores apagam" on public.native_packs;

create policy "native_packs: membros leem"
  on public.native_packs for select
  to authenticated
  using (
    exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid())
    )
  );

create policy "native_packs: editores inserem"
  on public.native_packs for insert
  to authenticated
  with check (
    published_by = (select auth.uid())
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  );

create policy "native_packs: editores atualizam"
  on public.native_packs for update
  to authenticated
  using (
    exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  )
  with check (
    published_by = (select auth.uid())
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  );

create policy "native_packs: editores apagam"
  on public.native_packs for delete
  to authenticated
  using (
    exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  );

revoke all on public.native_packs from anon;
grant select, insert, update, delete on public.native_packs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('native-content', 'native-content', false, 10485760, array['image/webp']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "native-content: membros leem" on storage.objects;
drop policy if exists "native-content: editores inserem" on storage.objects;
drop policy if exists "native-content: editores atualizam" on storage.objects;
drop policy if exists "native-content: editores apagam" on storage.objects;

create policy "native-content: membros leem"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'native-content'
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid())
    )
  );

create policy "native-content: editores inserem"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'native-content'
    and storage.extension(name) = 'webp'
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  );

create policy "native-content: editores atualizam"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'native-content'
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  )
  with check (
    bucket_id = 'native-content'
    and storage.extension(name) = 'webp'
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  );

create policy "native-content: editores apagam"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'native-content'
    and exists (
      select 1 from public.native_access access
      where access.user_id = (select auth.uid()) and access.role = 'editor'
    )
  );

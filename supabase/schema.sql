-- ============================================================
-- Studium Labs — estado do usuário + conteúdo nativo privado
--
-- Este arquivo é a fonte da verdade do schema e das políticas.
-- A chave publishable do Supabase é pública por design (vai no
-- bundle do navegador), então TODA a proteção dos dados está no RLS.
--
-- Aplicar em: Supabase → SQL Editor → rodar este arquivo inteiro.
-- É idempotente: pode rodar de novo sem quebrar nada.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- Estado do usuário
-- ============================================================
create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  client_id text,
  updated_at timestamptz not null default now()
);

comment on table public.user_state is
  'Um registro por usuário com o snapshot do estado local (tentativas, SRS, notas).';
comment on column public.user_state.revision is
  'Contador monotônico usado para detectar conflito entre dispositivos.';

alter table public.user_state enable row level security;
alter table public.user_state force row level security;

drop policy if exists "user_state: dono lê" on public.user_state;
drop policy if exists "user_state: dono insere" on public.user_state;
drop policy if exists "user_state: dono atualiza" on public.user_state;
drop policy if exists "user_state: dono apaga" on public.user_state;

create policy "user_state: dono lê"
  on public.user_state for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_state: dono insere"
  on public.user_state for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_state: dono atualiza"
  on public.user_state for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_state: dono apaga"
  on public.user_state for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.user_state from anon;
grant select, insert, update, delete on public.user_state to authenticated;

-- ---------- RPC de sincronização ----------
create or replace function public.sync_user_state(
  p_data jsonb,
  p_base_revision bigint,
  p_client_id text,
  p_client_updated_at timestamptz
)
returns table (data jsonb, revision bigint, updated_at timestamptz, conflict boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.user_state%rowtype;
begin
  if v_uid is null then
    raise exception 'Sem sessão autenticada.' using errcode = '28000';
  end if;

  select * into v_current from public.user_state where user_id = v_uid;

  if not found then
    insert into public.user_state (user_id, data, revision, client_id, updated_at)
    values (v_uid, p_data, 1, p_client_id, coalesce(p_client_updated_at, now()))
    returning public.user_state.data, public.user_state.revision, public.user_state.updated_at
      into data, revision, updated_at;
    conflict := false;
    return next;
    return;
  end if;

  if v_current.revision <> p_base_revision then
    data := v_current.data;
    revision := v_current.revision;
    updated_at := v_current.updated_at;
    conflict := true;
    return next;
    return;
  end if;

  update public.user_state
     set data = p_data,
         revision = v_current.revision + 1,
         client_id = p_client_id,
         updated_at = coalesce(p_client_updated_at, now())
   where user_id = v_uid
  returning public.user_state.data, public.user_state.revision, public.user_state.updated_at
    into data, revision, updated_at;

  conflict := false;
  return next;
end;
$$;

revoke all on function public.sync_user_state(jsonb, bigint, text, timestamptz) from public, anon;
grant execute on function public.sync_user_state(jsonb, bigint, text, timestamptz) to authenticated;

-- ============================================================
-- Conteúdo nativo privado
-- ============================================================
-- A aplicação é privada para um grupo pequeno. A allowlist evita que apenas
-- criar uma conta seja suficiente para ler/copiar o corpus nativo.
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

-- A allowlist é administrada pelo SQL/dashboard; clientes não podem se promover.
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

-- Bucket privado. Objetos são manipulados pela Storage API; o insert abaixo
-- apenas garante de forma idempotente que o bucket exista com as restrições.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'native-content',
  'native-content',
  false,
  10485760,
  array['image/webp']::text[]
)
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

-- RLS/index + cloud-sync reconciliation for native_content_private.
create index if not exists native_packs_published_by_idx
  on public.native_packs (published_by);

-- The original cloud-sync migration used different policy names and an
-- integer revision. Normalize the live schema before adding the canonical
-- policies/RPC so rerunning schema.sql never leaves duplicate permissive
-- policies or overloaded PostgREST RPC signatures.
alter table public.user_state
  alter column revision type bigint using revision::bigint;

alter table public.user_state
  add column if not exists client_updated_at timestamptz not null default now();

alter table public.user_state enable row level security;
alter table public.user_state force row level security;

drop policy if exists "Users can read own state" on public.user_state;
drop policy if exists "Users can insert own state" on public.user_state;
drop policy if exists "Users can update own state" on public.user_state;
drop policy if exists user_state_select_own on public.user_state;
drop policy if exists user_state_insert_own on public.user_state;
drop policy if exists user_state_update_own on public.user_state;
drop policy if exists user_state_delete_own on public.user_state;
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

-- Remove the legacy integer RPC before creating the canonical bigint version;
-- otherwise PostgREST can see ambiguous overloads for JSON numeric arguments.
drop function if exists public.sync_user_state(jsonb, integer, text, timestamptz);
drop function if exists public.sync_user_state(jsonb, bigint, text, timestamptz);

create function public.sync_user_state(
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

  select *
    into v_current
    from public.user_state
   where user_id = v_uid
   for update;

  if not found then
    insert into public.user_state (
      user_id, data, revision, client_id, client_updated_at, updated_at
    ) values (
      v_uid,
      coalesce(p_data, '{}'::jsonb),
      1,
      p_client_id,
      coalesce(p_client_updated_at, now()),
      now()
    )
    returning public.user_state.data, public.user_state.revision, public.user_state.updated_at
      into data, revision, updated_at;
    conflict := false;
    return next;
    return;
  end if;

  if v_current.revision <> coalesce(p_base_revision, 0) then
    data := v_current.data;
    revision := v_current.revision;
    updated_at := v_current.updated_at;
    conflict := true;
    return next;
    return;
  end if;

  update public.user_state
     set data = coalesce(p_data, '{}'::jsonb),
         revision = v_current.revision + 1,
         client_id = p_client_id,
         client_updated_at = coalesce(p_client_updated_at, now()),
         updated_at = now()
   where user_id = v_uid
  returning public.user_state.data, public.user_state.revision, public.user_state.updated_at
    into data, revision, updated_at;

  conflict := false;
  return next;
end;
$$;

revoke all on function public.sync_user_state(jsonb, bigint, text, timestamptz) from public, anon;
grant execute on function public.sync_user_state(jsonb, bigint, text, timestamptz) to authenticated;

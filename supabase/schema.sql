-- ============================================================
-- ENEM Lab — estado do usuário na nuvem
--
-- Este arquivo é a fonte da verdade do schema e das políticas.
-- A chave publishable do Supabase é pública por design (vai no
-- bundle do navegador), então TODA a proteção dos dados está no
-- RLS abaixo. Sem estas políticas, qualquer pessoa com a chave lê
-- e escreve o estado de todos os usuários.
--
-- Aplicar em: Supabase → SQL Editor → rodar este arquivo inteiro.
-- É idempotente: pode rodar de novo sem quebrar nada.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tabela ----------
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

-- ---------- RLS ----------
alter table public.user_state enable row level security;
-- Garante que nem o dono da tabela escape das políticas.
alter table public.user_state force row level security;

-- Recria as políticas do zero para o arquivo ser idempotente.
drop policy if exists "user_state: dono lê" on public.user_state;
drop policy if exists "user_state: dono insere" on public.user_state;
drop policy if exists "user_state: dono atualiza" on public.user_state;
drop policy if exists "user_state: dono apaga" on public.user_state;

create policy "user_state: dono lê"
  on public.user_state for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_state: dono insere"
  on public.user_state for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "user_state: dono atualiza"
  on public.user_state for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_state: dono apaga"
  on public.user_state for delete
  to authenticated
  using (auth.uid() = user_id);

-- Anônimo não tem nenhuma política: sem login, nada é visível.
revoke all on public.user_state from anon;
grant select, insert, update, delete on public.user_state to authenticated;

-- ---------- RPC de sincronização ----------
-- Resolve conflito por revisão: se o cliente enviar uma revisão
-- desatualizada, devolve o estado do servidor com conflict = true
-- em vez de sobrescrever o que outro dispositivo gravou.
create or replace function public.sync_user_state(
  p_data jsonb,
  p_base_revision bigint,
  p_client_id text,
  p_client_updated_at timestamptz
)
returns table (data jsonb, revision bigint, updated_at timestamptz, conflict boolean)
language plpgsql
security invoker            -- roda como o usuário: o RLS acima continua valendo
set search_path = public    -- evita sequestro de search_path
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.user_state%rowtype;
begin
  if v_uid is null then
    raise exception 'Sem sessão autenticada.' using errcode = '28000';
  end if;

  select * into v_current from public.user_state where user_id = v_uid;

  -- Primeira sincronização deste usuário.
  if not found then
    insert into public.user_state (user_id, data, revision, client_id, updated_at)
    values (v_uid, p_data, 1, p_client_id, coalesce(p_client_updated_at, now()))
    returning public.user_state.data, public.user_state.revision, public.user_state.updated_at
      into data, revision, updated_at;
    conflict := false;
    return next;
    return;
  end if;

  -- Outro dispositivo gravou depois da base que este cliente conhece.
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

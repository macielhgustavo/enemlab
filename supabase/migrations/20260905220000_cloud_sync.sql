create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  client_id text,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_state'
      and policyname = 'Users can read own state'
  ) then
    create policy "Users can read own state"
      on public.user_state for select
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_state'
      and policyname = 'Users can insert own state'
  ) then
    create policy "Users can insert own state"
      on public.user_state for insert
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_state'
      and policyname = 'Users can update own state'
  ) then
    create policy "Users can update own state"
      on public.user_state for update
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end;
$$;

create or replace function public.sync_user_state(
  p_data jsonb,
  p_base_revision integer,
  p_client_id text,
  p_client_updated_at timestamptz
)
returns table(data jsonb, revision integer, updated_at timestamptz, conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.user_state%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select us.* into current_row
  from public.user_state as us
  where us.user_id = auth.uid()
  for update;

  if not found then
    insert into public.user_state (user_id, data, revision, client_id, client_updated_at, updated_at)
    values (auth.uid(), coalesce(p_data, '{}'::jsonb), 1, p_client_id, coalesce(p_client_updated_at, now()), now());
    select us.data, us.revision, us.updated_at
      into data, revision, updated_at
    from public.user_state as us
    where us.user_id = auth.uid();
    conflict := false;
    return next;
    return;
  end if;

  if current_row.revision <> coalesce(p_base_revision, 0) then
    data := current_row.data;
    revision := current_row.revision;
    updated_at := current_row.updated_at;
    conflict := true;
    return next;
    return;
  end if;

  update public.user_state as us
  set data = coalesce(p_data, '{}'::jsonb),
      revision = current_row.revision + 1,
      client_id = p_client_id,
      client_updated_at = coalesce(p_client_updated_at, now()),
      updated_at = now()
  where us.user_id = auth.uid();

  select us.data, us.revision, us.updated_at
    into data, revision, updated_at
  from public.user_state as us
  where us.user_id = auth.uid();
  conflict := false;
  return next;
end;
$$;

revoke all on function public.sync_user_state(jsonb, integer, text, timestamptz) from public;
grant usage on schema public to authenticated;
grant execute on function public.sync_user_state(jsonb, integer, text, timestamptz) to authenticated;
grant select, insert, update on public.user_state to authenticated;

alter table public.native_packs
  alter column published_by drop not null;

alter table public.native_packs
  add column if not exists publication_source text not null default 'user',
  add column if not exists publication_repository text,
  add column if not exists publication_sha text,
  add column if not exists publication_run_id text;

alter table public.native_packs
  drop constraint if exists native_packs_publication_actor_check;

alter table public.native_packs
  add constraint native_packs_publication_actor_check check (
    (
      publication_source = 'user'
      and published_by is not null
      and publication_repository is null
      and publication_sha is null
      and publication_run_id is null
    )
    or
    (
      publication_source = 'github_actions'
      and published_by is null
      and publication_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      and publication_sha ~ '^[0-9a-f]{40}$'
      and publication_run_id ~ '^[0-9]+:[0-9]+$'
    )
  );

create table if not exists public.native_publication_runs (
  id text primary key,
  repository text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  workflow_ref text not null,
  run_id bigint not null check (run_id > 0),
  run_attempt integer not null check (run_attempt > 0),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  pack_id text not null,
  provider_id text not null,
  year integer not null check (year between 1900 and 2100),
  edition_id text,
  phase text not null,
  status text not null check (status in ('signed', 'published', 'failed', 'skipped')),
  asset_count integer not null default 0 check (asset_count >= 0),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists native_publication_runs_pack_idx
  on public.native_publication_runs (pack_id, created_at desc);

alter table public.native_publication_runs enable row level security;
alter table public.native_publication_runs force row level security;

revoke all on public.native_publication_runs from anon, authenticated;

comment on table public.native_publication_runs is
  'Audit log for NativePack publications performed by trusted GitHub Actions OIDC jobs.';

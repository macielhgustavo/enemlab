alter table public.native_packs
  add column if not exists publication_revision text;

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
      and publication_revision is null
    )
    or
    (
      publication_source = 'github_actions'
      and published_by is null
      and publication_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      and publication_sha ~ '^[0-9a-f]{40}$'
      and publication_run_id ~ '^[0-9]+:[0-9]+$'
      and publication_revision ~ '^native-fleet@[0-9]+$'
    )
  );

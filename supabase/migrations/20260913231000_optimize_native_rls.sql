-- RLS/index follow-up for native_content_private.
create index if not exists native_packs_published_by_idx
  on public.native_packs (published_by);

-- Normalize the pre-existing user_state policies to the current efficient
-- auth.uid() form recommended by Supabase advisors.
drop policy if exists user_state_select_own on public.user_state;
drop policy if exists user_state_insert_own on public.user_state;
drop policy if exists user_state_update_own on public.user_state;
drop policy if exists user_state_delete_own on public.user_state;

create policy user_state_select_own
  on public.user_state for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy user_state_insert_own
  on public.user_state for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy user_state_update_own
  on public.user_state for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy user_state_delete_own
  on public.user_state for delete
  to authenticated
  using ((select auth.uid()) = user_id);

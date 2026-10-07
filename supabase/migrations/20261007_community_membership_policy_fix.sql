-- Community insert policies previously queried community_memberships directly.
-- Authenticated clients intentionally lack table-wide SELECT on memberships,
-- so those checks failed with 403 permission denied before the RLS check ran.
-- This SECURITY DEFINER helper reveals only whether the current user is a
-- member of the supplied group; it never accepts or exposes another user ID.
create or replace function public.community_is_current_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select auth.uid() is not null
     and exists (
       select 1
       from public.community_memberships m
       where m.group_id = p_group_id
         and m.user_id = auth.uid()
     );
$function$;

revoke all on function public.community_is_current_member(uuid)
  from public, anon, authenticated;
grant execute on function public.community_is_current_member(uuid)
  to authenticated;

drop policy if exists community_posts_insert_member
  on public.community_posts;
create policy community_posts_insert_member
  on public.community_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and not is_official
    and public.community_is_current_member(group_id)
  );

drop policy if exists community_comments_insert_member
  on public.community_comments;
create policy community_comments_insert_member
  on public.community_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.status = 'approved'
        and public.community_is_current_member(p.group_id)
    )
  );

drop policy if exists community_reactions_insert_member
  on public.community_post_reactions;
create policy community_reactions_insert_member
  on public.community_post_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.status = 'approved'
        and public.community_is_current_member(p.group_id)
    )
  );

-- TipChat live messages: member posts and comments publish immediately.
-- Admins moderate by deleting unrelated or inappropriate content, not by approving or hiding it.
-- Safe to re-run.

-- Publish existing waiting content when this policy is enabled.
update public.community_posts
   set status = 'approved', reviewed_by = null, reviewed_at = null
 where status = 'pending';
update public.community_comments
   set status = 'approved', reviewed_by = null, reviewed_at = null
 where status = 'pending';

alter table public.community_posts alter column status set default 'approved';
alter table public.community_comments alter column status set default 'approved';

-- Member inserts must create live content. Membership and author ownership remain required.
drop policy if exists community_posts_insert_member on public.community_posts;
create policy community_posts_insert_member
  on public.community_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'approved'
    and not is_official
    and public.community_is_current_member(group_id)
  );

drop policy if exists community_comments_insert_member on public.community_comments;
create policy community_comments_insert_member
  on public.community_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'approved'
    and exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.status = 'approved'
        and public.community_is_current_member(p.group_id)
    )
  );

-- Remove the old approve/hide update surface. Admin moderation is delete-only.
revoke update (status) on public.community_posts from authenticated;
revoke update (status) on public.community_comments from authenticated;
drop policy if exists community_posts_admin_moderate on public.community_posts;
drop policy if exists community_comments_admin_moderate on public.community_comments;

authorize_admin_delete: do $$
begin
  if to_regclass('public.community_automod_settings') is not null then
    update public.community_automod_settings
       set mode = 'off', updated_at = now()
     where id = true;
  end if;
end $$;

create or replace function public.community_admin_delete(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_poster text;
  v_rows integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_kind = 'post' then
    delete from public.community_posts
     where id = p_id and not is_official
    returning poster_image_url into v_poster;
    get diagnostics v_rows = row_count;
  elsif p_kind = 'comment' then
    delete from public.community_comments where id = p_id;
    get diagnostics v_rows = row_count;
  else
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  if to_regclass('public.community_automated_flags') is not null then
    update public.community_automated_flags
       set status = 'reviewed', reviewed_at = now()
     where content_type = p_kind and content_id = p_id and status = 'open';
  end if;
  return jsonb_build_object('deleted', v_rows > 0, 'poster_image_url', v_poster);
end;
$$;
revoke all on function public.community_admin_delete(text, uuid) from public, anon;
grant execute on function public.community_admin_delete(text, uuid) to authenticated;

comment on function public.community_admin_delete(text, uuid) is
  'Admin-only TipChat deletion for unrelated or inappropriate content; approval is not required for publishing.';

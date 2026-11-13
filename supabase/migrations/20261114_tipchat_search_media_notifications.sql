-- TipChat search, marketplace galleries, and private moderation notifications.
-- Safe to re-run. Images are public listing media only; account IDs remain private.

alter table public.community_posts
  add column if not exists marketplace_image_urls text[] not null default '{}'::text[];

create or replace function public.community_marketplace_urls_ok(p_urls text[])
returns boolean
language plpgsql
immutable
as $$
declare v_url text;
begin
  if coalesce(array_length(p_urls, 1), 0) > 5 then return false; end if;
  foreach v_url in array coalesce(p_urls, '{}'::text[]) loop
    if v_url is null or length(v_url) > 1200 or v_url !~ '^https://[^/]+/tipchat-marketplace/' then return false; end if;
  end loop;
  return true;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.community_posts'::regclass
       and conname = 'community_posts_marketplace_image_urls_check'
  ) then
    alter table public.community_posts drop constraint community_posts_marketplace_image_urls_check;
  end if;
  alter table public.community_posts
    add constraint community_posts_marketplace_image_urls_check
    check (
      coalesce(array_length(marketplace_image_urls, 1), 0) between 0 and 5
      and public.community_marketplace_urls_ok(marketplace_image_urls)
    );
end $$;

grant select (marketplace_image_urls) on public.community_posts to anon, authenticated;
grant insert (marketplace_image_urls) on public.community_posts to authenticated;

create index if not exists community_posts_marketplace_search_idx
  on public.community_posts (group_id, post_type, status, created_at desc)
  where post_type = 'marketplace';

create table if not exists public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('post', 'comment')),
  content_id uuid not null,
  kind text not null check (kind in ('hidden', 'rejected', 'removed')),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.community_notifications enable row level security;
drop policy if exists community_notifications_read_own on public.community_notifications;
create policy community_notifications_read_own
  on public.community_notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists community_notifications_update_own on public.community_notifications;
create policy community_notifications_update_own
  on public.community_notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.community_notifications from anon, authenticated;
grant select, update (read_at) on public.community_notifications to authenticated;

create or replace function public.community_write_notification(
  p_user_id uuid, p_content_type text, p_content_id uuid, p_kind text,
  p_title text, p_body text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or p_content_id is null then return; end if;
  insert into public.community_notifications (user_id, content_type, content_id, kind, title, body)
  values (p_user_id, p_content_type, p_content_id, p_kind, left(p_title, 160), left(p_body, 600));
end;
$$;
revoke all on function public.community_write_notification(uuid, text, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.community_my_notifications()
returns table (
  id uuid, content_type text, content_id uuid, kind text,
  title text, body text, read_at timestamptz, created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select n.id, n.content_type, n.content_id, n.kind,
         n.title, n.body, n.read_at, n.created_at
    from public.community_notifications n
   where n.user_id = (select auth.uid())
   order by n.created_at desc
   limit 50;
$$;
revoke all on function public.community_my_notifications() from public, anon;
grant execute on function public.community_my_notifications() to authenticated;

create or replace function public.community_mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  update public.community_notifications
     set read_at = coalesce(read_at, now())
   where user_id = (select auth.uid())
     and id = any(coalesce(p_ids, '{}'::uuid[]));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.community_mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.community_mark_notifications_read(uuid[]) to authenticated;

create or replace function public.community_notify_on_content_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_kind text;
begin
  if tg_op = 'DELETE' then
    if old.author_id is not null and (select auth.uid()) is distinct from old.author_id then
      perform public.community_write_notification(old.author_id, case when tg_table_name = 'community_posts' then 'post' else 'comment' end, old.id, 'removed', 'Your TipChat content was removed', 'A moderator removed your TipChat content because it did not meet the community safety rules.');
    end if;
    return old;
  end if;
  if new.status = 'hidden' and old.status is distinct from new.status and new.author_id is not null then
    if tg_table_name = 'community_posts' then
      v_kind := case when new.is_official then 'hidden' else 'rejected' end;
    else
      v_kind := 'rejected';
    end if;
    perform public.community_write_notification(new.author_id, case when tg_table_name = 'community_posts' then 'post' else 'comment' end, new.id, v_kind, 'Your TipChat content needs attention', 'Your TipChat content was hidden by the safety system or moderation team. Review the community rules and try again with safer, more relevant details.');
  end if;
  return new;
end;
$$;
revoke all on function public.community_notify_on_content_change() from public, anon, authenticated;

drop trigger if exists community_posts_notify_owner on public.community_posts;
create trigger community_posts_notify_owner
  after update of status or delete on public.community_posts
  for each row execute function public.community_notify_on_content_change();

drop trigger if exists community_comments_notify_owner on public.community_comments;
create trigger community_comments_notify_owner
  after update of status or delete on public.community_comments
  for each row execute function public.community_notify_on_content_change();

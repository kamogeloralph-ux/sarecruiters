-- TipChat audit fixes.
--  1. Reaction counts: likes_count counts only real likes; one atomic reaction RPC.
--  2. Opt-in public identity (Talent Pool name/photo) instead of automatic exposure.
--  3. Authors can see their own submissions and delete their own content.
--  4. Moderators see automated risk flags; flags close when content is moderated.
--  5. Per-user rate limits on posts, comments and reports.
--  6. Poster URLs must point at our own R2 bucket.
--  7. Moderator-notification bookkeeping + supporting indexes.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Reactions
-- ---------------------------------------------------------------------------
create or replace function public.community_adjust_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.reaction_type = 'like' then
      update public.community_posts set likes_count = likes_count + 1 where id = new.post_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.reaction_type = 'like' then
      update public.community_posts set likes_count = greatest(0, likes_count - 1) where id = old.post_id;
    end if;
    return old;
  end if;
  -- UPDATE of reaction_type
  if old.reaction_type = 'like' and new.reaction_type <> 'like' then
    update public.community_posts set likes_count = greatest(0, likes_count - 1) where id = new.post_id;
  elsif old.reaction_type <> 'like' and new.reaction_type = 'like' then
    update public.community_posts set likes_count = likes_count + 1 where id = new.post_id;
  end if;
  return new;
end;
$$;
revoke all on function public.community_adjust_post_like_count() from public, anon, authenticated;

drop trigger if exists community_post_reactions_count_trigger on public.community_post_reactions;
create trigger community_post_reactions_count_trigger
  after insert or update of reaction_type or delete on public.community_post_reactions
  for each row execute function public.community_adjust_post_like_count();

-- Recompute so emoji reactions that were previously counted as likes are corrected.
update public.community_posts p
set likes_count = coalesce((
  select count(*) from public.community_post_reactions r
  where r.post_id = p.id and r.reaction_type = 'like'
), 0);

-- One atomic call: set, switch or clear (same type again) the caller's single reaction.
create or replace function public.community_set_reaction(p_post_id uuid, p_reaction text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid;
  v_current text;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if p_reaction is null or p_reaction not in ('like','join','good-luck','interview-win','ask-question','applause') then
    raise exception 'Invalid reaction' using errcode = '22023';
  end if;
  select group_id into v_group from public.community_posts where id = p_post_id and status = 'approved';
  if v_group is null then
    raise exception 'Post not available' using errcode = 'P0002';
  end if;
  if not public.community_is_current_member(v_group) then
    raise exception 'Join TipChat first' using errcode = '42501';
  end if;

  select reaction_type into v_current
  from public.community_post_reactions
  where post_id = p_post_id and user_id = v_uid
  for update;

  if v_current is null then
    insert into public.community_post_reactions (post_id, user_id, reaction_type)
    values (p_post_id, v_uid, p_reaction);
    return p_reaction;
  elsif v_current = p_reaction then
    delete from public.community_post_reactions where post_id = p_post_id and user_id = v_uid;
    return null;
  end if;
  update public.community_post_reactions
     set reaction_type = p_reaction
   where post_id = p_post_id and user_id = v_uid;
  return p_reaction;
end;
$$;
revoke all on function public.community_set_reaction(uuid, text) from public, anon;
grant execute on function public.community_set_reaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Opt-in public identity
-- ---------------------------------------------------------------------------
create table if not exists public.community_member_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  show_profile boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.community_member_settings enable row level security;
revoke all on public.community_member_settings from anon, authenticated;

-- Resolve what name/photo (if any) may be shown publicly for a user.
-- Anonymous unless the member opted in AND has an active Talent Pool profile.
create or replace function public.community_resolve_identity(p_user_id uuid, out o_label text, out o_photo text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_show boolean;
  v_name text;
  v_pic text;
begin
  o_label := 'Anonymous member';
  o_photo := null;
  if p_user_id is null then return; end if;

  select s.show_profile into v_show from public.community_member_settings s where s.user_id = p_user_id;
  if coalesce(v_show, false) is not true then return; end if;
  if to_regclass('public.pool_candidates') is null then return; end if;

  execute 'select nullif(btrim(c.full_name), ''''), c.photo_url
             from public.pool_candidates c
            where c.user_id = $1 and c.status = ''active''
              and nullif(btrim(c.full_name), '''') is not null
            order by c.created_at desc limit 1'
    into v_name, v_pic using p_user_id;

  if v_name is not null then
    o_label := left(v_name, 40);
    if v_pic like 'https://%' and length(v_pic) <= 1200 then o_photo := v_pic; end if;
  end if;
end;
$$;
revoke all on function public.community_resolve_identity(uuid) from public, anon, authenticated;

create or replace function public.community_refresh_candidate_identity(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_label text;
  v_photo text;
begin
  if p_user_id is null then return; end if;
  select r.o_label, r.o_photo into v_label, v_photo from public.community_resolve_identity(p_user_id) r;
  update public.community_posts
     set author_label = v_label, author_photo_url = v_photo
   where author_id = p_user_id and not is_official;
  update public.community_comments
     set author_label = v_label, author_photo_url = v_photo
   where author_id = p_user_id;
end;
$$;
revoke all on function public.community_refresh_candidate_identity(uuid) from public, anon, authenticated;

create or replace function public.community_stamp_candidate_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_label text;
  v_photo text;
begin
  if new.author_id is null then
    new.author_photo_url := null;
    return new;
  end if;
  select r.o_label, r.o_photo into v_label, v_photo from public.community_resolve_identity(new.author_id) r;
  new.author_label := v_label;
  new.author_photo_url := v_photo;
  return new;
end;
$$;
revoke all on function public.community_stamp_candidate_identity() from public, anon, authenticated;

-- Existing content was published under the old automatic rule without consent:
-- return it to anonymous unless the author has opted in.
update public.community_posts p
   set author_label = 'Anonymous member', author_photo_url = null
 where not p.is_official and p.author_id is not null
   and (p.author_label <> 'Anonymous member' or p.author_photo_url is not null)
   and not exists (select 1 from public.community_member_settings s where s.user_id = p.author_id and s.show_profile);
update public.community_comments c
   set author_label = 'Anonymous member', author_photo_url = null
 where (c.author_label <> 'Anonymous member' or c.author_photo_url is not null)
   and not exists (select 1 from public.community_member_settings s where s.user_id = c.author_id and s.show_profile);

create or replace function public.community_identity_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_show boolean;
  v_has boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('show_profile', false, 'has_profile', false);
  end if;
  select s.show_profile into v_show from public.community_member_settings s where s.user_id = v_uid;
  if to_regclass('public.pool_candidates') is not null then
    execute 'select exists (select 1 from public.pool_candidates c
                             where c.user_id = $1 and c.status = ''active''
                               and nullif(btrim(c.full_name), '''') is not null)'
      into v_has using v_uid;
  end if;
  return jsonb_build_object('show_profile', coalesce(v_show, false), 'has_profile', v_has);
end;
$$;
revoke all on function public.community_identity_state() from public, anon;
grant execute on function public.community_identity_state() to authenticated;

create or replace function public.community_set_identity_visibility(p_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  insert into public.community_member_settings (user_id, show_profile, updated_at)
  values (v_uid, coalesce(p_show, false), now())
  on conflict (user_id) do update
    set show_profile = excluded.show_profile, updated_at = now();
  perform public.community_refresh_candidate_identity(v_uid);
  return public.community_identity_state();
end;
$$;
revoke all on function public.community_set_identity_visibility(boolean) from public, anon;
grant execute on function public.community_set_identity_visibility(boolean) to authenticated;

-- Welcome post: the old copy promised anonymity unconditionally.
update public.community_posts
   set body = 'Welcome to TipChat. Ask a question, share an interview lesson, post a vacancy or help another job seeker prepare. Keep names, contact details and confidential employer information out of posts. Posts appear as “Anonymous member” unless you choose to show your Talent Pool name and photo, and every post is reviewed before it goes live.'
 where system_key = 'interview-tips-welcome-v1';

-- ---------------------------------------------------------------------------
-- 3. Own submissions + delete own content
-- ---------------------------------------------------------------------------
create or replace function public.community_my_submissions()
returns table (
  item_kind text, item_id uuid, item_post_id uuid, item_body text,
  item_status text, item_created_at timestamptz, item_reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from (
    select 'post'::text, p.id, p.id, left(p.body, 300), p.status, p.created_at, p.reviewed_at
      from public.community_posts p
     where p.author_id = auth.uid() and not p.is_official
    union all
    select 'comment'::text, c.id, c.post_id, left(c.body, 300), c.status, c.created_at, c.reviewed_at
      from public.community_comments c
     where c.author_id = auth.uid()
  ) s
  order by 6 desc
  limit 100;
$$;
revoke all on function public.community_my_submissions() from public, anon;
grant execute on function public.community_my_submissions() to authenticated;

create or replace function public.community_delete_own(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_poster text;
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if p_kind = 'post' then
    delete from public.community_posts
     where id = p_id and author_id = v_uid and not is_official
    returning poster_image_url into v_poster;
    get diagnostics v_rows = row_count;
  elsif p_kind = 'comment' then
    delete from public.community_comments where id = p_id and author_id = v_uid;
    get diagnostics v_rows = row_count;
  else
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  return jsonb_build_object('deleted', v_rows > 0, 'poster_image_url', v_poster);
end;
$$;
revoke all on function public.community_delete_own(text, uuid) from public, anon;
grant execute on function public.community_delete_own(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Moderator flags
-- ---------------------------------------------------------------------------
create or replace function public.community_admin_flags()
returns table (flag_content_type text, flag_content_id uuid, flag_reasons text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select f.content_type, f.content_id, f.reasons
      from public.community_automated_flags f
     where f.status = 'open';
end;
$$;
revoke all on function public.community_admin_flags() from public, anon;
grant execute on function public.community_admin_flags() to authenticated;

create or replace function public.community_close_flags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    update public.community_automated_flags
       set status = 'reviewed', reviewed_at = now()
     where content_type = tg_argv[0] and content_id = new.id and status = 'open';
  end if;
  return new;
end;
$$;
revoke all on function public.community_close_flags() from public, anon, authenticated;

drop trigger if exists community_posts_close_flags on public.community_posts;
create trigger community_posts_close_flags
  after update of status on public.community_posts
  for each row execute function public.community_close_flags('post');
drop trigger if exists community_comments_close_flags on public.community_comments;
create trigger community_comments_close_flags
  after update of status on public.community_comments
  for each row execute function public.community_close_flags('comment');

-- ---------------------------------------------------------------------------
-- 5. Rate limits (per author, enforced in the database)
-- ---------------------------------------------------------------------------
create index if not exists community_posts_author_created_idx
  on public.community_posts (author_id, created_at desc) where author_id is not null;
create index if not exists community_comments_author_created_idx
  on public.community_comments (author_id, created_at desc);
create index if not exists community_reports_reporter_created_idx
  on public.community_reports (reporter_id, created_at desc);

create or replace function public.community_enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_hour integer;
  v_day integer;
begin
  if tg_table_name = 'community_posts' then
    v_uid := new.author_id;
    if v_uid is null then return new; end if;
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.community_posts where author_id = v_uid and created_at > now() - interval '1 day';
    if v_hour >= 5 or v_day >= 15 then
      raise exception 'Rate limit: too many posts, try again later' using errcode = 'P0429';
    end if;
  elsif tg_table_name = 'community_comments' then
    v_uid := new.author_id;
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.community_comments where author_id = v_uid and created_at > now() - interval '1 day';
    if v_hour >= 20 or v_day >= 80 then
      raise exception 'Rate limit: too many comments, try again later' using errcode = 'P0429';
    end if;
  else
    v_uid := new.reporter_id;
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.community_reports where reporter_id = v_uid and created_at > now() - interval '1 day';
    if v_hour >= 20 or v_day >= 60 then
      raise exception 'Rate limit: too many reports, try again later' using errcode = 'P0429';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.community_enforce_rate_limit() from public, anon, authenticated;

drop trigger if exists community_posts_rate_limit on public.community_posts;
create trigger community_posts_rate_limit
  before insert on public.community_posts
  for each row execute function public.community_enforce_rate_limit();
drop trigger if exists community_comments_rate_limit on public.community_comments;
create trigger community_comments_rate_limit
  before insert on public.community_comments
  for each row execute function public.community_enforce_rate_limit();
drop trigger if exists community_reports_rate_limit on public.community_reports;
create trigger community_reports_rate_limit
  before insert on public.community_reports
  for each row execute function public.community_enforce_rate_limit();

-- ---------------------------------------------------------------------------
-- 6. Poster URLs must come from our own R2 bucket
-- ---------------------------------------------------------------------------
-- If R2_PUBLIC_BASE_URL (Cloudflare-worker/wrangler.toml) ever changes, update the host here.
create or replace function public.community_poster_url_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is null
      or p_url ~ '^https://pub-911e4cd402674c6f85c747b12212772f\.r2\.dev/employer-posters/[A-Za-z0-9]+\.jpg$';
$$;

alter table public.community_posts drop constraint if exists community_posts_poster_image_url_check;
-- NOT VALID: existing rows are left alone, every new or changed row is checked.
alter table public.community_posts
  add constraint community_posts_poster_image_url_check
  check (length(poster_image_url) <= 1200 and public.community_poster_url_ok(poster_image_url)) not valid;

-- ---------------------------------------------------------------------------
-- 7. Moderator notification bookkeeping
-- ---------------------------------------------------------------------------
alter table public.community_posts add column if not exists notified_at timestamptz;
alter table public.community_comments add column if not exists notified_at timestamptz;
-- Do not email about content that already existed before this feature.
update public.community_posts set notified_at = now() where notified_at is null and status <> 'pending';
update public.community_comments set notified_at = now() where notified_at is null and status <> 'pending';
create index if not exists community_posts_unnotified_idx
  on public.community_posts (created_at) where status = 'pending' and notified_at is null;
create index if not exists community_comments_unnotified_idx
  on public.community_comments (created_at) where status = 'pending' and notified_at is null;

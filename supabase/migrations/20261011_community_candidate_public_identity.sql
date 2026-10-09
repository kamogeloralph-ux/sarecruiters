-- TipChat identity is inherited only from an active, publicly listed Talent Pool profile.
-- The private author_id remains unselectable; only the display name/photo are copied
-- into explicitly granted community display columns.
alter table public.community_posts
  add column if not exists author_photo_url text;
alter table public.community_comments
  add column if not exists author_photo_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_posts'::regclass
      and conname = 'community_posts_author_photo_url_https_check'
  ) then
    alter table public.community_posts
      add constraint community_posts_author_photo_url_https_check
      check (author_photo_url is null or (length(author_photo_url) <= 1200 and author_photo_url like 'https://%'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_comments'::regclass
      and conname = 'community_comments_author_photo_url_https_check'
  ) then
    alter table public.community_comments
      add constraint community_comments_author_photo_url_https_check
      check (author_photo_url is null or (length(author_photo_url) <= 1200 and author_photo_url like 'https://%'));
  end if;
end $$;

grant select (author_photo_url) on public.community_posts to anon, authenticated;
grant select (author_photo_url) on public.community_comments to anon, authenticated;

-- Internal-only helper: synchronize rows from active public profiles without
-- granting clients access to candidate ownership IDs or private candidate data.
create or replace function public.community_refresh_candidate_identity(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_photo text;
begin
  if p_user_id is null then return; end if;

  select nullif(btrim(c.full_name), ''), c.photo_url
    into v_name, v_photo
  from public.pool_candidates c
  where c.user_id = p_user_id
    and c.status = 'active'
    and nullif(btrim(c.full_name), '') is not null
  order by c.created_at desc
  limit 1;

  v_name := case when v_name is null then 'Anonymous member' else left(v_name, 40) end;
  v_photo := case when v_photo like 'https://%' and length(v_photo) <= 1200 then v_photo else null end;

  update public.community_posts
    set author_label = v_name, author_photo_url = v_photo
    where author_id = p_user_id and not is_official;
  update public.community_comments
    set author_label = v_name, author_photo_url = v_photo
    where author_id = p_user_id;
end;
$$;

create or replace function public.community_stamp_candidate_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_photo text;
begin
  if new.author_id is null then
    new.author_photo_url := null;
    return new;
  end if;

  new.author_label := 'Anonymous member';
  new.author_photo_url := null;
  if new.author_id is null then return new; end if;

  select nullif(btrim(c.full_name), ''), c.photo_url
    into v_name, v_photo
  from public.pool_candidates c
  where c.user_id = new.author_id
    and c.status = 'active'
    and nullif(btrim(c.full_name), '') is not null
  order by c.created_at desc
  limit 1;

  if v_name is not null then
    new.author_label := left(v_name, 40);
    if v_photo like 'https://%' and length(v_photo) <= 1200 then
      new.author_photo_url := v_photo;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.community_sync_candidate_identity_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.community_refresh_candidate_identity(old.user_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform public.community_refresh_candidate_identity(old.user_id);
  end if;
  perform public.community_refresh_candidate_identity(new.user_id);
  return new;
end;
$$;

revoke all on function public.community_refresh_candidate_identity(uuid) from public, anon, authenticated;
revoke all on function public.community_stamp_candidate_identity() from public, anon, authenticated;
revoke all on function public.community_sync_candidate_identity_trigger() from public, anon, authenticated;

drop trigger if exists community_posts_stamp_candidate_identity on public.community_posts;
create trigger community_posts_stamp_candidate_identity
  before insert on public.community_posts
  for each row execute function public.community_stamp_candidate_identity();
drop trigger if exists community_comments_stamp_candidate_identity on public.community_comments;
create trigger community_comments_stamp_candidate_identity
  before insert on public.community_comments
  for each row execute function public.community_stamp_candidate_identity();
-- pool_candidates is created outside this repo's migrations; only attach the sync
-- trigger when it exists so this migration also runs on a fresh database.
do $$
begin
  if to_regclass('public.pool_candidates') is not null then
    drop trigger if exists pool_candidates_sync_community_identity on public.pool_candidates;
    create trigger pool_candidates_sync_community_identity
      after insert or update or delete on public.pool_candidates
      for each row execute function public.community_sync_candidate_identity_trigger();
  end if;
end $$;

-- The automatic backfill that used to live here was removed: public identity is now
-- opt-in (20261012_tipchat_audit_fixes.sql), so existing content stays anonymous.

-- SA Recruiters Community MVP: public Interview Tips group.
-- Public identities are pseudonymous; account IDs remain private for moderation.
-- All member-created posts/comments start pending and are invisible until approved.

create table if not exists public.community_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.community_groups (slug, title, description, is_public)
values (
  'interview-tips',
  'Interview Tips',
  'Share interview questions, lessons learned and practical advice for job seekers in South Africa.',
  true
)
on conflict (slug) do update
set title = excluded.title,
    description = excluded.description,
    is_public = excluded.is_public;

create table if not exists public.community_memberships (
  group_id uuid not null references public.community_groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.community_groups(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete cascade,
  author_label text not null default 'Anonymous member' check (char_length(author_label) between 1 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  is_official boolean not null default false,
  system_key text unique,
  likes_count integer not null default 0 check (likes_count >= 0),
  comments_count integer not null default 0 check (comments_count >= 0),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  constraint community_posts_author_kind_check check (
    (is_official and author_id is null and system_key is not null)
    or (not is_official and author_id is not null and system_key is null)
  )
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_label text not null default 'Anonymous member' check (char_length(author_label) between 1 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 1500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

create table if not exists public.community_post_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reaction_type text not null default 'like' check (reaction_type = 'like'),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'personal_info', 'scam', 'other')),
  details text check (details is null or char_length(details) <= 600),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  constraint community_reports_exactly_one_target check ((post_id is not null) <> (comment_id is not null))
);

create index if not exists community_memberships_user_idx
  on public.community_memberships (user_id, group_id);
create index if not exists community_posts_group_status_created_idx
  on public.community_posts (group_id, status, created_at desc);
create index if not exists community_comments_post_status_created_idx
  on public.community_comments (post_id, status, created_at asc);
create index if not exists community_post_reactions_post_idx
  on public.community_post_reactions (post_id);
create index if not exists community_reports_open_created_idx
  on public.community_reports (status, created_at desc);
create index if not exists community_reports_post_idx
  on public.community_reports (post_id) where post_id is not null;
create index if not exists community_reports_comment_idx
  on public.community_reports (comment_id) where comment_id is not null;
create unique index if not exists community_reports_one_open_post_per_reporter_idx
  on public.community_reports (reporter_id, post_id)
  where status = 'open' and post_id is not null;
create unique index if not exists community_reports_one_open_comment_per_reporter_idx
  on public.community_reports (reporter_id, comment_id)
  where status = 'open' and comment_id is not null;

alter table public.community_groups enable row level security;
alter table public.community_memberships enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_post_reactions enable row level security;
alter table public.community_reports enable row level security;

revoke all on public.community_groups, public.community_memberships,
  public.community_posts, public.community_comments,
  public.community_post_reactions, public.community_reports
  from anon, authenticated;

-- Expose only non-identifying fields. author_id/reporter_id are never granted.
grant select (id, slug, title, description, is_public, created_at)
  on public.community_groups to anon, authenticated;
grant select (group_id, joined_at) on public.community_memberships to authenticated;
grant insert (group_id) on public.community_memberships to authenticated;
grant delete on public.community_memberships to authenticated;
grant select (id, group_id, author_label, body, status, is_official,
              likes_count, comments_count, created_at)
  on public.community_posts to anon, authenticated;
grant insert (group_id, body) on public.community_posts to authenticated;
grant update (status) on public.community_posts to authenticated;
grant select (id, post_id, author_label, body, status, created_at)
  on public.community_comments to anon, authenticated;
grant insert (post_id, body) on public.community_comments to authenticated;
grant update (status) on public.community_comments to authenticated;
grant select (post_id, reaction_type, created_at)
  on public.community_post_reactions to authenticated;
grant insert (post_id, reaction_type) on public.community_post_reactions to authenticated;
grant delete on public.community_post_reactions to authenticated;
grant select (id, post_id, comment_id, reason, details, status, created_at, reviewed_at)
  on public.community_reports to authenticated;
grant insert (post_id, comment_id, reason, details) on public.community_reports to authenticated;
grant update (status) on public.community_reports to authenticated;

create policy community_groups_public_read
  on public.community_groups for select to anon, authenticated
  using (is_public);

create policy community_memberships_read_own
  on public.community_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy community_memberships_join_own
  on public.community_memberships for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.community_groups g
      where g.id = group_id and g.is_public
    )
  );
create policy community_memberships_leave_own
  on public.community_memberships for delete to authenticated
  using (user_id = (select auth.uid()));

create policy community_posts_read_public
  on public.community_posts for select to anon
  using (status = 'approved');
create policy community_posts_read_authenticated
  on public.community_posts for select to authenticated
  using (
    status = 'approved'
    or author_id = (select auth.uid())
    or public.is_admin()
  );
create policy community_posts_insert_member
  on public.community_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and not is_official
    and exists (
      select 1 from public.community_memberships m
      where m.group_id = community_posts.group_id
        and m.user_id = (select auth.uid())
    )
  );
create policy community_posts_admin_moderate
  on public.community_posts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy community_comments_read_public
  on public.community_comments for select to anon
  using (
    status = 'approved'
    and exists (
      select 1 from public.community_posts p
      where p.id = post_id and p.status = 'approved'
    )
  );
create policy community_comments_read_authenticated
  on public.community_comments for select to authenticated
  using (
    public.is_admin()
    or author_id = (select auth.uid())
    or (
      status = 'approved'
      and exists (
        select 1 from public.community_posts p
        where p.id = post_id and p.status = 'approved'
      )
    )
  );
create policy community_comments_insert_member
  on public.community_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1
      from public.community_posts p
      join public.community_memberships m on m.group_id = p.group_id
      where p.id = post_id
        and p.status = 'approved'
        and m.user_id = (select auth.uid())
    )
  );
create policy community_comments_admin_moderate
  on public.community_comments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy community_reactions_read_own
  on public.community_post_reactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy community_reactions_insert_member
  on public.community_post_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.community_posts p
      join public.community_memberships m on m.group_id = p.group_id
      where p.id = post_id
        and p.status = 'approved'
        and m.user_id = (select auth.uid())
    )
  );
create policy community_reactions_delete_own
  on public.community_post_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy community_reports_insert_own_visible_content
  on public.community_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      (post_id is not null and exists (
        select 1 from public.community_posts p
        where p.id = post_id and p.status = 'approved'
      ))
      or
      (comment_id is not null and exists (
        select 1 from public.community_comments c
        join public.community_posts p on p.id = c.post_id
        where c.id = comment_id and c.status = 'approved' and p.status = 'approved'
      ))
    )
  );
create policy community_reports_read_reporter_or_admin
  on public.community_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());
create policy community_reports_admin_moderate
  on public.community_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Keep aggregate counts current without exposing the identities behind reactions.
create or replace function public.community_adjust_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_posts
       set likes_count = likes_count + 1
     where id = new.post_id;
    return new;
  end if;
  update public.community_posts
     set likes_count = greatest(0, likes_count - 1)
   where id = old.post_id;
  return old;
end;
$$;
revoke all on function public.community_adjust_post_like_count() from public, anon, authenticated;
create trigger community_post_reactions_count_trigger
  after insert or delete on public.community_post_reactions
  for each row execute function public.community_adjust_post_like_count();

create or replace function public.community_adjust_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      update public.community_posts set comments_count = comments_count + 1 where id = new.post_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status = 'approved' then
      update public.community_posts set comments_count = greatest(0, comments_count - 1) where id = old.post_id;
    end if;
    return old;
  elsif old.status is distinct from new.status then
    if old.status = 'approved' and new.status <> 'approved' then
      update public.community_posts set comments_count = greatest(0, comments_count - 1) where id = new.post_id;
    elsif old.status <> 'approved' and new.status = 'approved' then
      update public.community_posts set comments_count = comments_count + 1 where id = new.post_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.community_adjust_post_comment_count() from public, anon, authenticated;
create trigger community_comments_count_trigger
  after insert or update of status or delete on public.community_comments
  for each row execute function public.community_adjust_post_comment_count();

create or replace function public.community_stamp_moderation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.community_stamp_moderation() from public, anon, authenticated;
create trigger community_posts_review_stamp
  before update of status on public.community_posts
  for each row execute function public.community_stamp_moderation();
create trigger community_comments_review_stamp
  before update of status on public.community_comments
  for each row execute function public.community_stamp_moderation();
create trigger community_reports_review_stamp
  before update of status on public.community_reports
  for each row execute function public.community_stamp_moderation();

insert into public.community_posts (
  group_id, author_id, author_label, body, status, is_official, system_key
)
select
  g.id,
  null,
  'SA Recruiters',
  'Welcome to Interview Tips. Ask a question, share an interview lesson, or help another job seeker prepare. Keep names, contact details and confidential employer information out of posts. Member posts appear publicly under “Anonymous member” and are reviewed before they go live.',
  'approved',
  true,
  'interview-tips-welcome-v1'
from public.community_groups g
where g.slug = 'interview-tips'
on conflict (system_key) do nothing;

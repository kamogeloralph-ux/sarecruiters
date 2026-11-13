-- TipChat marketplace listings and official vacancy auto-publishing support.
-- Safe to re-run. Member listings use the existing TipChat membership and
-- moderation/delete safeguards; official posts are inserted only by the Worker.

alter table public.community_posts
  add column if not exists marketplace_title text,
  add column if not exists marketplace_price text,
  add column if not exists marketplace_category text,
  add column if not exists marketplace_condition text,
  add column if not exists marketplace_location text,
  add column if not exists marketplace_contact text;

do $$
begin
  -- The original vacancy migration created a two-value check. Replace it with
  -- the additive marketplace check without disturbing existing rows.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.community_posts'::regclass
       and conname = 'community_posts_post_type_check'
  ) then
    alter table public.community_posts drop constraint community_posts_post_type_check;
  end if;
  alter table public.community_posts
    add constraint community_posts_post_type_check
    check (post_type in ('discussion', 'vacancy', 'marketplace'));
exception when duplicate_object then
  null;
end $$;

do $$
declare
  constraint_name text;
begin
  foreach constraint_name in array array[
    'community_posts_marketplace_title_check',
    'community_posts_marketplace_price_check',
    'community_posts_marketplace_category_check',
    'community_posts_marketplace_condition_check',
    'community_posts_marketplace_location_check',
    'community_posts_marketplace_contact_check'
  ] loop
    execute format('alter table public.community_posts drop constraint if exists %I', constraint_name);
  end loop;
  alter table public.community_posts
    add constraint community_posts_marketplace_title_check
      check (marketplace_title is null or char_length(btrim(marketplace_title)) between 2 and 140),
    add constraint community_posts_marketplace_price_check
      check (marketplace_price is null or char_length(btrim(marketplace_price)) <= 80),
    add constraint community_posts_marketplace_category_check
      check (marketplace_category is null or char_length(btrim(marketplace_category)) <= 60),
    add constraint community_posts_marketplace_condition_check
      check (marketplace_condition is null or marketplace_condition in ('new', 'like_new', 'good', 'fair', 'wanted', 'service')),
    add constraint community_posts_marketplace_location_check
      check (marketplace_location is null or char_length(btrim(marketplace_location)) <= 120),
    add constraint community_posts_marketplace_contact_check
      check (marketplace_contact is null or char_length(btrim(marketplace_contact)) <= 300);
end $$;

grant select (
  id, group_id, author_label, body, status, is_official,
  post_type, vacancy_title, vacancy_location, vacancy_application,
  poster_image_url, marketplace_title, marketplace_price,
  marketplace_category, marketplace_condition, marketplace_location,
  marketplace_contact, likes_count, comments_count, created_at
) on public.community_posts to anon, authenticated;

grant insert (
  group_id, body, post_type, vacancy_title, vacancy_location,
  vacancy_application, poster_image_url, marketplace_title,
  marketplace_price, marketplace_category, marketplace_condition,
  marketplace_location, marketplace_contact
) on public.community_posts to authenticated;

create index if not exists community_posts_official_system_key_idx
  on public.community_posts (is_official, created_at desc)
  where is_official = true;

-- The Worker reads this setting with the service-role key. It is intentionally
-- disabled by default until an admin enables the kill switch in the console.
insert into public.app_settings (key, value)
values ('tipchat_auto_vacancy_posts', 'false')
on conflict (key) do nothing;

comment on column public.community_posts.marketplace_contact is
  'Seller-provided public contact or safe handover instructions; never use for passwords, OTPs or banking details.';

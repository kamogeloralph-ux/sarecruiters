-- TipChat brings text vacancies and poster vacancies into one moderated feed.
-- Poster files are uploaded to the existing authenticated Cloudflare R2 route;
-- only the returned public poster URL is attached to a community post.
alter table public.community_posts
  add column if not exists poster_image_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.community_posts'::regclass
      and conname = 'community_posts_poster_image_url_check'
  ) then
    alter table public.community_posts
      add constraint community_posts_poster_image_url_check
      check (
        poster_image_url is null
        or (
          length(poster_image_url) <= 1200
          and poster_image_url like 'https://%/employer-posters/%'
        )
      );
  end if;
end $$;

grant select (
  id, group_id, author_label, body, status, is_official,
  post_type, vacancy_title, vacancy_location, vacancy_application,
  poster_image_url, likes_count, comments_count, created_at
) on public.community_posts to anon, authenticated;

grant insert (poster_image_url) on public.community_posts to authenticated;

update public.community_groups
set title = 'TipChat',
    description = 'A shared space for South African job seekers to swap advice and discover vacancies — by text or poster.'
where slug = 'interview-tips';

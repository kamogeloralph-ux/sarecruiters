-- Community text vacancies: a lightweight vacancy mode for Tips Chat.
-- The original body remains the source announcement; metadata is optional and editable.

alter table public.community_posts
  add column if not exists post_type text not null default 'discussion',
  add column if not exists vacancy_title text,
  add column if not exists vacancy_location text,
  add column if not exists vacancy_application text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.community_posts'::regclass
      and conname = 'community_posts_post_type_check'
  ) then
    alter table public.community_posts
      add constraint community_posts_post_type_check
      check (post_type in ('discussion', 'vacancy'));
  end if;
end $$;

grant select (
  id, group_id, author_label, body, status, is_official,
  post_type, vacancy_title, vacancy_location, vacancy_application,
  likes_count, comments_count, created_at
) on public.community_posts to anon, authenticated;

grant insert (
  group_id, body, post_type, vacancy_title, vacancy_location, vacancy_application
) on public.community_posts to authenticated;

create index if not exists community_posts_group_type_status_created_idx
  on public.community_posts (group_id, post_type, status, created_at desc);

-- Public vacancy posters are written by the Turnstile-verified Worker only.
-- Remove the old open INSERT policy so the anon Supabase client cannot bypass
-- the spam check or flood the feed with arbitrary rows.
drop policy if exists posters_insert_public on public.employer_posters;

-- The existing signed-in employer/admin uploader still writes its already
-- authenticated row after uploading through the Worker.
drop policy if exists posters_insert_authenticated on public.employer_posters;
create policy posters_insert_authenticated
  on public.employer_posters for insert to authenticated
  with check (true);

create or replace function public.public_submit_poster(
  p_image_url text,
  p_caption text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  poster_id uuid;
  clean_caption text := nullif(left(trim(coalesce(p_caption, '')), 500), '');
begin
  if p_image_url is null
     or length(p_image_url) > 1200
     or p_image_url not like '%/employer-posters/%' then
    raise exception 'invalid poster image';
  end if;

  insert into public.employer_posters (image_url, caption, expires_at)
  values (p_image_url, clean_caption, now() + interval '90 days')
  returning id into poster_id;

  return poster_id;
end;
$$;

revoke all on function public.public_submit_poster(text, text) from public;
grant execute on function public.public_submit_poster(text, text) to anon, authenticated;

comment on function public.public_submit_poster(text, text) is
  'Creates a public poster row after the Cloudflare Worker verifies Turnstile.';

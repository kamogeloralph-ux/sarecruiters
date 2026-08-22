-- SA Recruiters — Managed campaign posters
-- Run once in the Supabase SQL Editor.
-- The admin console stores poster metadata in public.posters and image files in
-- the public poster-assets bucket. Public visitors can only read active rows.

create table if not exists public.posters (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('candidates', 'employers')),
  title text not null default '',
  subtitle text not null default '',
  image_path text not null,
  image_url text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posters enable row level security;

create index if not exists posters_public_order_idx
  on public.posters (audience, is_active, sort_order, created_at desc);

-- Keep updated_at current when an admin edits poster metadata.
create or replace function public.set_posters_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posters_set_updated_at on public.posters;
create trigger posters_set_updated_at
before update on public.posters
for each row execute function public.set_posters_updated_at();

-- Public app: only active posters and only the display fields are readable.
drop policy if exists posters_public_read_active on public.posters;
create policy posters_public_read_active
on public.posters
for select
to anon, authenticated
using (is_active = true);

-- Authenticated admin console: existing project admin access is based on Supabase Auth.
drop policy if exists posters_authenticated_manage on public.posters;
create policy posters_authenticated_manage
on public.posters
for all
to authenticated
using (true)
with check (true);

-- Public bucket for poster images. The table remains the source of truth for
-- which images are displayed, while the bucket allows efficient CDN delivery.
insert into storage.buckets (id, name, public)
values ('poster-assets', 'poster-assets', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists poster_assets_public_read on storage.objects;
create policy poster_assets_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'poster-assets');

drop policy if exists poster_assets_authenticated_insert on storage.objects;
create policy poster_assets_authenticated_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'poster-assets');

drop policy if exists poster_assets_authenticated_update on storage.objects;
create policy poster_assets_authenticated_update
on storage.objects
for update
to authenticated
using (bucket_id = 'poster-assets')
with check (bucket_id = 'poster-assets');

drop policy if exists poster_assets_authenticated_delete on storage.objects;
create policy poster_assets_authenticated_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'poster-assets');

-- Optional cleanup helper for files removed from the admin console is handled
-- explicitly by the browser before the metadata row is deleted.
comment on table public.posters is 'Admin-managed employer and candidate campaign posters displayed on the public home carousel.';
comment on column public.posters.audience is 'Display destination: candidates or employers.';
comment on column public.posters.image_path is 'Storage object path inside poster-assets.';
comment on column public.posters.sort_order is 'Lower values appear first within an audience.';

notify pgrst, 'reload schema';

-- After running this migration, use the Posters page in admin.html to upload
-- the existing campaign artwork. No manual SQL inserts are required.

-- Important: if your project has a stricter admin-role policy already, replace
-- the authenticated manage policy above with that project-specific admin check.

-- Rollback (manual, only if needed):
-- drop table if exists public.posters cascade;
-- delete from storage.buckets where id = 'poster-assets';

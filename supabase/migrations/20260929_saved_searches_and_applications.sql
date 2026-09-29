-- Saved searches (email job alerts) + per-user application tracking.
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  query text not null default '',
  location text not null default '',
  remote text not null default '',
  experience text not null default '',
  active boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid(),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists saved_searches_unique_idx
  on public.saved_searches (user_id, lower(query), lower(location), remote, experience);
alter table public.saved_searches enable row level security;
drop policy if exists saved_searches_own on public.saved_searches;
create policy saved_searches_own on public.saved_searches
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.unsubscribe_saved_search(p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.saved_searches set active = false where unsubscribe_token = p_token;
  return found;
end $$;
grant execute on function public.unsubscribe_saved_search(uuid) to anon, authenticated;

create table if not exists public.vacancy_applications (
  user_id uuid not null references auth.users(id) on delete cascade,
  vacancy_id text not null,
  status text not null default 'applied' check (status in ('applied','interview','offer','rejected')),
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, vacancy_id)
);
alter table public.vacancy_applications enable row level security;
drop policy if exists vacancy_applications_own on public.vacancy_applications;
create policy vacancy_applications_own on public.vacancy_applications
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

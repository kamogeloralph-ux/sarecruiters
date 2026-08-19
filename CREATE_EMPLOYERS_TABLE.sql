-- ============================================================
-- SA Recruiters — Employers feature
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- 1) New `employers` table — companies that register directly and post
--    their own vacancies (separate from the recruitment-agency directory).
create table if not exists public.employers (
  id            text primary key,
  name          text not null,
  industry      text,
  website       text,
  contact       text,
  email         text,
  location      text,
  address       text,
  photo         text,        -- base64 data URL (logo), same pattern as agencies.photo
  verified      boolean default false,
  manage_token  text,        -- reserved for a future self-service "manage my listing" link
  created_at    timestamptz default now()
);

alter table public.employers enable row level security;

-- Public can read all employers (directory is public)
create policy if not exists "Employers are publicly readable"
  on public.employers for select
  using (true);

-- Public can register a new employer (self-service sign-up).
-- NOTE: this mirrors the app's current permissive model (same as agencies/
-- vacancies) — anyone can insert/update. If you want to lock this down later
-- (e.g. only allow updates via a manage_token check), tighten these policies.
create policy if not exists "Anyone can register an employer"
  on public.employers for insert
  with check (true);

create policy if not exists "Anyone can update an employer"
  on public.employers for update
  using (true);

create policy if not exists "Anyone can delete an employer"
  on public.employers for delete
  using (true);

-- 2) Link vacancies to an employer. A vacancy posted by an employer will
--    have agency_id = 'employer' and employer_id = <employers.id>.
alter table public.vacancies
  add column if not exists employer_id text references public.employers(id) on delete set null;

-- Helpful index for "this employer's vacancies" lookups
create index if not exists idx_vacancies_employer_id on public.vacancies(employer_id);

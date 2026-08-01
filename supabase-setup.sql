-- ============================================================
--  SA RECRUITERS — SUPABASE SQL SETUP
--  Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
--  This script ensures the `reports` and `suggestions` tables
--  exist with the correct columns and Row-Level Security (RLS)
--  policies so that:
--    • Any visitor (anon) can INSERT a report or suggestion
--    • Only the admin (authenticated) can VIEW / DELETE rows
--
--  The app already saves everything to localStorage as a backup,
--  so even if Supabase is unavailable, submissions still work
--  and the WhatsApp confirmation sheet still appears.
-- ============================================================


-- ============================================================
--  TABLE: reports
-- ============================================================
--  Columns inserted by submitReport() in index.html:
--    agency_name  (text)
--    agency_id    (uuid, nullable — matched agency id or null)
--    reason       (text)
--    details      (text)
--    status       (text, default 'open')
-- ============================================================

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  agency_name  text,
  agency_id    uuid references public.agencies(id) on delete set null,
  reason       text,
  details      text,
  status       text default 'open',
  created_at   timestamptz default now()
);

-- Enable Row Level Security
alter table public.reports enable row level security;

-- Policy: anyone (anon + authenticated) can INSERT a report
drop policy if exists "Anyone can submit a report" on public.reports;
create policy "Anyone can submit a report"
  on public.reports for insert
  to anon, authenticated
  with check (true);

-- Policy: only authenticated (admin) can SELECT reports
drop policy if exists "Admin can view reports" on public.reports;
create policy "Admin can view reports"
  on public.reports for select
  to authenticated
  using (true);

-- Policy: only authenticated (admin) can DELETE reports
drop policy if exists "Admin can delete reports" on public.reports;
create policy "Admin can delete reports"
  on public.reports for delete
  to authenticated
  using (true);

-- Policy: only authenticated (admin) can UPDATE reports (e.g. change status)
drop policy if exists "Admin can update reports" on public.reports;
create policy "Admin can update reports"
  on public.reports for update
  to authenticated
  using (true);


-- ============================================================
--  TABLE: suggestions
-- ============================================================
--  Columns inserted by submitSuggestion() in index.html:
--    type         (text — 'Suggest an agency', 'Feedback / comment', etc.)
--    agency_name  (text, nullable)
--    details      (text)
--    status       (text, default 'open')
-- ============================================================

create table if not exists public.suggestions (
  id           uuid primary key default gen_random_uuid(),
  type         text,
  agency_name  text,
  details      text,
  status       text default 'open',
  created_at   timestamptz default now()
);

-- Enable Row Level Security
alter table public.suggestions enable row level security;

-- Policy: anyone (anon + authenticated) can INSERT a suggestion
drop policy if exists "Anyone can submit a suggestion" on public.suggestions;
create policy "Anyone can submit a suggestion"
  on public.suggestions for insert
  to anon, authenticated
  with check (true);

-- Policy: only authenticated (admin) can SELECT suggestions
drop policy if exists "Admin can view suggestions" on public.suggestions;
create policy "Admin can view suggestions"
  on public.suggestions for select
  to authenticated
  using (true);

-- Policy: only authenticated (admin) can DELETE suggestions
drop policy if exists "Admin can delete suggestions" on public.suggestions;
create policy "Admin can delete suggestions"
  on public.suggestions for delete
  to authenticated
  using (true);

-- Policy: only authenticated (admin) can UPDATE suggestions
drop policy if exists "Admin can update suggestions" on public.suggestions;
create policy "Admin can update suggestions"
  on public.suggestions for update
  to authenticated
  using (true);


-- ============================================================
--  OPTIONAL: Realtime notifications (Supabase Dashboard)
-- ============================================================
--  If you want the admin panel to auto-refresh when a new report
--  or suggestion arrives, enable Realtime for these tables:
--
--    Supabase Dashboard → Database → Replication
--    → Add the `reports` and `suggestions` tables to the
--      `supabase_realtime` publication.
--
--  Or run this SQL:
--
--    alter publication supabase_realtime add table public.reports;
--    alter publication supabase_realtime add table public.suggestions;
-- ============================================================


-- ============================================================
--  VERIFY — run after to confirm tables exist
-- ============================================================
--  select table_name from information_schema.tables
--  where table_schema = 'public'
--  and table_name in ('reports', 'suggestions');
--
--  select tablename, policyname, cmd, roles
--  from pg_policies
--  where schemaname = 'public'
--  and tablename in ('reports', 'suggestions');
-- ============================================================

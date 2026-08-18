-- ============================================================
--  SA RECRUITERS — CREATE pool_candidates TABLE (Talent Pool)
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--  Then click "Run"
--
--  This powers the Talent Pool feature: job seekers pay R20/year
--  (via manual EFT, confirmed by an admin — there is no payment
--  gateway wired into this app) to list themselves so employers
--  can browse the pool directly and pick candidates.
--
--  Because this table holds real personal contact details, it is
--  locked down harder than the other tables in this app:
--    - Anyone (anon) can INSERT a registration (status defaults
--      to 'pending' — enforced by the app, not the DB).
--    - Anyone (anon) can only SELECT rows where status = 'active'.
--      Pending/expired/rejected candidates are NOT publicly
--      queryable — only an authenticated admin can see those.
--    - Only an authenticated admin (logged in via admin.html,
--      which uses real Supabase Auth) can UPDATE or DELETE rows —
--      i.e. only the admin can approve/reject/expire a candidate.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pool_candidates (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    sector TEXT DEFAULT '',
    position TEXT DEFAULT '',
    location TEXT DEFAULT '',
    cv_link TEXT DEFAULT '',
    payment_ref TEXT DEFAULT '',      -- EFT reference / proof note the candidate supplies
    admin_notes TEXT DEFAULT '',      -- internal note, e.g. "EFT confirmed 12 Aug, ref matches"
    status TEXT NOT NULL DEFAULT 'pending', -- pending | active | expired | rejected
    paid_until TIMESTAMPTZ,           -- set by admin on approval, ~1 year out
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.pool_candidates ENABLE ROW LEVEL SECURITY;

-- Policy: anyone can submit a registration
DROP POLICY IF EXISTS "pool_insert_public" ON public.pool_candidates;
CREATE POLICY "pool_insert_public" ON public.pool_candidates
    FOR INSERT WITH CHECK (true);

-- Policy: anyone (employers browsing) can only see ACTIVE candidates
DROP POLICY IF EXISTS "pool_select_active_public" ON public.pool_candidates;
CREATE POLICY "pool_select_active_public" ON public.pool_candidates
    FOR SELECT USING (status = 'active');

-- Policy: a logged-in admin can see every row (pending/active/expired/rejected)
DROP POLICY IF EXISTS "pool_select_admin" ON public.pool_candidates;
CREATE POLICY "pool_select_admin" ON public.pool_candidates
    FOR SELECT USING (auth.role() = 'authenticated');

-- Policy: only a logged-in admin can update a row (approve/reject/expire/edit)
DROP POLICY IF EXISTS "pool_update_admin" ON public.pool_candidates;
CREATE POLICY "pool_update_admin" ON public.pool_candidates
    FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Policy: only a logged-in admin can delete a row
DROP POLICY IF EXISTS "pool_delete_admin" ON public.pool_candidates;
CREATE POLICY "pool_delete_admin" ON public.pool_candidates
    FOR DELETE USING (auth.role() = 'authenticated');

-- Indexes for the browse/filter screen and the admin pending queue
CREATE INDEX IF NOT EXISTS idx_pool_status ON public.pool_candidates(status);
CREATE INDEX IF NOT EXISTS idx_pool_sector ON public.pool_candidates(sector);
CREATE INDEX IF NOT EXISTS idx_pool_location ON public.pool_candidates(location);

-- Verify
-- SELECT * FROM public.pool_candidates ORDER BY created_at DESC LIMIT 5;

-- ============================================================
--  SA RECRUITERS — CREATE app_settings TABLE
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--  Then click "Run"
--
--  This table holds small admin-controlled toggles for the app.
--  Right now it's used for ONE setting:
--
--    key = 'public_vacancy_posting', value = 'true' | 'false'
--
--  When 'true', the "Post a Vacancy" option is unlocked for
--  everyone (no login needed) so any person or company can post
--  a general vacancy. When 'false' (the default), the public
--  sees a "closed" notice with a WhatsApp button to contact the
--  admin and request it be opened for them — so the admin stays
--  in control and can lock it again once that person is done, to
--  prevent spam.
--
--  Anyone can READ this table (so the app can check the toggle
--  without logging in), but only the logged-in admin
--  (authenticated) can change it.
-- ============================================================

-- Create the app_settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the default row (posting starts CLOSED)
INSERT INTO public.app_settings (key, value)
VALUES ('public_vacancy_posting', 'false')
ON CONFLICT (key) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy: anyone (anon + authenticated) can READ settings
DROP POLICY IF EXISTS "app_settings_select_all" ON public.app_settings;
CREATE POLICY "app_settings_select_all" ON public.app_settings
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Policy: only the logged-in admin can INSERT settings
DROP POLICY IF EXISTS "app_settings_insert_admin" ON public.app_settings;
CREATE POLICY "app_settings_insert_admin" ON public.app_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy: only the logged-in admin can UPDATE settings
DROP POLICY IF EXISTS "app_settings_update_admin" ON public.app_settings;
CREATE POLICY "app_settings_update_admin" ON public.app_settings
    FOR UPDATE
    TO authenticated
    USING (true) WITH CHECK (true);

-- Verify
-- SELECT * FROM public.app_settings;

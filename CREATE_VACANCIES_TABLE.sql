-- ============================================================
--  SA RECRUITERS — CREATE / UPDATE vacancies TABLE
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--  Then click "Run"
--
--  This creates the public vacancies table so vacancies can be
--  stored in the cloud (instead of just localStorage on each
--  device). It includes a `company` column for general vacancies
--  that are posted from the Profile section (not tied to a
--  specific agency).
--
--  General vacancies use agency_id = 'general' and store the
--  company/organisation name in the `company` column.
-- ============================================================

-- Create the vacancies table
CREATE TABLE IF NOT EXISTS public.vacancies (
    id TEXT PRIMARY KEY,
    agency_id TEXT NOT NULL DEFAULT 'general',
    title TEXT NOT NULL DEFAULT '',
    company TEXT DEFAULT '',
    location TEXT DEFAULT '',
    closing_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    link TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add the company column if the table already exists without it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'vacancies'
                   AND column_name = 'company') THEN
        ALTER TABLE public.vacancies ADD COLUMN company TEXT DEFAULT '';
    END IF;
END $$;

-- Enable Row Level Security
ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;

-- Policy: anyone can read all vacancies
DROP POLICY IF EXISTS "vacancies_select_all" ON public.vacancies;
CREATE POLICY "vacancies_select_all" ON public.vacancies
    FOR SELECT USING (true);

-- Policy: anyone can insert a vacancy
DROP POLICY IF EXISTS "vacancies_insert_all" ON public.vacancies;
CREATE POLICY "vacancies_insert_all" ON public.vacancies
    FOR INSERT WITH CHECK (true);

-- Policy: anyone can update a vacancy (for admin editing)
DROP POLICY IF EXISTS "vacancies_update_all" ON public.vacancies;
CREATE POLICY "vacancies_update_all" ON public.vacancies
    FOR UPDATE USING (true) WITH CHECK (true);

-- Policy: anyone can delete a vacancy (for admin cleanup)
DROP POLICY IF EXISTS "vacancies_delete_all" ON public.vacancies;
CREATE POLICY "vacancies_delete_all" ON public.vacancies
    FOR DELETE USING (true);

-- Add an index for faster lookups by agency
CREATE INDEX IF NOT EXISTS idx_vacancies_agency_id ON public.vacancies(agency_id);

-- Verify
-- SELECT * FROM public.vacancies LIMIT 5;

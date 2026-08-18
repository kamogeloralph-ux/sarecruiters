-- ============================================================
--  SA RECRUITERS — ADD remote / experience_level TO vacancies
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--  Then click "Run"
--
--  Powers the Advanced Search Filters: lets a vacancy be tagged
--  On-site / Remote / Hybrid, and with an experience level, so
--  the All Vacancies screen can filter on them.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'vacancies'
                   AND column_name = 'remote') THEN
        ALTER TABLE public.vacancies ADD COLUMN remote TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'vacancies'
                   AND column_name = 'experience_level') THEN
        ALTER TABLE public.vacancies ADD COLUMN experience_level TEXT DEFAULT '';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vacancies_remote ON public.vacancies(remote);
CREATE INDEX IF NOT EXISTS idx_vacancies_experience ON public.vacancies(experience_level);

-- Verify
-- SELECT id, title, remote, experience_level FROM public.vacancies LIMIT 5;

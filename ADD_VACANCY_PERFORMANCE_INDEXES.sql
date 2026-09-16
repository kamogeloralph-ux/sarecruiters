-- SA Recruiters vacancy performance indexes
-- Run once in Supabase SQL Editor. These indexes support the public vacancy
-- count and the paginated general-vacancy listing introduced in app.js.

CREATE INDEX IF NOT EXISTS vacancies_created_at_desc_idx
  ON public.vacancies (created_at DESC);

CREATE INDEX IF NOT EXISTS vacancies_general_created_at_idx
  ON public.vacancies (created_at DESC)
  WHERE (agency_id IS NULL OR agency_id = 'general')
    AND employer_id IS NULL
    AND (source_type IS NULL OR source_type = 'general');

CREATE INDEX IF NOT EXISTS vacancies_agency_created_at_idx
  ON public.vacancies (agency_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vacancies_employer_created_at_idx
  ON public.vacancies (employer_id, created_at DESC)
  WHERE employer_id IS NOT NULL;

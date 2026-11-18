-- Daily source reconciliation support.
-- Scrapers write source_checked_at / last_verified_at on every observed row.
-- These indexes keep the cleanup job bounded when the catalog grows.
CREATE INDEX IF NOT EXISTS vacancies_source_checked_at_idx
  ON public.vacancies (source_type, source_checked_at ASC, id);

CREATE INDEX IF NOT EXISTS vacancies_closing_date_source_idx
  ON public.vacancies (closing_date, source_type, id);

COMMENT ON INDEX public.vacancies_source_checked_at_idx IS
  'Supports daily deletion of source rows not observed during a successful scraper refresh.';

COMMENT ON INDEX public.vacancies_closing_date_source_idx IS
  'Supports daily removal of expired vacancy rows by closing date and source.';

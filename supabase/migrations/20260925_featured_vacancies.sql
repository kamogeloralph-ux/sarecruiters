-- Optional paid visibility metadata for featured vacancy placements.
-- Standard vacancy listings remain unchanged and unfeatured by default.

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS featured_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS vacancies_featured_active_idx
  ON public.vacancies (is_featured, featured_order, created_at DESC)
  WHERE is_featured = true;

COMMENT ON COLUMN public.vacancies.is_featured IS 'Whether this vacancy is included in the optional Featured Vacancies section.';
COMMENT ON COLUMN public.vacancies.featured_until IS 'Optional end timestamp for the featured placement; the vacancy closing date still controls vacancy visibility.';
COMMENT ON COLUMN public.vacancies.featured_order IS 'Lower values appear first in the Featured Vacancies section.';

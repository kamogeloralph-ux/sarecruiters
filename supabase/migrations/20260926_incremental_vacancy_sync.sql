-- SA Recruiters — incremental vacancy mirror support
--
-- Apply this migration in Supabase before deploying the matching Worker code.
-- Existing rows receive the migration time as their initial sync watermark;
-- subsequent INSERT/UPDATE operations keep updated_at current automatically.

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.vacancies
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_vacancies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vacancies_touch_updated_at ON public.vacancies;
CREATE TRIGGER vacancies_touch_updated_at
BEFORE UPDATE ON public.vacancies
FOR EACH ROW
EXECUTE FUNCTION public.touch_vacancies_updated_at();

CREATE INDEX IF NOT EXISTS vacancies_updated_at_idx
  ON public.vacancies (updated_at ASC, id ASC);

-- Shared company profile photo for vacancies.
-- A single photo is stored per vacancy row so scraped and manually posted
-- vacancies can inherit the same image by company name.
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS company_photo text;

COMMENT ON COLUMN public.vacancies.company_photo IS
  'Shared company profile image URL; admin updates all vacancies with the same company name.';

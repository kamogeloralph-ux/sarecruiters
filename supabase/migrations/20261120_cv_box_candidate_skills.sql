-- Add an optional public-safe skills summary for CV Box candidate cards.
ALTER TABLE public.pool_candidates
  ADD COLUMN IF NOT EXISTS skills text NOT NULL DEFAULT '';

CREATE OR REPLACE VIEW public.pool_candidates_public AS
SELECT
  id,
  full_name,
  position,
  sector,
  location,
  experience_years,
  about_you,
  skills,
  photo_url,
  verified,
  status,
  created_at
FROM public.pool_candidates
WHERE status = 'active';

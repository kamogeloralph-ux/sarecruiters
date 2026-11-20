-- CV Box candidate-written introductions and optional profile banners.
-- about_you already exists in the current schema; banner_url is the new
-- public-safe URL for an administrator-uploaded cover image.
ALTER TABLE public.pool_candidates
  ADD COLUMN IF NOT EXISTS banner_url text;

COMMENT ON COLUMN public.pool_candidates.banner_url IS
  'Optional public-safe CV Box profile banner image URL; never contains contact or CV data.';

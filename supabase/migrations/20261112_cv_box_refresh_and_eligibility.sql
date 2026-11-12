-- CV Box freshness and opt-in availability renewal.
-- This migration only adds public-safe timestamps and an owner-scoped RPC;
-- contact details and CV links remain outside the public projection.
ALTER TABLE public.pool_candidates
  ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS availability_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS availability_expires_at timestamptz;

-- Existing Immediately profiles receive one grace window from their original
-- listing date; stale listings then need an explicit candidate confirmation.
UPDATE public.pool_candidates
SET profile_updated_at = COALESCE(profile_updated_at, created_at, now()),
    availability_confirmed_at = CASE
      WHEN lower(trim(COALESCE(availability, ''))) = 'immediately'
        THEN COALESCE(availability_confirmed_at, created_at, now())
      ELSE NULL
    END,
    availability_expires_at = CASE
      WHEN lower(trim(COALESCE(availability, ''))) = 'immediately'
        THEN COALESCE(availability_expires_at, COALESCE(created_at, now()) + interval '30 days')
      ELSE NULL
    END;

ALTER TABLE public.pool_candidates
  ALTER COLUMN profile_updated_at SET DEFAULT now(),
  ALTER COLUMN profile_updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS pool_candidates_active_availability_expiry_idx
  ON public.pool_candidates (availability_expires_at)
  WHERE status = 'active' AND lower(trim(COALESCE(availability, ''))) = 'immediately';

CREATE OR REPLACE FUNCTION public.touch_pool_candidate_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_renewal_days integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.profile_updated_at := now();
    IF lower(trim(COALESCE(NEW.availability, ''))) = 'immediately' THEN
      NEW.availability_confirmed_at := now();
      NEW.availability_expires_at := now() + interval '30 days';
    ELSE
      NEW.availability_confirmed_at := NULL;
      NEW.availability_expires_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.full_name, NEW.position, NEW.sector, NEW.location,
      NEW.experience_years, NEW.photo_url, NEW.cv_link, NEW.availability)
     IS DISTINCT FROM
     (OLD.full_name, OLD.position, OLD.sector, OLD.location,
      OLD.experience_years, OLD.photo_url, OLD.cv_link, OLD.availability) THEN
    NEW.profile_updated_at := now();
  ELSE
    NEW.profile_updated_at := OLD.profile_updated_at;
  END IF;

  IF lower(trim(COALESCE(NEW.availability, ''))) = 'immediately' THEN
    IF lower(trim(COALESCE(OLD.availability, ''))) <> 'immediately' THEN
      NEW.availability_confirmed_at := now();
      NEW.availability_expires_at := now() + interval '30 days';
    ELSIF NEW.availability_confirmed_at IS NOT DISTINCT FROM OLD.availability_confirmed_at
       AND NEW.availability_expires_at IS NOT DISTINCT FROM OLD.availability_expires_at THEN
      NEW.availability_confirmed_at := OLD.availability_confirmed_at;
      NEW.availability_expires_at := OLD.availability_expires_at;
    ELSE
      IF NEW.availability_confirmed_at IS NULL OR NEW.availability_expires_at IS NULL THEN
        RAISE EXCEPTION 'Still Looking confirmations must use a 14- or 30-day window.'
          USING ERRCODE = '22023';
      END IF;
      IF NEW.availability_expires_at - NEW.availability_confirmed_at = interval '14 days' THEN
        v_renewal_days := 14;
      ELSIF NEW.availability_expires_at - NEW.availability_confirmed_at = interval '30 days' THEN
        v_renewal_days := 30;
      ELSE
        RAISE EXCEPTION 'Still Looking confirmations must use a 14- or 30-day window.'
          USING ERRCODE = '22023';
      END IF;
      NEW.availability_confirmed_at := now();
      NEW.availability_expires_at := now() + make_interval(days => v_renewal_days);
    END IF;
  ELSE
    NEW.availability_confirmed_at := NULL;
    NEW.availability_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pool_candidates_touch_activity ON public.pool_candidates;
CREATE TRIGGER pool_candidates_touch_activity
  BEFORE INSERT OR UPDATE ON public.pool_candidates
  FOR EACH ROW EXECUTE FUNCTION public.touch_pool_candidate_activity();

CREATE OR REPLACE FUNCTION public.candidate_confirm_still_looking(
  p_candidate_id text,
  p_days integer DEFAULT 30
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expires_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT IN (14, 30) THEN
    RAISE EXCEPTION 'Choose a 14- or 30-day renewal.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pool_candidates
     SET availability_confirmed_at = now(),
         availability_expires_at = now() + make_interval(days => p_days)
   WHERE id = p_candidate_id
     AND user_id = auth.uid()
     AND status = 'active'
     AND lower(trim(COALESCE(availability, ''))) = 'immediately'
  RETURNING availability_expires_at INTO v_expires_at;

  IF v_expires_at IS NULL THEN
    RAISE EXCEPTION 'No active Immediately profile belongs to this account.'
      USING ERRCODE = 'P0002';
  END IF;
  RETURN v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.candidate_confirm_still_looking(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_confirm_still_looking(text, integer) TO authenticated;

COMMENT ON COLUMN public.pool_candidates.profile_updated_at IS
  'Timestamp of the latest candidate-facing profile or CV update; safe for public freshness labels.';
COMMENT ON COLUMN public.pool_candidates.availability_confirmed_at IS
  'Timestamp when the candidate last confirmed an Immediately availability status.';
COMMENT ON COLUMN public.pool_candidates.availability_expires_at IS
  'End of the candidate-selected 14- or 30-day Immediately confirmation window.';

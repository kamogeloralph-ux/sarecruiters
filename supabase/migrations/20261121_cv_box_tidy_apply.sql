-- Lets the Worker's automatic CV Box tidy (typos, grammar, 1 profession + 1 alternate) save its
-- result WITHOUT bumping profile_updated_at, so tidying never re-ranks the CV Box cards.
-- Safe to re-run. Service role only.
BEGIN;

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

  IF current_setting('sa.keep_profile_updated_at', true) = 'on' THEN
    NEW.profile_updated_at := OLD.profile_updated_at;
  ELSIF (NEW.full_name, NEW.position, NEW.sector, NEW.location,
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

CREATE OR REPLACE FUNCTION public.cv_box_tidy_apply(p_id text, p_patch jsonb, p_keep_ranking boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_keep_ranking THEN
    PERFORM set_config('sa.keep_profile_updated_at', 'on', true);
  END IF;
  UPDATE public.pool_candidates
  SET full_name     = COALESCE(p_patch->>'full_name', full_name),
      position      = COALESCE(p_patch->>'position', position),
      about_you     = COALESCE(p_patch->>'about_you', about_you),
      qualification = COALESCE(p_patch->>'qualification', qualification)
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cv_box_tidy_apply(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cv_box_tidy_apply(text, jsonb, boolean) TO service_role;

COMMIT;

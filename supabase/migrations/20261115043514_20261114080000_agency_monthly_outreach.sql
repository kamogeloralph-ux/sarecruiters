-- Consent-gated monthly agency vacancy outreach.
-- This migration is additive and is not applied by the app or Worker.
-- Directory email addresses are never considered consent by themselves.

CREATE TABLE IF NOT EXISTS public.agency_vacancy_email_preferences (
  agency_id text PRIMARY KEY REFERENCES public.agencies(id) ON DELETE CASCADE,
  email text NOT NULL,
  opted_in boolean NOT NULL DEFAULT false,
  consent_copy_version text,
  consented_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_vacancy_email_preferences_email_nonempty CHECK (btrim(email) <> '')
);

CREATE TABLE IF NOT EXISTS public.agency_vacancy_campaign_sends (
  agency_id text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  campaign_month date NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  PRIMARY KEY (agency_id, campaign_month),
  CONSTRAINT agency_vacancy_campaign_sends_month_first CHECK (extract(day FROM campaign_month) = 1)
);

-- A shared agency inbox must not receive multiple copies of the same monthly
-- message merely because it appears on multiple agency records.
CREATE UNIQUE INDEX IF NOT EXISTS agency_vacancy_campaign_sends_email_month_uidx
  ON public.agency_vacancy_campaign_sends (campaign_month, lower(btrim(recipient_email)));

ALTER TABLE public.agency_vacancy_email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_vacancy_campaign_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_vacancy_email_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agency_vacancy_campaign_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.agency_vacancy_email_preferences TO service_role;
GRANT ALL ON public.agency_vacancy_campaign_sends TO service_role;

CREATE OR REPLACE FUNCTION public.get_agency_vacancy_email_preference(p_token text)
RETURNS TABLE (agency_email text, opted_in boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.email::text,
         coalesce(p.opted_in IS TRUE AND p.unsubscribed_at IS NULL
          AND lower(btrim(p.email)) = lower(btrim(a.email)), false) AS opted_in
  FROM public.agencies a
  LEFT JOIN public.agency_vacancy_email_preferences p ON p.agency_id = a.id
  WHERE a.manage_token = p_token
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_agency_vacancy_email_preference(text) IS
  'Returns only the current email and opt-in state for the agency identified by a valid private manager token.';

CREATE OR REPLACE FUNCTION public.set_agency_vacancy_email_preference(p_token text, p_opted_in boolean)
RETURNS TABLE (agency_email text, opted_in boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency public.agencies%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR p_opted_in IS NULL THEN
    RETURN;
  END IF;

  SELECT a.* INTO v_agency
  FROM public.agencies a
  WHERE a.manage_token = p_token
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_opted_in THEN
    IF v_agency.email IS NULL OR btrim(v_agency.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RETURN QUERY SELECT v_agency.email::text, false;
      RETURN;
    END IF;

    INSERT INTO public.agency_vacancy_email_preferences AS existing
      (agency_id, email, opted_in, consent_copy_version, consented_at, unsubscribed_at, unsubscribe_token, updated_at)
    VALUES
      (v_agency.id, btrim(v_agency.email), true, 'free-listing-monthly-v1', now(), NULL, gen_random_uuid(), now())
    ON CONFLICT (agency_id) DO UPDATE
      SET email = EXCLUDED.email,
          opted_in = true,
          consent_copy_version = EXCLUDED.consent_copy_version,
          consented_at = now(),
          unsubscribed_at = NULL,
          unsubscribe_token = gen_random_uuid(),
          updated_at = now();
    RETURN QUERY SELECT v_agency.email::text, true;
  ELSE
    UPDATE public.agency_vacancy_email_preferences p
    SET opted_in = false,
        unsubscribed_at = now(),
        updated_at = now()
    WHERE p.agency_id = v_agency.id;
    RETURN QUERY SELECT v_agency.email::text, false;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_agency_vacancy_email_preference(text, boolean) IS
  'Records explicit opt-in or opt-out after independently validating the agency manager token.';

CREATE OR REPLACE FUNCTION public.unsubscribe_agency_vacancy_email(p_unsubscribe_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_unsubscribe_token IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.agency_vacancy_email_preferences p
  SET opted_in = false,
      unsubscribed_at = now(),
      updated_at = now()
  WHERE p.unsubscribe_token = p_unsubscribe_token
    AND p.opted_in IS TRUE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.unsubscribe_agency_vacancy_email(uuid) IS
  'Opaque-token one-click unsubscribe; it changes only the matching agency preference and returns no identity data.';

CREATE OR REPLACE FUNCTION public.claim_agency_vacancy_monthly_outreach(p_campaign_month date)
RETURNS TABLE (agency_id text, agency_name text, recipient_email text, manager_token text, unsubscribe_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate record;
  v_claimed public.agency_vacancy_campaign_sends%ROWTYPE;
BEGIN
  IF p_campaign_month IS NULL OR extract(day FROM p_campaign_month) <> 1 THEN
    RETURN;
  END IF;

  FOR v_candidate IN
    SELECT a.id::text AS id,
           a.name::text AS name,
           lower(btrim(a.email)) AS email,
           a.manage_token::text AS manager_token,
           p.unsubscribe_token
    FROM public.agencies a
    JOIN public.agency_vacancy_email_preferences p ON p.agency_id = a.id
    WHERE p.opted_in IS TRUE
      AND p.unsubscribed_at IS NULL
      AND a.manage_token IS NOT NULL
      AND a.email IS NOT NULL
      AND btrim(a.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND lower(btrim(p.email)) = lower(btrim(a.email))
    ORDER BY lower(btrim(a.email)), a.id
  LOOP
    BEGIN
      INSERT INTO public.agency_vacancy_campaign_sends AS existing
        (agency_id, campaign_month, recipient_email, status, attempt_count, last_attempt_at, last_error)
      VALUES
        (v_candidate.id, p_campaign_month, v_candidate.email, 'sending', 1, now(), NULL)
      ON CONFLICT (agency_id, campaign_month) DO UPDATE
        SET status = 'sending',
            attempt_count = existing.attempt_count + 1,
            last_attempt_at = now(),
            last_error = NULL
        WHERE (existing.status = 'failed'
              OR (existing.status = 'sending' AND existing.last_attempt_at < now() - interval '30 minutes'))
          AND existing.attempt_count < 3
      RETURNING * INTO v_claimed;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Another agency already claimed this shared address for this month.
      CONTINUE;
    END;

    agency_id := v_candidate.id;
    agency_name := v_candidate.name;
    recipient_email := v_candidate.email;
    manager_token := v_candidate.manager_token;
    unsubscribe_token := v_candidate.unsubscribe_token;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.claim_agency_vacancy_monthly_outreach(date) IS
  'Atomically claims only current-email, explicit-opt-in recipients, at most once per agency and email address per month.';

CREATE OR REPLACE FUNCTION public.complete_agency_vacancy_monthly_outreach(
  p_agency_id text,
  p_campaign_month date,
  p_sent boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_agency_id IS NULL OR p_campaign_month IS NULL OR p_sent IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.agency_vacancy_campaign_sends s
  SET status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN p_sent THEN now() ELSE NULL END,
      last_error = CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error, 'send failed'), 200) END
  WHERE s.agency_id = p_agency_id
    AND s.campaign_month = p_campaign_month
    AND s.status = 'sending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

COMMENT ON FUNCTION public.complete_agency_vacancy_monthly_outreach(text, date, boolean, text) IS
  'Marks a claimed monthly send sent or failed; the caller is the trusted Worker only.';

REVOKE ALL ON FUNCTION public.get_agency_vacancy_email_preference(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_agency_vacancy_email_preference(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unsubscribe_agency_vacancy_email(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_agency_vacancy_monthly_outreach(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_agency_vacancy_monthly_outreach(text, date, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_vacancy_email_preference(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_agency_vacancy_email_preference(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.unsubscribe_agency_vacancy_email(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_agency_vacancy_monthly_outreach(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_agency_vacancy_monthly_outreach(text, date, boolean, text) TO service_role;

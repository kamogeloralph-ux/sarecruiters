-- Manager-safe vacancy performance summaries.
-- This RPC returns aggregate counts only; it never returns visitor identifiers,
-- applicant identities, or contact details. The Worker verifies the manager link
-- and invokes this function with its service-role key.

BEGIN;

CREATE OR REPLACE FUNCTION public.manager_vacancy_analytics(
  p_token text,
  p_kind text
)
RETURNS TABLE (
  vacancy_id text,
  apply_clicks bigint,
  self_reported_applications bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id text;
BEGIN
  -- Current manager tokens are 43-character base64url strings. Keep a broad
  -- lower/upper bound to tolerate legacy tokens while rejecting empty/huge input.
  IF p_token IS NULL OR length(p_token) < 24 OR length(p_token) > 256 THEN
    RETURN;
  END IF;

  IF p_kind = 'agency' THEN
    SELECT a.id INTO v_owner_id
      FROM public.agencies AS a
      WHERE a.manage_token = p_token
      LIMIT 1;
  ELSIF p_kind = 'employer' THEN
    SELECT e.id INTO v_owner_id
      FROM public.employers AS e
      WHERE e.manage_token = p_token
      LIMIT 1;
  ELSE
    RETURN;
  END IF;

  IF v_owner_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      v.id::text AS vacancy_id,
      count(*) FILTER (WHERE ae.event_name = 'vacancy_apply_click')::bigint AS apply_clicks,
      count(*) FILTER (WHERE ae.event_name = 'vacancy_application_reported')::bigint AS self_reported_applications
    FROM public.vacancies AS v
    LEFT JOIN public.analytics_events AS ae
      ON ae.entity_type = 'vacancy'
      AND ae.entity_id = v.id::text
      AND ae.created_at >= now() - interval '30 days'
      AND ae.event_name IN ('vacancy_apply_click', 'vacancy_application_reported')
    WHERE (p_kind = 'agency' AND v.agency_id = v_owner_id)
       OR (p_kind = 'employer' AND v.employer_id = v_owner_id)
    GROUP BY v.id
    ORDER BY v.id;
END;
$$;

COMMENT ON FUNCTION public.manager_vacancy_analytics(text, text) IS
  'Returns 30-day aggregate apply-click and self-reported application counts for vacancies owned by the supplied manager token. Service-role only; no visitor identifiers are returned.';

REVOKE ALL ON FUNCTION public.manager_vacancy_analytics(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_vacancy_analytics(text, text)
  TO service_role;

COMMIT;

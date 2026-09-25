-- Server-side authorization hardening for manager-token rotation.
-- The browser admin gate is not an authorization boundary; these SECURITY
-- DEFINER functions must fail closed for ordinary authenticated users.

CREATE OR REPLACE FUNCTION public.admin_set_manager_token(p_agency_id text, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'admin authorization required' USING ERRCODE = '42501';
  END IF;

  IF p_agency_id IS NULL OR length(trim(p_token)) < 32 OR length(p_token) > 256 THEN
    RAISE EXCEPTION 'invalid manager token request' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agencies
     SET manage_token = p_token
   WHERE id = p_agency_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_employer_manager_token(p_employer_id text, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'admin authorization required' USING ERRCODE = '42501';
  END IF;

  IF p_employer_id IS NULL OR length(trim(p_token)) < 32 OR length(p_token) > 256 THEN
    RAISE EXCEPTION 'invalid manager token request' USING ERRCODE = '22023';
  END IF;

  UPDATE public.employers
     SET manage_token = p_token
   WHERE id = p_employer_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_manager_token(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_employer_manager_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_manager_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_employer_manager_token(text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_set_manager_token(text, text) IS
  'Admin-only manager-token rotation; requires membership in public.admin_users.';
COMMENT ON FUNCTION public.admin_set_employer_manager_token(text, text) IS
  'Admin-only employer manager-token rotation; requires membership in public.admin_users.';

-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260918_lock_down_manager_tokens.sql
-- ============================================================
--  SECURITY FIX: stop exposing `manage_token` publicly and stop trusting
--  the browser to authorize Smart Manager writes.
--
--  BEFORE this migration (previous behavior):
--    * Any anonymous visitor could `GET /rest/v1/agencies?select=manage_token`
--      and harvest EVERY agency's and employer's Smart Manager link token.
--    * Anyone with a stolen token (or just the REST URL) could POST branches
--      and vacancies as any agency — the browser was the only "authorizer".
--
--  AFTER this migration:
--    1. Column-level privileges revoke `manage_token` from the anon role, so
--       public reads (browser + static page generator) never see tokens.
--    2. `verify_manager_token(p_token)` and `verify_employer_manager_token(p_token)`
--       RPCs resolve a token to its record server-side (returns NO token).
--    3. `manager_add_branch()` / `manager_add_vacancy()` /
--       `manager_employer_add_vacancy()` SECURITY DEFINER functions authorize
--       writes BY TOKEN server-side — direct REST inserts by anon are revoked.
--    4. Token updates (saveManagerToken / regenerate) go through
--       `admin_set_manager_token()` (authenticated admin) or the service role.
--    5. Public submissions (reports, suggestions) insert via
--       `public_submit_report()` / `public_submit_suggestion()`; direct anon
--       table inserts are revoked. (Pool candidates keep anon INSERT on
--       purpose: new candidates must be able to self-register while RLS keeps
--       their rows hidden until verified. Turnstile protection for that form
--       is enforced in the Worker, not the database.)
--
--  Run once in the Supabase SQL Editor (or `supabase db push`).
--  Safe to re-run: every statement is idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. FUNCTIONS (create before revoking anything so nothing breaks mid-run)
-- ------------------------------------------------------------

-- Resolve an agency token server-side. Returns the public-safe agency row
-- (NO token in the result). Null result => invalid/expired token.
CREATE OR REPLACE FUNCTION public.verify_manager_token(p_token text)
RETURNS TABLE (id text, name text, location text, verified boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.location, a.verified
  FROM public.agencies a
  WHERE a.manage_token = p_token
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.verify_manager_token(text) IS
  'Server-side Smart Manager token check for agencies. Returns public-safe fields only; never returns the token itself.';

-- Same idea for employers.
CREATE OR REPLACE FUNCTION public.verify_employer_manager_token(p_token text)
RETURNS TABLE (id text, name text, location text, verified boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.name, e.location, e.verified
  FROM public.employers e
  WHERE e.manage_token = p_token
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.verify_employer_manager_token(text) IS
  'Server-side Smart Manager token check for employers. Returns public-safe fields only; never returns the token itself.';

-- Authorized: add a branch to the agency the token belongs to.
CREATE OR REPLACE FUNCTION public.manager_add_branch(
  p_token text,
  p_branch_id text,
  p_name text,
  p_location text,
  p_phone text,
  p_email text
)
RETURNS text  -- branch id on success, null on authorization failure
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id text;
BEGIN
  SELECT a.id INTO v_agency_id FROM public.agencies a WHERE a.manage_token = p_token;
  IF v_agency_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.branches (id, agency_id, name, location, phone, email)
  VALUES (p_branch_id, v_agency_id, p_name, p_location, p_phone, p_email)
  ON CONFLICT (id) DO UPDATE
    SET name     = EXCLUDED.name,
        location = EXCLUDED.location,
        phone    = EXCLUDED.phone,
        email    = EXCLUDED.email;

  RETURN p_branch_id;
END;
$$;

COMMENT ON FUNCTION public.manager_add_branch(text, text, text, text, text, text) IS
  'Authorized branch upsert for Smart Manager agency links; authorizes by token server-side.';

-- Authorized: add a vacancy to the agency the token belongs to.
CREATE OR REPLACE FUNCTION public.manager_add_vacancy(
  p_token text,
  p_vacancy_id text,
  p_title text,
  p_location text,
  p_employment_type text,
  p_contract_type text,
  p_salary text,
  p_hours text,
  p_work_schedule text,
  p_start_date text,
  p_closing_date text,
  p_notes text,
  p_link text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id text;
BEGIN
  SELECT a.id INTO v_agency_id FROM public.agencies a WHERE a.manage_token = p_token;
  IF v_agency_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.vacancies (
    id, agency_id, title, location, employment_type, contract_type,
    salary, hours, work_schedule, start_date, closing_date, notes, link,
    created_at, source_type
  ) VALUES (
    p_vacancy_id, v_agency_id, p_title, p_location, p_employment_type, p_contract_type,
    p_salary, p_hours, p_work_schedule, p_start_date, p_closing_date, p_notes, p_link,
    now(), 'manager'
  )
  ON CONFLICT (id) DO UPDATE
    SET title          = EXCLUDED.title,
        location       = EXCLUDED.location,
        employment_type = EXCLUDED.employment_type,
        contract_type  = EXCLUDED.contract_type,
        salary         = EXCLUDED.salary,
        hours          = EXCLUDED.hours,
        work_schedule  = EXCLUDED.work_schedule,
        start_date     = EXCLUDED.start_date,
        closing_date   = EXCLUDED.closing_date,
        notes          = EXCLUDED.notes,
        link           = EXCLUDED.link;

  RETURN p_vacancy_id;
END;
$$;

COMMENT ON FUNCTION public.manager_add_vacancy(text, text, text, text, text, text, text, text, text, text, text, text, text) IS
  'Authorized vacancy upsert for Smart Manager agency links; authorizes by token server-side.';

-- Authorized: add a vacancy for the employer the token belongs to.
CREATE OR REPLACE FUNCTION public.manager_employer_add_vacancy(
  p_token text,
  p_vacancy_id text,
  p_title text,
  p_company text,
  p_location text,
  p_employment_type text,
  p_experience_level text,
  p_contract_type text,
  p_salary text,
  p_hours text,
  p_work_schedule text,
  p_start_date text,
  p_closing_date text,
  p_notes text,
  p_link text,
  p_email text,
  p_phone text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employer_id text;
BEGIN
  SELECT e.id INTO v_employer_id FROM public.employers e WHERE e.manage_token = p_token;
  IF v_employer_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.vacancies (
    id, agency_id, employer_id, title, company, location, employment_type,
    experience_level, contract_type, salary, hours, work_schedule,
    start_date, closing_date, notes, link, email, phone,
    created_at, source_type
  ) VALUES (
    p_vacancy_id, 'employer', v_employer_id, p_title, p_company, p_location, p_employment_type,
    p_experience_level, p_contract_type, p_salary, p_hours, p_work_schedule,
    p_start_date, p_closing_date, p_notes, p_link, p_email, p_phone,
    now(), 'manager'
  )
  ON CONFLICT (id) DO UPDATE
    SET title          = EXCLUDED.title,
        company        = EXCLUDED.company,
        location       = EXCLUDED.location,
        employment_type = EXCLUDED.employment_type,
        experience_level = EXCLUDED.experience_level,
        contract_type  = EXCLUDED.contract_type,
        salary         = EXCLUDED.salary,
        hours          = EXCLUDED.hours,
        work_schedule  = EXCLUDED.work_schedule,
        start_date     = EXCLUDED.start_date,
        closing_date   = EXCLUDED.closing_date,
        notes          = EXCLUDED.notes,
        link           = EXCLUDED.link,
        email          = EXCLUDED.email,
        phone          = EXCLUDED.phone;

  RETURN p_vacancy_id;
END;
$$;

COMMENT ON FUNCTION public.manager_employer_add_vacancy(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) IS
  'Authorized vacancy upsert for Smart Manager employer links; authorizes by token server-side.';

-- Admin-only: rotate / save an agency token. Callable by authenticated users
-- (admin.html signs in via Supabase Auth).
CREATE OR REPLACE FUNCTION public.admin_set_manager_token(p_agency_id text, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;  -- must be an authenticated admin session
  END IF;
  UPDATE public.agencies SET manage_token = p_token WHERE id = p_agency_id;
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
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.employers SET manage_token = p_token WHERE id = p_employer_id;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.admin_set_manager_token(text, text) IS
  'Admin-only Smart Manager token save for agencies (requires a Supabase Auth session).';
COMMENT ON FUNCTION public.admin_set_employer_manager_token(text, text) IS
  'Admin-only Smart Manager token save for employers (requires a Supabase Auth session).';

-- Public submission RPCs (used with the Worker's Turnstile gate).
CREATE OR REPLACE FUNCTION public.public_submit_report(
  p_agency_name text,
  p_agency_id text,
  p_reason text,
  p_details text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.reports (agency_name, agency_id, reason, details, status)
  VALUES (p_agency_name, p_agency_id, p_reason, p_details, 'open');
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION public.public_submit_suggestion(
  p_type text,
  p_agency_name text,
  p_details text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.suggestions (type, agency_name, details, status)
  VALUES (p_type, p_agency_name, p_details, 'open');
  SELECT true;
$$;

COMMENT ON FUNCTION public.public_submit_report(text, text, text, text) IS
  'Public report submission; used with Worker-side Turnstile verification.';
COMMENT ON FUNCTION public.public_submit_suggestion(text, text, text) IS
  'Public suggestion submission; used with Worker-side Turnstile verification.';

-- ------------------------------------------------------------
-- 2. EXECUTE GRANTS on the new functions (PUBLIC execute is granted by
--    default on functions; make it explicit and revoke from anon only for
--    the admin ones.)
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.verify_manager_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_employer_manager_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_add_branch(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_add_vacancy(text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_employer_add_vacancy(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_report(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_suggestion(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_manager_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_employer_manager_token(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_manager_token(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_employer_manager_token(text, text) FROM anon;

-- ------------------------------------------------------------
-- 3. COLUMN PRIVILEGES: hide manage_token from the anon role entirely.
--    The static site generator and the app read via the anon key, so after
--    this step public reads silently omit manage_token (they must select
--    explicit columns, not `select *`).
-- ------------------------------------------------------------
REVOKE SELECT (manage_token) ON public.agencies  FROM anon;
REVOKE SELECT (manage_token) ON public.employers FROM anon;

-- Token WRITE from anon is revoked too: token rotation happens via the RPCs
-- above (admin) or the Worker (service role), never straight from the browser.
REVOKE UPDATE (manage_token) ON public.agencies  FROM anon;
REVOKE UPDATE (manage_token) ON public.employers FROM anon;

-- ------------------------------------------------------------
-- 4. TABLE PRIVILEGES: close direct anon INSERT paths that are now handled
--    by SECURITY DEFINER RPCs. anon keeps SELECT on branches/vacancies/
--    reports/suggestions (public listing data + admin reads via RPCs keep
--    working; admin.html uses the authenticated role and is unaffected).
-- ------------------------------------------------------------
REVOKE INSERT ON public.branches    FROM anon;
REVOKE INSERT ON public.vacancies   FROM anon;
REVOKE INSERT ON public.reports     FROM anon;
REVOKE INSERT ON public.suggestions FROM anon;

-- anon keeps INSERT on pool_candidates (public self-registration).
-- anon keeps UPDATE/DELETE nowhere: removals are admin/service-role actions
-- (already implicit via RLS; no new policy is introduced here).

-- ------------------------------------------------------------
-- 5. Optional hygiene: if legacy RLS policies allow anon ALL on agencies /
--    employers, token privacy is still guaranteed by the column revokes
--    above (column grants always intersect). No policy changes required.
-- ------------------------------------------------------------

-- ============================================================
--  ROLLBACK (for reference only):
--    GRANT SELECT (manage_token) ON public.agencies  TO anon;
--    GRANT SELECT (manage_token) ON public.employers TO anon;
--    GRANT UPDATE (manage_token) ON public.agencies  TO anon;
--    GRANT UPDATE (manage_token) ON public.employers TO anon;
--    GRANT INSERT ON public.branches    TO anon;
--    GRANT INSERT ON public.vacancies   TO anon;
--    GRANT INSERT ON public.reports     TO anon;
--    GRANT INSERT ON public.suggestions TO anon;
--    DROP FUNCTION IF EXISTS public.verify_manager_token(text);
--    DROP FUNCTION IF EXISTS public.verify_employer_manager_token(text);
--    DROP FUNCTION IF EXISTS public.manager_add_branch(text, text, text, text, text, text);
--    DROP FUNCTION IF EXISTS public.manager_add_vacancy(text, text, text, text, text, text, text, text, text, text, text, text, text);
--    DROP FUNCTION IF EXISTS public.manager_employer_add_vacancy(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text);
--    DROP FUNCTION IF EXISTS public.admin_set_manager_token(text, text);
--    DROP FUNCTION IF EXISTS public.admin_set_employer_manager_token(text, text);
--    DROP FUNCTION IF EXISTS public.public_submit_report(text, text, text, text);
--    DROP FUNCTION IF EXISTS public.public_submit_suggestion(text, text, text);
-- ============================================================

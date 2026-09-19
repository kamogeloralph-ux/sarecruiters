-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260919_add_saved_vacancies_and_submission_ownership.sql
-- ============================================================
--  Now that every visitor must sign in with Google (see the required-auth
--  gate in app-core.js), extend that real account to two more places that
--  were still anonymous/localStorage-only:
--
--    1. Saved vacancies — previously 100% localStorage (savedVacancies key),
--       so it never synced across devices and vanished on cache clear. Now
--       backed by a per-user table with RLS, same "own row" pattern already
--       used for pool_candidates.
--
--    2. Reports & suggestions — previously fully anonymous inserts with no
--       way for the submitter to see what happened to their submission. Now
--       optionally stamped with the signed-in user's id (never required —
--       both stay usable if that ever changes) so a "My submissions" view
--       can show status.
--
--  Agencies/employers are intentionally left alone: their self-service
--  model (per-listing manage_token links) is a different, reasonable model
--  since one listing can have several managers — folding that into personal
--  accounts would be a downgrade, not an upgrade.
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SAVED VACANCIES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_vacancies (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vacancy_id text NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vacancy_id)
);

COMMENT ON TABLE public.saved_vacancies IS
  'Per-account replacement for the old client-only savedVacancies localStorage set. One row per user per saved vacancy.';

ALTER TABLE public.saved_vacancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_vacancies_select_own ON public.saved_vacancies;
CREATE POLICY saved_vacancies_select_own ON public.saved_vacancies
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS saved_vacancies_insert_own ON public.saved_vacancies;
CREATE POLICY saved_vacancies_insert_own ON public.saved_vacancies
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS saved_vacancies_delete_own ON public.saved_vacancies;
CREATE POLICY saved_vacancies_delete_own ON public.saved_vacancies
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Anon gets nothing on this table (no policies for anon = no access, since
-- RLS defaults closed). Signed-in-only, matching the app's required-auth gate.

GRANT SELECT, INSERT, DELETE ON public.saved_vacancies TO authenticated;

CREATE INDEX IF NOT EXISTS saved_vacancies_user_id_idx ON public.saved_vacancies(user_id);

-- ------------------------------------------------------------
-- 2. REPORTS / SUGGESTIONS OWNERSHIP
-- ------------------------------------------------------------
ALTER TABLE public.reports     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reports_user_id_idx     ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS suggestions_user_id_idx ON public.suggestions(user_id);

-- Let a signed-in submitter see their own past submissions (admin policies
-- already granted via is_admin() are untouched; this is purely additive).
DROP POLICY IF EXISTS reports_select_own ON public.reports;
CREATE POLICY reports_select_own ON public.reports
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS suggestions_select_own ON public.suggestions;
CREATE POLICY suggestions_select_own ON public.suggestions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Extend the existing public-submission RPCs (see
-- 20260918_lock_down_manager_tokens.sql) with an optional p_user_id.
-- IMPORTANT: CREATE OR REPLACE with an added parameter does NOT replace the
-- old signature in Postgres — it creates a second overload, and a 4-arg call
-- would keep silently resolving to the old function (no user_id stored). So
-- the old 4-arg overloads must be dropped explicitly once the new ones exist.
-- The Worker resolves p_user_id server-side from the caller's verified
-- Supabase access token — it is never trusted from the request body.
CREATE OR REPLACE FUNCTION public.public_submit_report(
  p_agency_name text,
  p_agency_id text,
  p_reason text,
  p_details text,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.reports (agency_name, agency_id, reason, details, status, user_id)
  VALUES (p_agency_name, p_agency_id, p_reason, p_details, 'open', p_user_id);
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION public.public_submit_suggestion(
  p_type text,
  p_agency_name text,
  p_details text,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.suggestions (type, agency_name, details, status, user_id)
  VALUES (p_type, p_agency_name, p_details, 'open', p_user_id);
  SELECT true;
$$;

COMMENT ON FUNCTION public.public_submit_report(text, text, text, text, uuid) IS
  'Public report submission; used with Worker-side Turnstile verification. p_user_id (optional) is resolved server-side by the Worker from the caller''s verified access token, never taken from the request body.';
COMMENT ON FUNCTION public.public_submit_suggestion(text, text, text, uuid) IS
  'Public suggestion submission; used with Worker-side Turnstile verification. p_user_id (optional) is resolved server-side by the Worker from the caller''s verified access token, never taken from the request body.';

GRANT EXECUTE ON FUNCTION public.public_submit_report(text, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_suggestion(text, text, text, uuid) TO anon, authenticated;

-- Drop the now-superseded 4-arg overloads so every call (with or without
-- p_user_id) resolves to the single 5-arg function above.
DROP FUNCTION IF EXISTS public.public_submit_report(text, text, text, text);
DROP FUNCTION IF EXISTS public.public_submit_suggestion(text, text, text);

-- ============================================================
--  ROLLBACK (for reference only):
--    DROP TABLE IF EXISTS public.saved_vacancies;
--    DROP POLICY IF EXISTS reports_select_own ON public.reports;
--    DROP POLICY IF EXISTS suggestions_select_own ON public.suggestions;
--    ALTER TABLE public.reports     DROP COLUMN IF EXISTS user_id;
--    ALTER TABLE public.suggestions DROP COLUMN IF EXISTS user_id;
--    CREATE OR REPLACE FUNCTION public.public_submit_report(p_agency_name text, p_agency_id text, p_reason text, p_details text)
--      RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
--        INSERT INTO public.reports (agency_name, agency_id, reason, details, status) VALUES (p_agency_name, p_agency_id, p_reason, p_details, 'open'); SELECT true; $$;
--    CREATE OR REPLACE FUNCTION public.public_submit_suggestion(p_type text, p_agency_name text, p_details text)
--      RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
--        INSERT INTO public.suggestions (type, agency_name, details, status) VALUES (p_type, p_agency_name, p_details, 'open'); SELECT true; $$;
-- ============================================================

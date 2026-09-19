-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260919b_fix_reports_id_default.sql
-- ============================================================
--  BUG THIS FIXES:
--    Every "Report wrong info" submission has been failing at the database
--    since the lockdown migration (20260918) moved inserts into the
--    public_submit_report RPC. That RPC inserts without an explicit id,
--    expecting reports.id to have a default — but unlike suggestions.id,
--    reports.id was created without one. Every insert failed with:
--      "null value in column \"id\" of relation \"reports\"
--       violates not-null constraint" (23502)
--    The Worker returned 502, the client's direct-insert fallback hit the
--    same error, and the app fell back to a localStorage-only backup —
--    which "My submissions" then displayed forever as "Pending" while the
--    admin console showed nothing at all.
--
--  FIX: give reports.id a uuid default (gen_random_uuid(), available in
--  Supabase Postgres out of the box). Also deduplicates probe/junk rows
--  if the RPC had ever partially succeeded, and re-grants execute so the
--  fixed function signatures stay callable by anon + authenticated.
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================

-- 1. The actual fix: make reports.id self-generating, matching suggestions.id.
ALTER TABLE public.reports
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2. If any junk/probe rows ever landed (e.g. from testing the RPC by
--    hand), they would show as "probe" entries in the admin console.
--    No-op unless they exist.
DELETE FROM public.reports
WHERE agency_name IN ('probe', 'probe2', 'test')
  AND (details IS NULL OR details IN ('probe', 'probe2', 'test', '-'));

-- 3. Re-assert the fixed RPC signatures (5-arg with optional ownership,
--    per 20260919_add_saved_vacancies_and_submission_ownership.sql) and
--    their execute grants. CREATE OR REPLACE keeps the existing owner.
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

-- 4. Keep the old 4-arg overloads from shadowing these signatures.
DROP FUNCTION IF EXISTS public.public_submit_report(text, text, text, text);
DROP FUNCTION IF EXISTS public.public_submit_suggestion(text, text, text);

GRANT EXECUTE ON FUNCTION public.public_submit_report(text, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_suggestion(text, text, text, uuid) TO anon, authenticated;

-- ============================================================
--  VERIFICATION (run in the Supabase SQL editor after applying):
--    SELECT column_default FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='reports' AND column_name='id';
--    -- expect: gen_random_uuid()
--
--    SELECT public.public_submit_report('Verification test', null, 'Other', 'id-default check', null);
--    SELECT public.public_submit_suggestion('suggestion', 'Verification test', 'id-default check', null);
--    SELECT id, agency_name FROM public.reports ORDER BY created_at DESC LIMIT 1;
--    -- both calls must return true, then delete the verification rows:
--    DELETE FROM public.reports WHERE agency_name='Verification test';
--    DELETE FROM public.suggestions WHERE agency_name='Verification test';
-- ============================================================

-- ============================================================
--  ROLLBACK (for reference only):
--    ALTER TABLE public.reports ALTER COLUMN id DROP DEFAULT;
-- ============================================================

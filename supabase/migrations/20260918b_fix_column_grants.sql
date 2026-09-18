-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260918b_fix_column_grants.sql
-- ============================================================
--  FIX for 20260918_lock_down_manager_tokens.sql: that migration used
--  column-level REVOKEs (REVOKE SELECT (manage_token) ...), which are a
--  NO-OP while a role still holds the TABLE-level privilege (effective
--  access = table-level GRANT ∪ column-level GRANT). Supabase grants
--  table-level SELECT/INSERT/UPDATE to `anon` by default, so manage_token
--  remained publicly readable/writable after part 1 ran.
--
--  The correct pattern: revoke the TABLE-level privilege from anon, then
--  re-grant an explicit COLUMN list that excludes manage_token.
--
--  Who is NOT affected:
--   * admin.html — signs in via Supabase Auth => `authenticated` role,
--     which keeps its default table-level grants (full read/write).
--   * GitHub Actions scrapers — use SUPABASE_SERVICE_ROLE_KEY.
--   * The Worker — talks to the DB through SECURITY DEFINER RPCs.
--   * The public app — reads explicit column lists that match the grants
--     below (app-data.js, Cloudflare-worker/worker.js, generate-pages.js).
--
--  Side effect: anon `select=*` on agencies/employers now fails (the star
--  includes a column anon can't read). Every code path in this repo uses
--  explicit column lists, so nothing breaks.
--
--  Also removes the test suggestion row inserted while probing the RPCs
--  during verification (harmless but pointless).
--
--  Idempotent: safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. agencies: anon may read/write everything EXCEPT manage_token
--    (live columns: id,name,website,contact,email,location,cvpref,photo,
--     created_at,companies,address,submitted_by,verified,trades,
--     manage_token,pnet_url,last_scraped_at)
-- ------------------------------------------------------------
REVOKE SELECT ON public.agencies FROM anon;
GRANT SELECT (
  id, name, website, contact, email, location, cvpref, photo,
  created_at, companies, address, submitted_by, verified, trades,
  pnet_url, last_scraped_at
) ON public.agencies TO anon;

REVOKE INSERT ON public.agencies FROM anon;
GRANT INSERT (
  id, name, website, contact, email, location, cvpref, photo,
  created_at, companies, address, submitted_by, verified, trades,
  pnet_url, last_scraped_at
) ON public.agencies TO anon;

REVOKE UPDATE ON public.agencies FROM anon;
GRANT UPDATE (
  id, name, website, contact, email, location, cvpref, photo,
  created_at, companies, address, submitted_by, verified, trades,
  pnet_url, last_scraped_at
) ON public.agencies TO anon;

-- ------------------------------------------------------------
-- 2. employers: same pattern
--    (live columns: id,name,industry,website,contact,email,location,
--     address,photo,verified,manage_token,created_at)
--    anon INSERT must keep working: public employer self-registration
--    (saveEmployer -> upsertEmployer) writes these non-token columns.
-- ------------------------------------------------------------
REVOKE SELECT ON public.employers FROM anon;
GRANT SELECT (
  id, name, industry, website, contact, email, location,
  address, photo, verified, created_at
) ON public.employers TO anon;

REVOKE INSERT ON public.employers FROM anon;
GRANT INSERT (
  id, name, industry, website, contact, email, location,
  address, photo, verified, created_at
) ON public.employers TO anon;

REVOKE UPDATE ON public.employers FROM anon;
GRANT UPDATE (
  id, name, industry, website, contact, email, location,
  address, photo, verified, created_at
) ON public.employers TO anon;

-- ------------------------------------------------------------
-- 3. Cleanup: remove the probe/test suggestion row created while
--    verifying public_submit_suggestion during the lockdown rollout.
--    (No-ops if already deleted.)
-- ------------------------------------------------------------
DELETE FROM public.suggestions WHERE agency_name = 'x' AND details = 'x';

-- ============================================================
--  ROLLBACK (for reference only):
--    GRANT SELECT, INSERT, UPDATE, DELETE ON public.agencies  TO anon;
--    GRANT SELECT, INSERT, UPDATE, DELETE ON public.employers TO anon;
--  (this restores the pre-lockdown exposure of manage_token — do not
--   run unless abandoning the token lockdown entirely)
-- ============================================================

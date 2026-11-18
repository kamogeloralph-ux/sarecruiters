-- ============================================================
--  SA RECRUITERS — supabase/migrations/20261117_cv_box_partner_access.sql
-- ============================================================
--  Partner agencies get access to the CV Box from their private Manager Link.
--
--  How access works:
--    * An admin switches an agency to "CV Box partner" (agencies.cv_box_partner).
--      Agencies earn this by sending their candidates to submit their CV in the
--      SA Recruiters CV Box.
--    * The Manager Link token only proves WHICH agency is asking. The Worker
--      then checks the partner flag with the service role before returning any
--      candidate data. A valid manager token alone never exposes CVs.
--    * Candidate contact details and CV files are returned one candidate at a
--      time and every reveal/download is written to cv_box_partner_access_log
--      (POPIA accountability + daily cap enforcement in the Worker).
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================

ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS cv_box_partner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cv_box_partner_since timestamptz;

COMMENT ON COLUMN public.agencies.cv_box_partner IS
  'True when the agency is an approved SA Recruiters CV Box partner and may view candidate contact details and CV files from its Manager Link.';

-- ---------- access log ----------
CREATE TABLE IF NOT EXISTS public.cv_box_partner_access_log (
  id           bigserial PRIMARY KEY,
  agency_id    text NOT NULL,
  agency_name  text,
  candidate_id text NOT NULL,
  action       text NOT NULL,                 -- 'contact' | 'download'
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cv_box_partner_access_log DROP CONSTRAINT IF EXISTS cv_box_partner_access_log_action_check;
ALTER TABLE public.cv_box_partner_access_log ADD CONSTRAINT cv_box_partner_access_log_action_check
  CHECK (action IN ('contact','download'));

CREATE INDEX IF NOT EXISTS cv_box_partner_access_log_agency_idx
  ON public.cv_box_partner_access_log (agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cv_box_partner_access_log_candidate_idx
  ON public.cv_box_partner_access_log (candidate_id, created_at DESC);

-- Service role only: RLS on, no policies, nothing granted to anon/authenticated.
ALTER TABLE public.cv_box_partner_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cv_box_partner_access_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cv_box_partner_access_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cv_box_partner_access_log_id_seq TO service_role;

COMMENT ON TABLE public.cv_box_partner_access_log IS
  'Who (which partner agency) viewed which candidate contact details or downloaded which CV, and when. Written by the Worker only.';

-- ---------- token -> partner status (service role only) ----------
-- The Manager Link token identifies the agency; this returns the partner flag.
CREATE OR REPLACE FUNCTION public.manager_cv_box_partner(p_token text)
RETURNS TABLE (id text, name text, cv_box_partner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, coalesce(a.cv_box_partner, false)
  FROM public.agencies a
  WHERE a.manage_token = p_token AND coalesce(p_token, '') <> ''
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.manager_cv_box_partner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_cv_box_partner(text) TO service_role;

-- ============================================================
--  VERIFICATION (SQL editor, replace the placeholders):
--    UPDATE public.agencies SET cv_box_partner = true, cv_box_partner_since = now() WHERE id = '<agency id>';
--    SELECT * FROM public.manager_cv_box_partner('<that agency''s manage_token>');
--    SELECT * FROM public.cv_box_partner_access_log ORDER BY created_at DESC LIMIT 20;
--
--  ROLLBACK (reference only):
--    DROP FUNCTION IF EXISTS public.manager_cv_box_partner(text);
--    DROP TABLE IF EXISTS public.cv_box_partner_access_log;
--    ALTER TABLE public.agencies DROP COLUMN IF EXISTS cv_box_partner, DROP COLUMN IF EXISTS cv_box_partner_since;
-- ============================================================

-- ============================================================
--  SA RECRUITERS — supabase/migrations/20261014_job_seeker_requests.sql
-- ============================================================
--  "Looking for work?" quick-intake. People who message the admin directly
--  ("I hold a degree, I'm available immediately, may I send my CV?") can now
--  submit one short, structured form instead. Admin triages them in
--  Submissions -> Job seekers and can convert one into a Talent Pool profile.
--
--  Same lockdown pattern as job_post_enquiries: no direct anon INSERT/SELECT;
--  the only write path is public_submit_job_seeker(), called by the Worker
--  after Cloudflare Turnstile verification. Admin reads/writes use the Worker
--  (service role).
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_seeker_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  phone           text,
  email           text,
  location        text,
  looking_for     text,
  qualification   text,
  work_status     text,          -- 'citizen_pr' | 'work_visa' | 'unsure'
  availability    text,
  message         text,
  cv_link         text,
  consent         boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'new',   -- new | contacted | added | closed
  talent_pool_id  text,          -- set when converted to a Talent Pool profile
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_seeker_requests_contact_chk CHECK (
    coalesce(nullif(trim(phone), ''), nullif(trim(email), '')) IS NOT NULL
  )
);

COMMENT ON TABLE public.job_seeker_requests IS
  'Public "Looking for work?" intake. Contains personal information (POPIA): consent is recorded per row. Admin-only reads via the Worker.';

ALTER TABLE public.job_seeker_requests ENABLE ROW LEVEL SECURITY;

-- A signed-in submitter may see their own rows; nobody else can read directly.
DROP POLICY IF EXISTS job_seeker_requests_select_own ON public.job_seeker_requests;
CREATE POLICY job_seeker_requests_select_own ON public.job_seeker_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.job_seeker_requests FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS job_seeker_requests_created_at_idx ON public.job_seeker_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS job_seeker_requests_status_idx     ON public.job_seeker_requests(status);

CREATE OR REPLACE FUNCTION public.public_submit_job_seeker(
  p_full_name     text,
  p_phone         text,
  p_email         text,
  p_location      text,
  p_looking_for   text,
  p_qualification text,
  p_work_status   text,
  p_availability  text,
  p_message       text,
  p_cv_link       text,
  p_user_id       uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(trim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'name required';
  END IF;
  IF coalesce(nullif(trim(p_phone), ''), nullif(trim(p_email), '')) IS NULL THEN
    RAISE EXCEPTION 'phone or email required';
  END IF;
  -- consent is enforced by the Worker (it refuses the request without it), so
  -- every row that reaches this function was submitted with consent given.
  INSERT INTO public.job_seeker_requests
    (full_name, phone, email, location, looking_for, qualification, work_status,
     availability, message, cv_link, consent, status, user_id)
  VALUES
    (left(trim(p_full_name), 200), left(trim(coalesce(p_phone, '')), 60), left(trim(coalesce(p_email, '')), 200),
     left(trim(coalesce(p_location, '')), 200), left(trim(coalesce(p_looking_for, '')), 500),
     left(trim(coalesce(p_qualification, '')), 300),
     CASE WHEN p_work_status IN ('citizen_pr', 'work_visa', 'unsure') THEN p_work_status ELSE 'unsure' END,
     left(trim(coalesce(p_availability, '')), 100), left(trim(coalesce(p_message, '')), 4000),
     left(trim(coalesce(p_cv_link, '')), 500), true, 'new', p_user_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.public_submit_job_seeker(text, text, text, text, text, text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_submit_job_seeker(text, text, text, text, text, text, text, text, text, text, uuid) TO anon, authenticated;

-- ============================================================
--  VERIFICATION (Supabase SQL editor):
--    SELECT public.public_submit_job_seeker('Verification test', '0710000000', null, 'Pretoria',
--      'Admin / IT support', 'BSc IT', 'work_visa', 'Immediately', 'check', null, null);
--    SELECT id, full_name, status FROM public.job_seeker_requests ORDER BY created_at DESC LIMIT 1;
--    DELETE FROM public.job_seeker_requests WHERE full_name = 'Verification test';
--
--  ROLLBACK (reference only):
--    DROP FUNCTION IF EXISTS public.public_submit_job_seeker(text,text,text,text,text,text,text,text,text,text,uuid);
--    DROP TABLE IF EXISTS public.job_seeker_requests;
-- ============================================================

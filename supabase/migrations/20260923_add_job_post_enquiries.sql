-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260923_add_job_post_enquiries.sql
-- ============================================================
--  Adds a low-friction "Post a job" enquiry, matching the reference UX
--  (firstjobly.co.za/post-a-job): a public, ALWAYS-OPEN lead form that
--  captures the employer's details and the roles they want to fill, then
--  the admin follows up directly. This is deliberately separate from
--  public_register_employer() (20260921_employer_self_service_registration.sql)
--  and its own "closed" flag — that RPC still gates full self-service
--  listing creation, but a visitor should never be blocked from simply
--  telling us they want to post a job. See app-sheets.js openPostJobSheet()
--  / submitJobPostEnquiry() and Cloudflare-worker/worker.js
--  /api/submit/job-enquiry.
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_post_enquiries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      text NOT NULL,
  contact_person    text,
  work_email        text NOT NULL,
  phone             text,
  industry          text,
  positions_to_fill text,
  role_types        text[],
  additional_details text,
  website           text,
  status            text NOT NULL DEFAULT 'new',
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_post_enquiries IS
  'Public "Post a job" enquiries (firstjobly.co.za/post-a-job style lead form) — always open, unlike the gated employer self-registration RPC. Admin follows up by email/WhatsApp.';

ALTER TABLE public.job_post_enquiries ENABLE ROW LEVEL SECURITY;

-- Anon/authenticated may only INSERT (via the RPC below); no direct SELECT,
-- matching reports/suggestions. Admin reads happen with the service role
-- from admin.html, which bypasses RLS.
DROP POLICY IF EXISTS job_post_enquiries_select_own ON public.job_post_enquiries;
CREATE POLICY job_post_enquiries_select_own ON public.job_post_enquiries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS job_post_enquiries_created_at_idx ON public.job_post_enquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS job_post_enquiries_status_idx     ON public.job_post_enquiries(status);
CREATE INDEX IF NOT EXISTS job_post_enquiries_user_id_idx    ON public.job_post_enquiries(user_id);

-- p_user_id is resolved server-side by the Worker from the caller's verified
-- access token (verifiedUserId()) — never trusted from the request body.
-- No "closed" check, on purpose: this form is never gated.
CREATE OR REPLACE FUNCTION public.public_submit_job_enquiry(
  p_company_name       text,
  p_contact_person     text,
  p_work_email         text,
  p_phone              text,
  p_industry            text,
  p_positions_to_fill  text,
  p_role_types         text[],
  p_additional_details text,
  p_website            text,
  p_user_id            uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.job_post_enquiries
    (company_name, contact_person, work_email, phone, industry,
     positions_to_fill, role_types, additional_details, website, status, user_id)
  VALUES
    (p_company_name, p_contact_person, p_work_email, p_phone, p_industry,
     p_positions_to_fill, p_role_types, p_additional_details, p_website, 'new', p_user_id);
  SELECT true;
$$;

COMMENT ON FUNCTION public.public_submit_job_enquiry(text, text, text, text, text, text, text[], text, text, uuid) IS
  'Public, always-open "Post a job" enquiry submission (no self-registration gate). Used by both the app sheet and the static /post-a-job/ page, with Worker-side Turnstile verification.';

GRANT EXECUTE ON FUNCTION public.public_submit_job_enquiry(text, text, text, text, text, text, text[], text, text, uuid) TO anon, authenticated;

-- ============================================================
--  VERIFICATION (run in the Supabase SQL editor after applying):
--    SELECT public.public_submit_job_enquiry('Verification test', 'Jane HR',
--      'jane@example.co.za', null, 'Retail', '1-5', ARRAY['Internships'],
--      'Verification row', null, null);
--    SELECT id, company_name FROM public.job_post_enquiries ORDER BY created_at DESC LIMIT 1;
--    -- then delete the verification row:
--    DELETE FROM public.job_post_enquiries WHERE company_name = 'Verification test';
-- ============================================================

-- ============================================================
--  ROLLBACK (for reference only):
--    DROP FUNCTION IF EXISTS public.public_submit_job_enquiry(text, text, text, text, text, text, text[], text, text, uuid);
--    DROP TABLE IF EXISTS public.job_post_enquiries;
-- ============================================================

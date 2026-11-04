-- These SECURITY DEFINER RPCs are intended to be called only from the
-- authenticated Cloudflare Worker using SUPABASE_SERVICE_ROLE_KEY. Public
-- registration/submission flows go through Worker routes that validate input
-- and, where applicable, Turnstile and/or the caller's Supabase session.
-- Direct anon/authenticated EXECUTE grants bypass those controls; in particular
-- public_resend_employer_link returns an existing employer's manager token.
--
-- This changes function privileges only. It does not alter or delete rows.

BEGIN;

REVOKE ALL ON FUNCTION public.public_register_employer(text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_register_employer(text, text, text, text, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.public_resend_employer_link(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_resend_employer_link(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.public_submit_report(text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_report(text, text, text, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.public_submit_suggestion(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_suggestion(text, text, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.public_submit_job_enquiry(text, text, text, text, text, text, text[], text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_job_enquiry(text, text, text, text, text, text, text[], text, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.public_submit_job_seeker(text, text, text, text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_job_seeker(text, text, text, text, text, text, text, text, text, text, uuid)
  TO service_role;

COMMIT;

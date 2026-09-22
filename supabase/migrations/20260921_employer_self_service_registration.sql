-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260921_employer_self_service_registration.sql
-- ============================================================
--  Closes a gap left by 20260918_lock_down_manager_tokens.sql: that
--  migration correctly revoked anon SELECT/UPDATE on employers.manage_token,
--  but nothing replaced the old client-side upsertEmployer() insert with a
--  way for a FRESHLY self-registered employer to ever learn their own
--  token. They could submit "Register your company" but had no way back
--  into their listing afterwards.
--
--  public_register_employer(): SECURITY DEFINER insert that mints and
--  returns a fresh manage_token for the row it JUST created. This is safe
--  and does not reopen the token-harvesting hole the lockdown migration
--  closed: the token returned is for the row this same call inserted, not
--  read back out of the table for an arbitrary existing employer.
--
--  public_resend_employer_link(): looks a token up by the employer's own
--  registered contact email, for an employer who lost their link. Returns
--  the token to the CALLER only (the Worker, using the anon key
--  server-side) — never straight to the browser. The Worker emails it via
--  Resend and returns a generic {ok:true} to the client either way, so this
--  can't be used to probe which emails belong to registered employers.
--
--  Both RPCs are used with Worker-side Cloudflare Turnstile verification
--  (see Cloudflare-worker/worker.js), the same pattern already used for
--  public_submit_report / public_submit_suggestion.
--
--  Run once in the Supabase SQL Editor (or `supabase db push`).
--  Safe to re-run: every statement is idempotent (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_register_employer(
  p_id text,
  p_name text,
  p_industry text,
  p_website text,
  p_contact text,
  p_email text,
  p_location text,
  p_address text,
  p_photo text
)
RETURNS TABLE (employer_id text, manage_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open boolean;
  v_token text;
BEGIN
  SELECT (value = 'true') INTO v_open FROM public.app_settings WHERE key = 'public_employer_registration';
  IF v_open IS NOT TRUE THEN
    RAISE EXCEPTION 'Employer self-registration is currently closed.';
  END IF;
  IF p_id IS NULL OR btrim(p_id) = '' THEN
    RAISE EXCEPTION 'Missing employer id.';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Company name is required.';
  END IF;

  -- No pgcrypto dependency: two concatenated gen_random_uuid()s (built into
  -- Postgres 13+ core) give a 64-hex-char token, same entropy class as the
  -- rest of this app's manage_token values.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.employers (id, name, industry, website, contact, email, location, address, photo, verified, manage_token, created_at)
  VALUES (p_id, p_name, p_industry, p_website, p_contact, p_email, p_location, p_address, p_photo, false, v_token, now())
  ON CONFLICT (id) DO NOTHING;

  -- If the id somehow already existed, ON CONFLICT DO NOTHING means the
  -- token above was never actually written — fetch what's really there so
  -- the caller never gets told a token that isn't live.
  RETURN QUERY SELECT e.id, e.manage_token FROM public.employers e WHERE e.id = p_id;
END;
$$;

COMMENT ON FUNCTION public.public_register_employer(text, text, text, text, text, text, text, text, text) IS
  'Public self-service employer registration; mints and returns the new row''s own manage_token (never an existing row''s). Used with Worker-side Turnstile verification.';

CREATE OR REPLACE FUNCTION public.public_resend_employer_link(p_email text)
RETURNS TABLE (employer_id text, name text, manage_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.name, e.manage_token
  FROM public.employers e
  WHERE lower(e.email) = lower(btrim(p_email))
  ORDER BY e.created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.public_resend_employer_link(text) IS
  'Server-side lookup of an employer''s manage_token by their registered email, for the Worker to email back to them. Never returned directly to the browser.';

GRANT EXECUTE ON FUNCTION public.public_register_employer(text, text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_resend_employer_link(text) TO anon, authenticated;

-- ============================================================
--  ROLLBACK (for reference only):
--    DROP FUNCTION IF EXISTS public.public_register_employer(text, text, text, text, text, text, text, text, text);
--    DROP FUNCTION IF EXISTS public.public_resend_employer_link(text);
-- ============================================================

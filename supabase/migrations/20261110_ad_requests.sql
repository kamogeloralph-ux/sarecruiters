-- ============================================================
--  Free business advertising: public "Advertise with us" applications.
--  The /advertise/ page posts to the Worker (/api/submit/ad-request), which
--  stores the uploaded logo / business card in R2 and inserts one row here.
--  The table is NOT readable from the browser: RLS is on with no policies,
--  so only the Worker (service role) can read or write it. The admin page
--  reads it through /api/admin/auxiliary and downloads files through
--  /api/admin/ad-requests/<id>/file/<n>.
--  Idempotent: safe to run more than once.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ad_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name  text NOT NULL,
  contact_person text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  email          text NOT NULL DEFAULT '',
  website        text NOT NULL DEFAULT '',
  category       text NOT NULL DEFAULT '',
  province       text NOT NULL DEFAULT '',
  ad_message     text NOT NULL DEFAULT '',
  files          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,name,type,size,kind}]
  status         text NOT NULL DEFAULT 'new',
  admin_notes    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_requests DROP CONSTRAINT IF EXISTS ad_requests_status_check;
ALTER TABLE public.ad_requests ADD CONSTRAINT ad_requests_status_check
  CHECK (status IN ('new','in_progress','published','rejected'));

CREATE INDEX IF NOT EXISTS ad_requests_created_at_idx ON public.ad_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS ad_requests_status_idx ON public.ad_requests (status);

ALTER TABLE public.ad_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_requests FROM anon, authenticated;
COMMENT ON TABLE public.ad_requests IS 'Applications for free business advertising on SA Recruiters. Worker/service-role access only.';

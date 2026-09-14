-- Track fixed Pnet employer pages so scheduled jobs never need web discovery.
ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS pnet_url text,
  ADD COLUMN IF NOT EXISTS last_scraped_at timestamptz;

UPDATE public.agencies
SET pnet_url = CASE lower(name)
  WHEN 'michael page' THEN 'https://www.pnet.co.za/cmp/en/michael-page-11243/jobs'
  WHEN 'network recruitment' THEN 'https://www.pnet.co.za/cmp/en/network-recruitment-finance-corporate-11131/jobs'
  WHEN 'communicate recruitment' THEN 'https://www.pnet.co.za/cmp/en/communicate-finance-51185/jobs'
  ELSE pnet_url
END
WHERE lower(name) IN ('michael page', 'network recruitment', 'communicate recruitment');

CREATE INDEX IF NOT EXISTS agencies_pnet_rotation_idx
  ON public.agencies (last_scraped_at ASC NULLS FIRST, id)
  WHERE pnet_url IS NOT NULL;

COMMENT ON COLUMN public.agencies.pnet_url IS 'Fixed Pnet employer jobs page URL used by the GitHub Actions scraper.';
COMMENT ON COLUMN public.agencies.last_scraped_at IS 'Last successful attempt to parse this agency''s fixed Pnet page.';

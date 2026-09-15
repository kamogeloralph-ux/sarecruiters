-- Job Mail is now the active public job-board scraper. Keep the historical
-- Pnet columns for backward-compatible data retention; no scheduled workflow
-- reads or writes them anymore.
COMMENT ON COLUMN public.agencies.pnet_url IS 'Legacy Pnet employer URL retained for historical compatibility; no longer used by scheduled scrapers.';
COMMENT ON COLUMN public.agencies.last_scraped_at IS 'Legacy Pnet scrape timestamp retained for historical compatibility; no longer updated by scheduled scrapers.';

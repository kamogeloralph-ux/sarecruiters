-- Job Mail scraper retired (8,152 vacancies deleted from production on
-- 2026-09-16) and replaced by a generalized Pnet scraper that targets every
-- agency in the directory, not just 3 hardcoded ones. Re-activate the
-- pnet_url / last_scraped_at columns added in 20260914072349 and reverse
-- the "no longer used" notice left by 20260915130000.
COMMENT ON COLUMN public.agencies.pnet_url IS 'Agency''s Pnet company jobs page (e.g. https://www.pnet.co.za/cmp/en/{slug}-{id}/jobs). Auto-discovered and scraped by scripts/scrape-pnet.mjs; null until discovery finds a match.';
COMMENT ON COLUMN public.agencies.last_scraped_at IS 'Last time scripts/scrape-pnet.mjs scraped this agency''s Pnet page. Used to rotate scrape order (oldest first) across scheduled runs.';

DELETE FROM public.vacancies WHERE source_type = 'jobmail';

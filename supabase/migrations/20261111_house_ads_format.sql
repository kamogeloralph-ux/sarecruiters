-- ============================================================
--  House ads: every ad now plays as animated HTML5.
--  ad_format picks how the creative is built:
--    'auto' (default) - image_url is a picture (wrapped in an animated HTML5 document)
--                       or an .html creative (played as-is)
--    'card'           - image_url is a LOGO; the site builds an animated card from the
--                       ad's title (headline), message (tagline) and advertiser name.
--  Idempotent: safe to run more than once.
-- ============================================================
ALTER TABLE public.house_ads ADD COLUMN IF NOT EXISTS ad_format text NOT NULL DEFAULT 'auto';
ALTER TABLE public.house_ads DROP CONSTRAINT IF EXISTS house_ads_ad_format_check;
ALTER TABLE public.house_ads ADD CONSTRAINT house_ads_ad_format_check CHECK (ad_format IN ('auto','card'));
COMMENT ON COLUMN public.house_ads.ad_format IS 'auto = picture or .html creative; card = logo + text card built by the site (animated HTML5)';

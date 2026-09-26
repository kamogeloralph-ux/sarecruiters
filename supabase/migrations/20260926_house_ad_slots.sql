-- Separate top, middle, and bottom ad positions for the three public directories.
ALTER TABLE public.house_ads ADD COLUMN IF NOT EXISTS ad_slot text NOT NULL DEFAULT 'top';
ALTER TABLE public.house_ads DROP CONSTRAINT IF EXISTS house_ads_ad_slot_check;
ALTER TABLE public.house_ads ADD CONSTRAINT house_ads_ad_slot_check CHECK (ad_slot IN ('top','middle','bottom'));
CREATE INDEX IF NOT EXISTS house_ads_active_slot_idx ON public.house_ads (is_active, placement, ad_slot, starts_at, ends_at, sort_order);

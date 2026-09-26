-- Allow each ad to target any one, two, three, or all four directory screens.
ALTER TABLE public.house_ads ADD COLUMN IF NOT EXISTS target_screens text[] NOT NULL DEFAULT ARRAY['agencies','employers','candidates','posters'];
ALTER TABLE public.house_ads DROP CONSTRAINT IF EXISTS house_ads_target_screens_check;
ALTER TABLE public.house_ads ADD CONSTRAINT house_ads_target_screens_check CHECK (target_screens <@ ARRAY['agencies','employers','candidates','posters']::text[] AND cardinality(target_screens) > 0);
CREATE INDEX IF NOT EXISTS house_ads_target_screens_gin_idx ON public.house_ads USING gin (target_screens);

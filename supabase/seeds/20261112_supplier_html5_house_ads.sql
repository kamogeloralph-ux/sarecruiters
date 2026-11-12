-- Point the two supplied supplier banners at self-contained HTML5 creatives.
-- Existing destinations are preserved; only the creative and screen coverage are normalized.
UPDATE public.house_ads
SET image_url = 'https://media.sa-recruiters.co.za/assets/house-ads/jw-aluminium-1200x400.html',
    ad_format = 'auto',
    target_screens = ARRAY['agencies','employers','candidates','posters','home','public']::text[],
    updated_at = now()
WHERE lower(coalesce(advertiser_name, '')) LIKE '%jw%aluminium%';

UPDATE public.house_ads
SET image_url = 'https://media.sa-recruiters.co.za/assets/house-ads/rolaz-electrical-1200x400.html',
    ad_format = 'auto',
    target_screens = ARRAY['agencies','employers','candidates','posters','home','public']::text[],
    updated_at = now()
WHERE lower(coalesce(advertiser_name, '')) LIKE '%rolaz%electrical%';

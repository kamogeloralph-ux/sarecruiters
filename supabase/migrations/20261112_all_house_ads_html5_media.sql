-- Normalize every current first-party ad to a self-contained HTML5 creative on the media host.
-- The Worker/D1 mirror may lag briefly; its delivery code falls back to Supabase
-- whenever it sees a non-normalized creative.

UPDATE public.house_ads
SET image_url = 'https://media.sa-recruiters.co.za/assets/house-ads/ikhaya-events-legacy-1200x400.html',
    ad_format = 'auto',
    updated_at = now()
WHERE lower(coalesce(advertiser_name, '')) LIKE '%ikhaya%';

UPDATE public.house_ads
SET image_url = 'https://media.sa-recruiters.co.za/assets/house-ads/rolaz-electrical-1200x400.html',
    ad_format = 'auto',
    updated_at = now()
WHERE lower(coalesce(advertiser_name, '')) LIKE '%rolaz%electrical%';

UPDATE public.house_ads
SET image_url = 'https://media.sa-recruiters.co.za/assets/house-ads/jw-aluminium-1200x400.html',
    ad_format = 'auto',
    updated_at = now()
WHERE lower(coalesce(advertiser_name, '')) LIKE '%jw%aluminium%';

UPDATE public.house_ads
SET image_url = 'https://media.sa-recruiters.co.za/assets/house-ads/sa-recruiters-free-advertising-1200x400.html',
    ad_format = 'auto',
    updated_at = now()
WHERE lower(coalesce(advertiser_name, '')) LIKE '%free%advertis%'
   OR target_url LIKE '%/advertise/%';

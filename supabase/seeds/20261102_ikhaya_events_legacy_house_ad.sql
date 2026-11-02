-- Idempotent seed for the Ikhaya Events & Legacy in-house directory banner.
-- MP3/storage infrastructure is unrelated; this record points at the provided image asset.
INSERT INTO public.house_ads (
  advertiser_name,
  title,
  message,
  image_url,
  target_url,
  placement,
  target_screens,
  ad_slot,
  starts_at,
  ends_at,
  is_active,
  sort_order
)
SELECT
  'Ikhaya Events & Legacy',
  'Ikhaya Events & Legacy',
  'Digital invitations & programmes for life’s most important moments.',
  'https://files.manuscdn.com/user_upload_by_module/session_file/310519663926371118/jFlVCwHtqdqbLKRP.png',
  'https://ikhayahub.co.za/',
  'directories',
  ARRAY['agencies', 'employers', 'candidates', 'posters']::text[],
  'top',
  now(),
  NULL,
  TRUE,
  0
WHERE NOT EXISTS (
  SELECT 1
  FROM public.house_ads
  WHERE advertiser_name = 'Ikhaya Events & Legacy'
    AND image_url = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663926371118/jFlVCwHtqdqbLKRP.png'
  LIMIT 1
)
LIMIT 1;

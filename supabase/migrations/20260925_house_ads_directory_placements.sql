-- Move house ads into the compact directory surfaces.
ALTER TABLE public.house_ads DROP CONSTRAINT IF EXISTS house_ads_placement_check;
UPDATE public.house_ads SET placement = 'directories' WHERE placement IN ('home', 'vacancies', 'both');
ALTER TABLE public.house_ads ADD CONSTRAINT house_ads_placement_check
  CHECK (placement IN ('directories', 'agencies', 'employers', 'candidates'));

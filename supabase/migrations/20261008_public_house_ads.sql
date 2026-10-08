-- Allow managed house ads to appear on generated public SEO pages.
alter table public.house_ads drop constraint if exists house_ads_target_screens_check;
alter table public.house_ads add constraint house_ads_target_screens_check
  check (target_screens <@ array['agencies','employers','candidates','posters','home','public']::text[] and cardinality(target_screens) > 0);

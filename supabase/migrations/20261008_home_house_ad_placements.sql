-- Allow the same managed house-ad creative to appear on Home in top, middle,
-- or bottom positions, alongside existing directory placements.
alter table public.house_ads drop constraint if exists house_ads_target_screens_check;
alter table public.house_ads add constraint house_ads_target_screens_check
  check (target_screens <@ array['agencies','employers','candidates','posters','home']::text[] and cardinality(target_screens) > 0);

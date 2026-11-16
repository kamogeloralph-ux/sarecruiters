-- CV pictures replace vacancy posters.
-- Run once in the Supabase SQL editor BEFORE/WITH the deploy.

-- 1) Clear the old vacancy posters so they don't show up as CV pictures.
--    (The Worker's expiry job removes the image files from R2 only for rows it
--    finds; delete leftover files under employer-posters/ in R2 if you want them gone.)
delete from public.employer_posters;

-- 2) House-ad screen key 'posters' -> 'cvpics'.
alter table public.house_ads drop constraint if exists house_ads_target_screens_check;
update public.house_ads
   set target_screens = array_replace(target_screens, 'posters', 'cvpics')
 where 'posters' = any(target_screens);
alter table public.house_ads add constraint house_ads_target_screens_check
  check (target_screens <@ array['agencies','employers','candidates','cvpics','home','public']::text[]
         and cardinality(target_screens) > 0);
alter table public.house_ads
  alter column target_screens set default array['agencies','employers','candidates','cvpics'];

-- Expire vacancies from their explicit closing date.
-- This replaces the old per-source/60-day row-age fallback. A vacancy with
-- no closing date is retained because there is no reliable date to enforce.

create or replace function public.delete_expired_vacancies()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  delete from public.vacancies
  where
    -- ISO dates, e.g. 2026-09-23
    (trim(closing_date) ~ '^\d{4}-\d{1,2}-\d{1,2}$'
      and to_date(trim(closing_date), 'YYYY-MM-DD') < current_date)
    -- South African dates, e.g. 23/09/2026
    or (trim(closing_date) ~ '^\d{1,2}/\d{1,2}/\d{4}$'
      and to_date(trim(closing_date), 'DD/MM/YYYY') < current_date)
    -- Common scraped dates, e.g. 23 Sep 2026
    or (trim(closing_date) ~* '^\d{1,2} [A-Za-z]{3,9}\.? \d{4}$'
      and to_date(trim(closing_date), 'DD Mon YYYY') < current_date);
end;
$function$;

-- The existing pg_cron job from 20260919c_schedule_ttl_cleanup.sql calls
-- this function by name, so no schedule change is needed.

-- ============================================================
--  SA RECRUITERS — supabase/migrations/20260919c_schedule_ttl_cleanup.sql
-- ============================================================
--  delete_expired_vacancies() (20260919b_per_source_vacancy_ttl.sql) was
--  defined but nothing ever called it — rows only left the table via the
--  link verifier's per-row checks. This schedules it with pg_cron so the
--  per-source TTL is actually enforced daily.
--
--  If pg_cron is unavailable in the project, the same effect can be had by
--  running scripts/purge-stale-vacancies.mjs on a schedule (it applies the
--  same ceilings) — but pg_cron is preferred since it needs no secrets in
--  GitHub and runs even if CI is broken.
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================

-- pg_cron lives in a dedicated schema; create the extension if missing.
create extension if not exists pg_cron with schema pg_catalog;

-- Unschedule any previous version of the job, then (re)create it.
select cron.unschedule('delete-expired-vacancies')
where exists (select 1 from cron.job where jobname = 'delete-expired-vacancies');

-- 03:11 UTC daily (after the nightly batch windows used by the scrapers).
select cron.schedule(
  'delete-expired-vacancies',
  '11 3 * * *',
  $$select public.delete_expired_vacancies();$$
);

-- ============================================================
--  VERIFICATION:
--    select jobname, schedule, active from cron.job
--    where jobname = 'delete-expired-vacancies';
--    -- expect one active row with schedule '11 3 * * *'
--
--  Manual run (no need to wait for the schedule):
--    select public.delete_expired_vacancies();
-- ============================================================

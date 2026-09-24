-- Keep Simplify Jobs listings on the same 45-day source tier as other
-- external job-board aggregators. Closing dates are still enforced by the
-- scraper and application-level freshness checks before this fallback runs.
create or replace function public.delete_expired_vacancies()
 returns void
 language sql
 security definer
 set search_path = public
as $function$
  delete from public.vacancies
    where created_at < now() - (
      case
        when source_type in ('jobmail', 'agency') then interval '21 days'
        when source_type in ('learnerships') then interval '30 days'
        when source_type in ('retail','shoprite','picknpay','woolworths','truworths','spar') then interval '30 days'
        when source_type in ('adzuna','himalayas','pnet','simplify') then interval '45 days'
        else interval '60 days'
      end
    );
$function$;

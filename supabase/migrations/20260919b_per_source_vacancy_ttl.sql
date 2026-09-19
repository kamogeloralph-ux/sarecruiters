-- Per-source vacancy TTL, instead of one blanket 60 days for every row.
--
-- JobMail listings (almost always hosted on the employer/agency's own
-- site, not jobmail.co.za) and learnerships/retail postings churn much
-- faster in practice than manually-posted agency vacancies or the other
-- synced sources. A fixed 60-day window left JobMail rows sitting live on
-- the site well after the underlying posting had already closed.
--
-- Also backfills the JobMail scraper's source_type rename from the
-- previously-generic 'agency' to the distinct 'jobmail', so it can't
-- collide with any other source and can be targeted cleanly here and by
-- scripts/verify-jobmail.mjs.

update public.vacancies set source_type = 'jobmail' where source_type = 'agency';

create or replace function public.delete_expired_vacancies()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from public.vacancies
    where created_at < now() - (
      case
        when source_type in ('jobmail', 'agency') then interval '21 days'
        when source_type = 'learnerships' then interval '30 days'
        when source_type in ('retail','shoprite','picknpay','woolworths','truworths','spar') then interval '30 days'
        else interval '60 days'
      end
    );
$function$;

-- SA Recruiters operational automation tables and exact closing-date cleanup.

create or replace function public.delete_expired_vacancies()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from public.vacancies
  where (
    (closing_date ~ '^\d{4}-\d{1,2}-\d{1,2}' and (substring(closing_date from '^\d{4}-\d{1,2}-\d{1,2}')::date < current_date))
    or created_at < now() - (
      case
        when source_type in ('jobmail', 'agency') then interval '21 days'
        when source_type = 'learnerships' then interval '30 days'
        when source_type in ('retail','shoprite','picknpay','woolworths','truworths','spar') then interval '30 days'
        else interval '60 days'
      end
    )
  );
$function$;

create table if not exists public.vacancy_link_checks (
  vacancy_id text primary key references public.vacancies(id) on delete cascade,
  url text not null,
  http_status integer,
  final_url text,
  failure_count integer not null default 0,
  last_error text,
  checked_at timestamptz not null default now(),
  last_success_at timestamptz,
  action_taken text
);
create index if not exists vacancy_link_checks_failure_idx on public.vacancy_link_checks (failure_count, checked_at desc);

create table if not exists public.community_automated_flags (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('post','comment')),
  content_id uuid not null,
  reasons text[] not null default '{}',
  matched_terms text[] not null default '{}',
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (content_type, content_id)
);
create index if not exists community_automated_flags_open_idx on public.community_automated_flags (status, created_at desc);

alter table public.vacancy_link_checks enable row level security;
alter table public.community_automated_flags enable row level security;
revoke all on public.vacancy_link_checks, public.community_automated_flags from anon, authenticated;

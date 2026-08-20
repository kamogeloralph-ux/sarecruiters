-- SA Recruiters — Supabase-backed Talent Pool access
-- Run once in the Supabase SQL Editor before using the cross-device Employer Directory gate.

drop function if exists public.verify_talent_pool_access(text, text);
create or replace function public.verify_talent_pool_access(p_email text, p_phone text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pool_candidates
     where lower(trim(contact_email)) = lower(trim(p_email))
       and regexp_replace(contact_phone, '[^0-9+]', '', 'g') = regexp_replace(p_phone, '[^0-9+]', '', 'g')
       and status in ('pending', 'active')
  );
$$;

revoke all on function public.verify_talent_pool_access(text, text) from public;
grant execute on function public.verify_talent_pool_access(text, text) to anon, authenticated;

-- The RPC returns only true/false. It does not expose candidate rows, phone numbers,
-- addresses, payment references, or any other Talent Pool data.

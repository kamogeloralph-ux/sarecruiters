-- Employer poster images are served only from the custom R2 domain.
-- The legacy r2.dev host is no longer accepted (all stored URLs were rewritten).
create or replace function public.community_poster_url_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is null
      or p_url ~ '^https://media\.sa-recruiters\.co\.za/employer-posters/[A-Za-z0-9]+\.jpg$';
$$;

-- Employer poster images now live on the custom R2 domain media.sa-recruiters.co.za.
-- The legacy r2.dev host stays valid until every stored URL has been rewritten.
create or replace function public.community_poster_url_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is null
      or p_url ~ '^https://(media\.sa-recruiters\.co\.za|pub-911e4cd402674c6f85c747b12212772f\.r2\.dev)/employer-posters/[A-Za-z0-9]+\.jpg$';
$$;

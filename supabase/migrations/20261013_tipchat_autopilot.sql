-- ============================================================================
--  TIPCHAT AUTOPILOT -- self-running moderation, entirely inside Postgres.
-- ============================================================================
--  Before: every post/comment waited for a human to press "approve".
--  Now:    every submission is risk-scored the moment it is inserted.
--
--    clean + low risk .......... approved instantly (no cron, no waiting)
--    clearly a scam / PII leak . hidden instantly
--    grey area ................. held, then re-scored every 5 minutes; if still
--                                unresolved after hold_ttl_hours it is hidden
--                                (fail-closed: nothing doubtful is ever published
--                                by default, and nobody has to act)
--    approved but reported ..... auto-hidden once N distinct, aged accounts report it
--
--  Safety rails (this replaces a human gate, so these matter):
--    * mode = 'shadow' by default: decisions are LOGGED, nothing is changed.
--      Review community_moderation_log, then flip to 'live' (see bottom).
--    * mode = 'off' is an instant kill switch; the old manual flow resumes.
--    * Only ever touches rows that are still 'pending' (or, for reports,
--      'approved' + not official). It never overrides a human decision.
--    * Every decision is audited (community_moderation_log, 90 days).
--    * Any error inside the engine is swallowed -> the row simply stays pending.
--      A bug here can never block someone from posting.
--    * Rules are DATA (community_automod_rules): tune weights / add words with
--      a single UPDATE or INSERT, no deploy.
--
--  Hands-off requirement: pg_cron must be enabled (this project already uses
--  it). The Cloudflare Worker watchdog also runs the sweep if pg_cron stalls.
--
--  Safe to re-run: every statement is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.community_automod_settings (
  id boolean primary key default true check (id),
  mode text not null default 'shadow' check (mode in ('off', 'shadow', 'live')),
  approve_below_new integer not null default 30 check (approve_below_new between 1 and 200),
  approve_below_trusted integer not null default 50 check (approve_below_trusted between 1 and 200),
  hide_at integer not null default 80 check (hide_at between 1 and 400),
  hold_ttl_hours integer not null default 48 check (hold_ttl_hours between 1 and 720),
  report_hide_threshold integer not null default 3 check (report_hide_threshold >= 2),
  trusted_min_approved integer not null default 3 check (trusted_min_approved >= 1),
  trusted_min_age_days integer not null default 2 check (trusted_min_age_days >= 0),
  last_sweep_at timestamptz,
  last_cron_sweep_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint community_automod_thresholds_ordered
    check (approve_below_new <= approve_below_trusted and approve_below_trusted < hide_at)
);
insert into public.community_automod_settings (id) values (true) on conflict (id) do nothing;
alter table public.community_automod_settings enable row level security;
revoke all on public.community_automod_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rules (editable data). Patterns are Postgres regular expressions matched
--    case-insensitively against lower-cased text.
--      critical = true  -> hidden regardless of author trust
--      applies_to       -> 'vacancy' posts, 'discussion' posts/comments, or 'all'
--    Seeds use ON CONFLICT DO NOTHING so your later edits survive re-runs.
-- ---------------------------------------------------------------------------
create table if not exists public.community_automod_rules (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  pattern text not null,
  weight integer not null check (weight between 1 and 200),
  applies_to text not null default 'all' check (applies_to in ('all', 'vacancy', 'discussion')),
  critical boolean not null default false,
  active boolean not null default true,
  description text not null default ''
);
alter table public.community_automod_rules enable row level security;
revoke all on public.community_automod_rules from anon, authenticated;

insert into public.community_automod_rules (key, pattern, weight, applies_to, critical, description) values
('payment_request',
 $re$\m(registration|application|processing|admin|administration|joining|placement|training|uniform|onboarding|interview|screening|vetting)\s+(fee|fees|deposit)\M|\mupfront\s+(payment|fee|fees|deposit)\M|\m(pay|paying|send|sending)\s+(us\s+|me\s+|a\s+|an\s+|the\s+|small\s+|once[- ]off\s+)*(fee|fees|deposit|money)\M|\m(payment|deposit)\s+(is\s+)?required\M$re$,
 100, 'all', true, 'Advance-fee job scam: asks the applicant to pay. Negations like "no fee" are stripped first.'),
('credential_request',
 $re$\m(send|share|give|provide|whatsapp)\s+(us\s+|me\s+)?(your\s+)?(password|pin|otp|cvv|banking\s+details|bank\s+details|card\s+number|card\s+details)\M|\mone[- ]time\s+(pin|password)\M|\motp\M$re$,
 100, 'all', true, 'Credential / banking-detail phishing.'),
('sa_id_number',
 $re$\m[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\s?[0-9]{4}\s?[01][89][0-9]\M$re$,
 100, 'all', true, 'A South African ID number in a public post is a privacy leak.'),
('contact_phone',
 $re$(\+?27|\m0)[\s-]?[6-8][0-9][\s-]?[0-9]{3}[\s-]?[0-9]{4}\M$re$,
 55, 'discussion', false, 'Phone number in a discussion post/comment (vacancy posts may include one).'),
('contact_email',
 $re$[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$re$,
 55, 'discussion', false, 'Email address in a discussion post/comment.'),
('off_platform_chat',
 $re$\m(whatsapp|telegram|signal\s+me|dm\s+me|inbox\s+me)\M$re$,
 25, 'discussion', false, 'Moving the conversation off-platform.'),
('external_link_discussion',
 $re$https?://|\mwww\.$re$,
 30, 'discussion', false, 'Link inside a discussion post/comment (common spam vector).'),
('url_shortener',
 $re$\m(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|is\.gd|shorturl\.at|ow\.ly|buff\.ly)\M$re$,
 45, 'all', false, 'Link shorteners hide the real destination.'),
('mass_promotion',
 $re$\mguaranteed\s+(job|placement|income|employment|interview)\M|\mact\s+now\M|\mlimited\s+(slots|spots)\M|\mearn\s+(up\s+to\s+)?(r|zar|\$)\s?[0-9][0-9 ,.]*\s*(per|a|/|each)\s*(day|week|hour)\M|\mget\s+rich\M|\mwork\s+from\s+home\s+and\s+earn\M|\m(100|hundred)\s*(%|percent)\s+(guaranteed|legit)\M$re$,
 35, 'all', false, 'Get-rich / guaranteed-job promotion language.'),
('click_here',
 $re$\mclick\s+here\M$re$,
 15, 'all', false, 'Weak signal on its own; common in legitimate ads too.'),
('profanity',
 $re$\m(f+u+c+k+(ing|er|ers|ed)?|sh[i1]t+(ty)?|b[i1]tch(es)?|cunts?|assholes?|dickheads?|bastards?|motherfuckers?)\M$re$,
 60, 'all', false, 'Abusive language. Extend this list as needed.'),
('repeated_chars',
 $re$(.)\1{9,}$re$,
 20, 'all', false, 'Ten or more repeated characters (keyboard-mash spam).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Audit log. One row per *change* of decision for an item (not per sweep).
-- ---------------------------------------------------------------------------
create table if not exists public.community_moderation_log (
  id bigint generated always as identity primary key,
  content_type text not null check (content_type in ('post', 'comment')),
  content_id uuid not null,
  decision text not null check (decision in ('approve', 'hold', 'hide')),
  source text not null check (source in ('insert', 'sweep', 'ttl', 'reports')),
  mode text not null,
  applied boolean not null default false,
  tier text,
  score integer,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists community_moderation_log_content_idx
  on public.community_moderation_log (content_type, content_id, id desc);
create index if not exists community_moderation_log_created_idx
  on public.community_moderation_log (created_at desc);
alter table public.community_moderation_log enable row level security;
revoke all on public.community_moderation_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Automated actions must not be stamped as if the *author* reviewed them.
--    (The original trigger recorded auth.uid(), which inside an insert trigger
--    is the author.) Automation leaves reviewed_by NULL; humans still get theirs.
-- ---------------------------------------------------------------------------
create or replace function public.community_stamp_moderation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := case
      when coalesce(current_setting('app.community_automod', true), 'off') = 'on' then null
      else auth.uid()
    end;
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.community_stamp_moderation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Author reputation -> 'new' | 'trusted' | 'restricted'
--    restricted: 2+ items hidden in the last 30 days (hold-expiries excluded,
--                so a legitimate poster whose item merely timed out is not punished)
--    trusted:    enough approved history, nothing hidden recently, account old enough
-- ---------------------------------------------------------------------------
create or replace function public.community_automod_author_tier(p_author uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.community_automod_settings%rowtype;
  v_ok integer;
  v_bad integer;
  v_created timestamptz;
begin
  if p_author is null then return 'new'; end if;
  select * into s from public.community_automod_settings where id;
  select u.created_at into v_created from auth.users u where u.id = p_author;

  select count(*) into v_ok from (
    select 1 from public.community_posts
     where author_id = p_author and status = 'approved' and not is_official
    union all
    select 1 from public.community_comments
     where author_id = p_author and status = 'approved'
  ) a;

  select count(*) into v_bad from (
    select id from public.community_posts
     where author_id = p_author and status = 'hidden' and reviewed_at > now() - interval '30 days'
    union all
    select id from public.community_comments
     where author_id = p_author and status = 'hidden' and reviewed_at > now() - interval '30 days'
  ) h
  where not exists (
    select 1 from public.community_moderation_log l
     where l.content_id = h.id and l.source = 'ttl' and l.applied
  );

  if v_bad >= 2 then return 'restricted'; end if;
  if v_ok >= s.trusted_min_approved
     and v_bad = 0
     and v_created is not null
     and v_created <= now() - make_interval(days => s.trusted_min_age_days) then
    return 'trusted';
  end if;
  return 'new';
end;
$$;
revoke all on function public.community_automod_author_tier(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The decision engine. Returns 'approve' | 'hold' | 'hide' (or NULL when
--    there is nothing to do: mode off, row gone, already moderated, official).
-- ---------------------------------------------------------------------------
create or replace function public.community_automod_evaluate(
  p_kind text,
  p_id uuid,
  p_source text default 'sweep'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.community_automod_settings%rowtype;
  r record;
  v_last record;
  v_has_last boolean := false;
  v_author uuid;
  v_status text;
  v_text text;
  v_body text;
  v_kind text := 'discussion';
  v_poster text;
  v_official boolean := false;
  v_scan text;
  v_tier text;
  v_score integer := 0;
  v_reasons text[] := '{}';
  v_critical boolean := false;
  v_decision text;
  v_threshold integer;
  v_letters integer;
  v_upper integer;
  v_norm text;
  v_applied boolean := false;
  v_rows integer := 0;
begin
  select * into s from public.community_automod_settings where id;
  if not found or s.mode = 'off' then return null; end if;

  if p_kind = 'post' then
    select p.author_id, p.status,
           concat_ws(' ', p.body, p.vacancy_title, p.vacancy_location, p.vacancy_application),
           p.body,
           case when p.post_type = 'vacancy' then 'vacancy' else 'discussion' end,
           p.poster_image_url, p.is_official
      into v_author, v_status, v_text, v_body, v_kind, v_poster, v_official
      from public.community_posts p where p.id = p_id;
  elsif p_kind = 'comment' then
    select c.author_id, c.status, c.body, c.body
      into v_author, v_status, v_text, v_body
      from public.community_comments c where c.id = p_id;
  else
    return null;
  end if;

  if not found or v_status <> 'pending' or v_official then return null; end if;

  -- Normalise, then neutralise reassurances such as "no fee", "never pay any fee",
  -- "do not pay a deposit" so honest anti-scam wording is not punished.
  v_scan := lower(coalesce(v_text, ''));
  v_scan := regexp_replace(
    v_scan,
    '\m(no|not|never|without|zero|free\s+of)\s+(\w+\s+){0,2}(fee|fees|deposit|deposits|payment|payments|charge|charges)\M',
    ' ', 'g');

  -- Rule table. A malformed pattern is skipped, never fatal.
  for r in
    select key, pattern, weight, critical
      from public.community_automod_rules
     where active and (applies_to = 'all' or applies_to = v_kind)
  loop
    begin
      if v_scan ~* r.pattern then
        v_score := v_score + r.weight;
        -- NB: always array_append(); `text[] || 'literal'` is parsed as an ARRAY literal and errors.
        v_reasons := array_append(v_reasons, r.key);
        if r.critical then v_critical := true; end if;
      end if;
    exception when others then
      null;
    end;
  end loop;

  -- Computed signals.
  v_letters := length(regexp_replace(coalesce(v_text, ''), '[^A-Za-z]', '', 'g'));
  v_upper := length(regexp_replace(coalesce(v_text, ''), '[^A-Z]', '', 'g'));
  if v_letters >= 40 and v_upper::numeric / v_letters > 0.7 then
    v_score := v_score + 15;
    v_reasons := array_append(v_reasons, 'shouting');
  end if;

  v_norm := lower(regexp_replace(btrim(coalesce(v_body, '')), '\s+', ' ', 'g'));
  if length(v_norm) >= 40 then
    if p_kind = 'post' then
      select exists (
        select 1 from public.community_posts p
         where p.id <> p_id and not p.is_official
           and p.created_at > now() - interval '3 days'
           and lower(regexp_replace(btrim(p.body), '\s+', ' ', 'g')) = v_norm
      ) into v_has_last;
    else
      select exists (
        select 1 from public.community_comments c
         where c.id <> p_id
           and c.created_at > now() - interval '3 days'
           and lower(regexp_replace(btrim(c.body), '\s+', ' ', 'g')) = v_norm
      ) into v_has_last;
    end if;
    if v_has_last then
      v_score := v_score + 60;
      v_reasons := array_append(v_reasons, 'duplicate_content');
    end if;
    v_has_last := false;
  end if;

  v_tier := public.community_automod_author_tier(v_author);
  if v_tier = 'restricted' then
    v_score := v_score + 60;
    v_reasons := array_append(v_reasons, 'restricted_author');
  end if;
  -- A poster is an image we cannot read: only established authors skip review.
  if v_poster is not null and v_tier <> 'trusted' then
    v_score := v_score + 40;
    v_reasons := array_append(v_reasons, 'poster_unverified');
  end if;
  if v_kind = 'vacancy' and v_tier = 'new' then
    v_score := v_score + 10;
    v_reasons := array_append(v_reasons, 'new_author_vacancy');
  end if;

  v_threshold := case when v_tier = 'trusted' then s.approve_below_trusted else s.approve_below_new end;
  v_decision := case
    when v_critical or v_score >= s.hide_at then 'hide'
    when v_score >= v_threshold then 'hold'
    else 'approve'
  end;

  -- Apply (live mode only). Guarded by status = 'pending' so a human who got
  -- there first always wins.
  if s.mode = 'live' and v_decision in ('approve', 'hide') then
    perform set_config('app.community_automod', 'on', true);
    if p_kind = 'post' then
      update public.community_posts
         set status = case v_decision when 'approve' then 'approved' else 'hidden' end
       where id = p_id and status = 'pending';
    else
      update public.community_comments
         set status = case v_decision when 'approve' then 'approved' else 'hidden' end
       where id = p_id and status = 'pending';
    end if;
    get diagnostics v_rows = row_count;
    v_applied := v_rows > 0;
    perform set_config('app.community_automod', 'off', true);
  end if;

  -- Surface anything not auto-resolved in the existing moderator queue.
  if v_decision = 'hold' or (v_decision = 'hide' and not v_applied) then
    insert into public.community_automated_flags (content_type, content_id, reasons, matched_terms, status)
    values (p_kind, p_id, v_reasons, v_reasons, 'open')
    on conflict (content_type, content_id) do update
      set reasons = excluded.reasons,
          matched_terms = excluded.matched_terms,
          status = 'open',
          reviewed_at = null;
  end if;

  -- Log only when something changed, so a 5-minute sweep cannot flood the table.
  select l.decision, l.mode, l.applied into v_last
    from public.community_moderation_log l
   where l.content_type = p_kind and l.content_id = p_id
   order by l.id desc limit 1;
  v_has_last := found;
  if not v_has_last
     or v_last.decision is distinct from v_decision
     or v_last.mode is distinct from s.mode
     or v_last.applied is distinct from v_applied then
    insert into public.community_moderation_log
      (content_type, content_id, decision, source, mode, applied, tier, score, reasons)
    values
      (p_kind, p_id, v_decision, coalesce(p_source, 'sweep'), s.mode, v_applied, v_tier, v_score, v_reasons);
  end if;

  return v_decision;
end;
$$;
revoke all on function public.community_automod_evaluate(text, uuid, text) from public, anon, authenticated;
grant execute on function public.community_automod_evaluate(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Instant path: score every new post/comment as it is inserted.
--    Never allowed to fail the insert.
-- ---------------------------------------------------------------------------
create or replace function public.community_automod_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.community_automod_evaluate(
      case tg_table_name when 'community_posts' then 'post' else 'comment' end,
      new.id,
      'insert');
  exception when others then
    raise warning 'community automod skipped (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.community_automod_after_insert() from public, anon, authenticated;

drop trigger if exists community_posts_automod on public.community_posts;
create trigger community_posts_automod
  after insert on public.community_posts
  for each row execute function public.community_automod_after_insert();
drop trigger if exists community_comments_automod on public.community_comments;
create trigger community_comments_automod
  after insert on public.community_comments
  for each row execute function public.community_automod_after_insert();

-- ---------------------------------------------------------------------------
-- 8. Sweep (every 5 minutes). Idempotent, so it is safe for BOTH pg_cron and the
--    Cloudflare watchdog to call it.
--      1. re-score everything still pending (trust may have changed; retries
--         anything the insert trigger could not finish)
--      2. expire holds that have sat unresolved for hold_ttl_hours  (live only)
--      3. hide approved content reported by enough distinct aged accounts (live only)
--      4. trim the audit log to 90 days
-- ---------------------------------------------------------------------------
create or replace function public.community_automod_sweep(p_via text default 'cron')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.community_automod_settings%rowtype;
  r record;
  v_rows integer := 0;
  v_scored integer := 0;
  v_expired integer := 0;
  v_reported integer := 0;
begin
  select * into s from public.community_automod_settings where id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'settings row missing');
  end if;

  update public.community_automod_settings
     set last_sweep_at = now(),
         last_cron_sweep_at = case when p_via = 'cron' then now() else last_cron_sweep_at end
   where id;

  if s.mode = 'off' then
    return jsonb_build_object('ok', true, 'mode', 'off');
  end if;

  -- 1. Re-score pending items, oldest first.
  for r in
    (select 'post'::text as kind, id from public.community_posts
      where status = 'pending' and not is_official order by created_at limit 200)
    union all
    (select 'comment'::text as kind, id from public.community_comments
      where status = 'pending' order by created_at limit 200)
  loop
    begin
      perform public.community_automod_evaluate(r.kind, r.id, 'sweep');
      v_scored := v_scored + 1;
    exception when others then
      raise warning 'community automod sweep skipped (%): %', r.id, sqlerrm;
    end;
  end loop;

  if s.mode = 'live' then
    perform set_config('app.community_automod', 'on', true);

    -- 2. Expire unresolved holds. Only items the engine explicitly HELD (in live
    --    mode) for the full TTL are touched -- never an item it has not scored.
    with expired as (
      update public.community_posts p set status = 'hidden'
       where p.status = 'pending' and not p.is_official
         and exists (
           select 1 from public.community_moderation_log l
            where l.content_type = 'post' and l.content_id = p.id
              and l.mode = 'live' and l.decision = 'hold'
              and l.created_at < now() - make_interval(hours => s.hold_ttl_hours))
      returning p.id
    )
    insert into public.community_moderation_log
      (content_type, content_id, decision, source, mode, applied, reasons)
    select 'post', id, 'hide', 'ttl', 'live', true, array['hold_expired'] from expired;
    get diagnostics v_rows = row_count;
    v_expired := v_expired + v_rows;

    with expired as (
      update public.community_comments c set status = 'hidden'
       where c.status = 'pending'
         and exists (
           select 1 from public.community_moderation_log l
            where l.content_type = 'comment' and l.content_id = c.id
              and l.mode = 'live' and l.decision = 'hold'
              and l.created_at < now() - make_interval(hours => s.hold_ttl_hours))
      returning c.id
    )
    insert into public.community_moderation_log
      (content_type, content_id, decision, source, mode, applied, reasons)
    select 'comment', id, 'hide', 'ttl', 'live', true, array['hold_expired'] from expired;
    get diagnostics v_rows = row_count;
    v_expired := v_expired + v_rows;

    -- 3. Crowd moderation. Only reports from accounts older than a day count, so a
    --    handful of throwaway accounts cannot silence a legitimate post.
    for r in
      select rp.post_id, rp.comment_id
        from public.community_reports rp
        join auth.users u on u.id = rp.reporter_id
       where rp.status = 'open' and u.created_at < now() - interval '1 day'
       group by rp.post_id, rp.comment_id
      having count(distinct rp.reporter_id) >= s.report_hide_threshold
    loop
      if r.post_id is not null then
        update public.community_posts set status = 'hidden'
         where id = r.post_id and status = 'approved' and not is_official;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          insert into public.community_moderation_log
            (content_type, content_id, decision, source, mode, applied, reasons)
          values ('post', r.post_id, 'hide', 'reports', 'live', true, array['community_reports']);
          update public.community_reports set status = 'reviewed'
           where post_id = r.post_id and status = 'open';
          v_reported := v_reported + 1;
        end if;
      else
        update public.community_comments set status = 'hidden'
         where id = r.comment_id and status = 'approved';
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          insert into public.community_moderation_log
            (content_type, content_id, decision, source, mode, applied, reasons)
          values ('comment', r.comment_id, 'hide', 'reports', 'live', true, array['community_reports']);
          update public.community_reports set status = 'reviewed'
           where comment_id = r.comment_id and status = 'open';
          v_reported := v_reported + 1;
        end if;
      end if;
    end loop;

    perform set_config('app.community_automod', 'off', true);
  end if;

  -- 4. Retention.
  delete from public.community_moderation_log where created_at < now() - interval '90 days';

  return jsonb_build_object('ok', true, 'mode', s.mode, 'scored', v_scored,
                            'expired', v_expired, 'report_hidden', v_reported);
end;
$$;
revoke all on function public.community_automod_sweep(text) from public, anon, authenticated;
grant execute on function public.community_automod_sweep(text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Health + digest (read by the Cloudflare watchdog with the service role)
-- ---------------------------------------------------------------------------
create or replace function public.community_automod_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'mode', s.mode,
    'last_sweep_at', s.last_sweep_at,
    'last_cron_sweep_at', s.last_cron_sweep_at,
    'hold_ttl_hours', s.hold_ttl_hours,
    'pending',
      (select count(*) from public.community_posts where status = 'pending' and not is_official)
      + (select count(*) from public.community_comments where status = 'pending'),
    'stuck',
      (select count(*) from public.community_posts
        where status = 'pending' and not is_official
          and created_at < now() - make_interval(hours => s.hold_ttl_hours + 2))
      + (select count(*) from public.community_comments
          where status = 'pending'
            and created_at < now() - make_interval(hours => s.hold_ttl_hours + 2))
  )
  from public.community_automod_settings s
  where s.id;
$$;
revoke all on function public.community_automod_health() from public, anon, authenticated;
grant execute on function public.community_automod_health() to service_role;

create or replace function public.community_automod_digest(p_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)));
begin
  return jsonb_build_object(
    'since', v_since,
    'mode', (select mode from public.community_automod_settings where id),
    'counts', coalesce((
      select jsonb_object_agg(k, n) from (
        select l.decision || ':' || l.source || case when l.mode = 'shadow' then ':shadow' else '' end as k,
               count(*) as n
          from public.community_moderation_log l
         where l.created_at >= v_since
         group by 1
      ) c), '{}'::jsonb),
    'top_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', t.reason, 'n', t.n) order by t.n desc) from (
        select unnest(l.reasons) as reason, count(*) as n
          from public.community_moderation_log l
         where l.created_at >= v_since and l.decision <> 'approve'
         group by 1 order by 2 desc limit 8
      ) t), '[]'::jsonb),
    'samples', coalesce((
      select jsonb_agg(x.j) from (
        select jsonb_build_object(
                 'decision', l.decision, 'source', l.source, 'applied', l.applied,
                 'reasons', l.reasons, 'kind', l.content_type,
                 'snippet', left(regexp_replace(coalesce(p.body, c.body, '(deleted)'), '\s+', ' ', 'g'), 140)
               ) as j
          from public.community_moderation_log l
          left join public.community_posts p on l.content_type = 'post' and p.id = l.content_id
          left join public.community_comments c on l.content_type = 'comment' and c.id = l.content_id
         where l.created_at >= v_since and l.decision <> 'approve'
         order by l.id desc limit 12
      ) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.community_automod_digest(integer) from public, anon, authenticated;
grant execute on function public.community_automod_digest(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Schedule the sweep (pg_cron is already used by this project; it needs no
--     GitHub secrets and keeps running even if CI is broken).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule('community-automod-sweep')
where exists (select 1 from cron.job where jobname = 'community-automod-sweep');

select cron.schedule(
  'community-automod-sweep',
  '*/5 * * * *',
  $$select public.community_automod_sweep('cron');$$
);

-- ============================================================================
--  ROLLOUT (the only manual steps, once)
-- ============================================================================
--  1. Apply this migration. Autopilot starts in SHADOW mode: it scores every new
--     submission and writes community_moderation_log, but changes nothing.
--
--  2. After a day or two, look at what it WOULD have done:
--       select decision, source, count(*) from public.community_moderation_log
--        where mode = 'shadow' group by 1, 2 order by 3 desc;
--       -- eyeball the borderline ones:
--       select l.decision, l.score, l.reasons, left(p.body, 120) as post
--         from public.community_moderation_log l
--         join public.community_posts p on p.id = l.content_id and l.content_type = 'post'
--        where l.mode = 'shadow' and l.decision <> 'approve' order by l.id desc limit 30;
--
--  3. Happy? Go live (instant approvals, auto-hide, auto-expiry, crowd moderation):
--       update public.community_automod_settings set mode = 'live', updated_at = now();
--
--  Kill switch, any time (the old manual flow resumes immediately):
--       update public.community_automod_settings set mode = 'off', updated_at = now();
--
--  Tune without a deploy:
--       update public.community_automod_rules set weight = 20 where key = 'external_link_discussion';
--       update public.community_automod_rules set active = false where key = 'click_here';
--       insert into public.community_automod_rules (key, pattern, weight, applies_to)
--         values ('my_new_rule', '\mfoo\s+bar\M', 40, 'all');
--       update public.community_automod_settings set approve_below_new = 40;   -- more permissive
--
--  Wrongly hidden something? Re-approve it by hand; humans always win:
--       update public.community_posts set status = 'approved' where id = '<uuid>';
--
--  Verify the schedule:
--       select jobname, schedule, active from cron.job where jobname = 'community-automod-sweep';
--       select last_sweep_at, last_cron_sweep_at, mode from public.community_automod_settings;
-- ============================================================================

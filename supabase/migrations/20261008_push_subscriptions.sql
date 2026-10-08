-- Web Push subscriptions for vacancy alerts.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (endpoint)
);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.saved_searches add column if not exists last_push_checked_at timestamptz;
update public.saved_searches set last_push_checked_at = coalesce(last_push_checked_at, last_checked_at, created_at) where last_push_checked_at is null;

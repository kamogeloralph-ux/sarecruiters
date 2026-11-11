# TODO

## Manager-scoped vacancy activity metrics

- [x] Agency and employer manager links show per-vacancy tracked apply-link clicks and self-reported application counts for the last 30 days.
- [x] Keep event reads behind a server-role-only, manager-token-scoped SQL function; return aggregate counts only and preserve manager access when metrics are unavailable.
- [x] Add regression coverage for owner scoping, service-role access, privacy, and the UI fallback.
- [ ] Apply `supabase/migrations/20261111100000_manager_vacancy_analytics.sql` to the correct SA Recruiters Supabase project and verify the RPC there.

## Remaining production checks

- [ ] Confirm the Worker and Pages deployments succeeded after the source update.
- [ ] Confirm the Worker has `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a verified `EMAIL_FROM` domain configured.
- [ ] Verify the production grants for `20261104042157_restrict_server_only_rpc_execute.sql`.

# Remaining-issues repairs and rollout notes

## Changes in this source copy

- The supplied archive already had the watchdog triggers configured for `15,45 * * * *` and `0 */6 * * *`, the matching schedule test, a GitHub Actions test workflow, and the signed-in candidate profile/CV hub. Those findings were already resolved in this copy.
- Employer, branch and vacancy deletion helpers now return failure when Supabase rejects the write or the request throws. Employer/branch upsert failures are logged and surfaced as failures to the admin UI rather than looking like a successful save.
- Admin status changes for job-post enquiries and job-seeker requests now send a best-effort Resend email to the submitter when the status actually changes. Email delivery failure does not undo the saved status. Reopening to `new` also sends an update.
- Apply clicks remain click events, but no longer immediately create an `applied` record. When a visitor returns to the app, it asks “Did you apply?” and stores the application only after confirmation (for signed-in users).
- Public candidate CV/photo upload routes now apply a best-effort per-IP hourly quota, reject oversized request streams before buffering, verify file signatures, and restrict photos to JPEG/PNG. The quota uses Cloudflare Cache API and is intentionally not described as a durable global rate limiter.
- Pages deployment now refreshes the build-only SEO snapshot from the public D1-backed Worker, paginates the vacancy inventory, retries transient network/HTTP failures, applies the canonical expired/capped-vacancy filter, validates that source data is no older than 72 hours, and only then generates static pages and the sitemap. The committed snapshot remains the local/offline fallback.
- Agency and employer manager links now receive per-vacancy apply-link click and self-reported application counts for the last 30 days. The service-role-only SQL function validates the manager token, returns aggregates only, and never exposes visitor identifiers or applicant contact details. The UI labels self-reports as unverified and keeps manager access working when metrics are unavailable.
- Regression tests were added for the repairs.

## Production rollout status

1. Worker deployment for `32fde7b` succeeded. The Pages workflow failed first on a transient 503 and then correctly rejected 163 expired/capped rows. The exporter now retries transient failures and filters those rows; a live export produced 6,034 valid vacancies and passed the snapshot validator. Push and confirm the Pages workflow with this fix before calling rollout complete.
2. Cloudflare confirms bindings for `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a non-empty `EMAIL_FROM`. Sender-domain verification itself was not independently checked.
3. Verified: production migration `20261104042157_restrict_server_only_rpc_execute` is recorded, and the covered public submission RPCs grant execution only to `postgres` and `service_role`.
4. Applied `supabase/migrations/20261111084515_manager_vacancy_analytics.sql` to SA.Recruiters; production records it as version `20261111084515`. The resulting function is `SECURITY DEFINER`, has a fixed search path, returns aggregate counts only, and is executable by `service_role` but not `anon` or `authenticated`.

The production column types were checked and match the migration assumptions. No applicant-level data was read or returned.

Run `npm ci && npm test` before publishing. The Pages workflow retries transient Worker errors; if refresh still fails, it continues with the checked-in SEO snapshot. Check that snapshot's timestamp and vacancy quality when the fallback path is used.

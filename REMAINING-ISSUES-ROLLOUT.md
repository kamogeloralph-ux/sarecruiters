# Remaining-issues repairs and rollout notes

## Changes in this source copy

- The supplied archive already had the watchdog triggers configured for `15,45 * * * *` and `0 */6 * * *`, the matching schedule test, a GitHub Actions test workflow, and the signed-in candidate profile/CV hub. Those findings were already resolved in this copy.
- Employer, branch and vacancy deletion helpers now return failure when Supabase rejects the write or the request throws. Employer/branch upsert failures are logged and surfaced as failures to the admin UI rather than looking like a successful save.
- Admin status changes for job-post enquiries and job-seeker requests now send a best-effort Resend email to the submitter when the status actually changes. Email delivery failure does not undo the saved status. Reopening to `new` also sends an update.
- Apply clicks remain click events, but no longer immediately create an `applied` record. When a visitor returns to the app, it asks “Did you apply?” and stores the application only after confirmation (for signed-in users).
- Public candidate CV/photo upload routes now apply a best-effort per-IP hourly quota, reject oversized request streams before buffering, verify file signatures, and restrict photos to JPEG/PNG. The quota uses Cloudflare Cache API and is intentionally not described as a durable global rate limiter.
- Pages deployment now refreshes the build-only SEO snapshot from the public D1-backed Worker, paginates the vacancy inventory, validates that source data is no older than 72 hours, and only then generates static pages and the sitemap. The committed snapshot remains the local/offline fallback.
- Agency and employer manager links now receive per-vacancy apply-link click and self-reported application counts for the last 30 days. The service-role-only SQL function validates the manager token, returns aggregates only, and never exposes visitor identifiers or applicant contact details. The UI labels self-reports as unverified and keeps manager access working when metrics are unavailable.
- Regression tests were added for the repairs.

## Production actions still required

1. Confirm the Worker and Pages workflows successfully deploy the updated source. A push to `main` is not proof that the deployment completed.
2. Confirm the Worker has `RESEND_API_KEY` and a verified `EMAIL_FROM` domain configured; otherwise submitter notices will be skipped and logged.
3. Check the production Supabase grants for the `20261104042157_restrict_server_only_rpc_execute.sql` migration. The migration is present in the project but its production application state cannot be inferred from source files.
4. Apply `supabase/migrations/20261111100000_manager_vacancy_analytics.sql` to the correct SA Recruiters Supabase project before expecting manager activity totals in production. It grants execution only to `service_role`; the Worker uses its configured `SUPABASE_SERVICE_ROLE_KEY` and returns counts only.

The Supabase connection available during this follow-up identified an unrelated project (`Ekhaya app`), so no production migration or data change was made. Connect the SA Recruiters project before the database checks or migration are run.

Run `npm ci && npm test` before publishing. The Pages build intentionally fails rather than deploying SEO pages when the public Worker data cannot be fetched or is stale/incomplete.

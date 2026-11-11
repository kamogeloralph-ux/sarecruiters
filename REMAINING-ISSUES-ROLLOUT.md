# Remaining-issues repairs and rollout notes

## Changes in this source copy

- The supplied archive already had the watchdog triggers configured for `15,45 * * * *` and `0 */6 * * *`, the matching schedule test, a GitHub Actions test workflow, and the signed-in candidate profile/CV hub. Those findings were already resolved in this copy.
- Employer, branch and vacancy deletion helpers now return failure when Supabase rejects the write or the request throws. Employer/branch upsert failures are logged and surfaced as failures to the admin UI rather than looking like a successful save.
- Admin status changes for job-post enquiries and job-seeker requests now send a best-effort Resend email to the submitter when the status actually changes. Email delivery failure does not undo the saved status. Reopening to `new` also sends an update.
- Apply clicks remain click events, but no longer immediately create an `applied` record. When a visitor returns to the app, it asks “Did you apply?” and stores the application only after confirmation (for signed-in users).
- Public candidate CV/photo upload routes now apply a best-effort per-IP hourly quota, reject oversized request streams before buffering, verify file signatures, and restrict photos to JPEG/PNG. The quota uses Cloudflare Cache API and is intentionally not described as a durable global rate limiter.
- Pages deployment now refreshes the build-only SEO snapshot from the public D1-backed Worker, paginates the vacancy inventory, validates that source data is no older than 72 hours, and only then generates static pages and the sitemap. The committed snapshot remains the local/offline fallback.
- Regression tests were added for the repairs.

## Production actions still required

1. Deploy the Worker and Pages workflow from the updated source. No production deployment was performed here.
2. Confirm the Worker has `RESEND_API_KEY` and a verified `EMAIL_FROM` domain configured; otherwise submitter notices will be skipped and logged.
3. Check the production Supabase grants for the `20261104042157_restrict_server_only_rpc_execute.sql` migration. The migration is present in the project but its production application state cannot be inferred from source files.
4. The audit's requested employer/agency manager dashboards for per-vacancy click and self-reported application totals are not included in this patch. The candidate-facing click/confirmation tracking is in place; exposing aggregate metrics requires a separately authorized manager-scoped data path.

Run `npm ci && npm test` before publishing. The Pages build intentionally fails rather than deploying SEO pages when the public Worker data cannot be fetched or is stale/incomplete.

# SA Recruiters Admin and Application Audit

**Repository:** `/home/ubuntu/work/sarecruiters`
**Audited checkout:** `cbeefc5` (build-ops records full hash `cbeefc5a232f7fc449d244e78f8f62cb56cd9296`)
**Method:** synthesis of six independent, read-only static audits: admin UI, admin data, Worker API, database/migrations, client app, and build/operations.

## Executive summary

The audits identify **15 confirmed issues**, **4 possible orphan / repository-readiness concerns**, and **1 explicitly runtime-unverified test-suite finding**. The highest-risk finding is a SECURITY DEFINER RPC that grants public roles execution and returns employer manager tokens. Other notable concerns include caller-supplied ownership IDs accepted by public submission RPCs, false-success handling in admin mutations, public R2 upload abuse exposure, a Worker cron mismatch, and stale generated SEO snapshots.

These are source-level conclusions, not proof that each path is reachable or exploitable in the deployed environment. No production API calls, SQL execution, browser sessions, deployments, or data mutations were performed. In particular, **end-to-end production admin operation was not verified**: real admin credentials and live production data/configuration were unavailable or not used. Static source wiring for some paths is verified, but deployed auth, RLS, Worker secrets/bindings, live responses and UI behavior remain unverified.

## Scope, limits, and working-tree notes

- Reviewed the checked-out repository read-only. No files were edited by the auditors, and no SQL or production mutations were performed.
- Admin UI/data and Worker audits traced source structure, handlers, callers, route contracts, and error paths; they did not exercise browser/runtime behavior or deployed endpoints.
- Database conclusions are based on checked-in migrations and SQL plus source callers. No live schema, migration history, effective grants, or RLS state was inspected. Missing migration files do not prove that a table is absent in production; it may have been provisioned externally or manually.
- Client-app render and handler paths were checked statically; live payloads, network outcomes, rendering, and external destinations were not tested.
- Build/ops audit ran `npm test`, which exited nonzero with four assertions. No production job or endpoint was run.
- Auditors noted pre-existing local changes: admin UI audit saw a featured-poster icon change; admin-data noted `app-ui.js` and `styles.css` changes outside its reviewed scope; client-app also reported local changes in `app-ui.js` and `styles.css`. Build/ops confirmed local changes in those two files. No audit made edits.

## Confirmed issues

### Critical: public employer-link RPC returns manager token

**Finding:** `database-public-employer-token-rpc` — the public resend RPC exposes employer manager tokens to callers able to invoke the public Supabase API, bypassing the intended Worker email/Turnstile flow.

**Evidence:** `supabase/migrations/20260921_employer_self_service_registration.sql:82-94` defines SECURITY DEFINER `public_resend_employer_link(p_email)` returning `employer_id, name, manage_token`; lines `99-100` grant EXECUTE to `anon` and `authenticated` without revoking `PUBLIC`. `Cloudflare-worker/worker.js:2680-2702` has a route that verifies Turnstile and emails a link with generic success, but the database RPC remains directly callable under those grants.

**Recommended action:** Revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated`; expose token lookup only through a trusted server/service-role path, or redesign the RPC so untrusted callers cannot receive the token. Retain generic Worker responses and rate-limit the endpoint.

### High: public submission RPCs accept arbitrary ownership IDs

**Finding:** `database-forgeable-submission-ownership` — public submission RPC callers can attribute records to arbitrary user IDs.

**Evidence:** `supabase/migrations/20260919_add_saved_vacancies_and_submission_ownership.sql:93-124` inserts `p_user_id` into reports/suggestions and lines `131-132` grant execution to `anon`/`authenticated`. `supabase/migrations/20260923_add_job_post_enquiries.sql:54-78,83` does the same for `public_submit_job_enquiry`; `supabase/migrations/20261014_job_seeker_requests.sql:55-94,96-97` does so for `public_submit_job_seeker`. Worker callers derive IDs through server verification (`Cloudflare-worker/worker.js:2453-2458, 2479-2483, 2517-2527, 2577-2588`), but this does not constrain direct PostgREST RPC calls. Own-row SELECT policies for reports/suggestions (`20260919...sql:75-83`) can make forged records appear as fabricated history to the targeted account.

**Recommended action:** Do not accept a freely supplied `p_user_id` on anon/authenticated-callable SECURITY DEFINER RPCs. Derive authenticated ownership from `auth.uid()` inside the function and use a non-public service-role-only function for verified Worker attribution; otherwise store public submissions without ownership.

### High: Worker cron config does not invoke intended schedules

**Finding:** `cron-config-does-not-match-worker-scheduler` — the configured daily cron does not run the documented watchdog or six-hour sync schedule.

**Evidence:** `Cloudflare-worker/wrangler.toml:31-35` documents watchdog at `15,45` but sets only `crons = ["0 0 * * *"]`. `Cloudflare-worker/worker.js:1990-2024` runs watchdog only for `event.cron === "15,45 * * * *"`; other cron events run deep watchdog and D1 sync. Thus the current configured cron produces one daily sync and never the dedicated frequent watchdog. `scripts/tipchat-autopilot.test.mjs:396` expects the old two-entry cron array and fails against this config.

**Recommended action:** Reconcile intended schedule, Worker handler, and configuration; configure required cron expressions or revise handler/docs, and make the test assert the intended schedule.

### High: SEO snapshot is not refreshed by scheduled ingestion

**Finding:** `seo-snapshot-not-refreshed-by-ingestion` — generated SEO pages and sitemap can remain stale as live app data changes.

**Evidence:** `generate-pages.js:550-571` reads only `data/startup.json` and `data/vacancy-notes.json`. `.github/workflows/refresh-static-data.yml:67-103` runs scraper commands and explicitly does not export or commit a full snapshot. Targeted search found no writer for `data/startup.json` and no ingestion trigger of `deploy-pages`. `Cloudflare-worker/watchdog.js:304-307` says the committed snapshot is no longer refreshed. `.github/workflows/deploy-pages.yml:55-70` regenerates SEO pages only on its own push/manual run.

**Recommended action:** Choose a source of truth for SEO generation—fetch a bounded public Worker/D1/R2 snapshot during build, or wire a safe snapshot export and Pages deployment after ingestion—and add a stale-inventory integration check.

### Medium: employer save reports success after failed write

**Finding:** `employer-save-false-success` — failed employer persistence can be reported as successful and trigger subsequent work.

**Evidence:** `admin.html:1374` `upsertEmployer` alerts on Supabase `employers.upsert` error but returns no failure value. `admin.html:2088-2111` `saveEmployer` unconditionally awaits it, attempts token save for new employers, closes the sheet, shows “Employer registered/updated,” and reloads employers. `saveVacancy` checks the helper's explicit false result (`admin.html:2658-2659`), demonstrating a contrasting pattern.

**Recommended action:** Return an explicit success/failure result from `upsertEmployer`; stop before token writes, success UI, and refresh on failure.

### Medium: branch CRUD reports success after failed writes/deletes

**Finding:** `branch-save-delete-false-success` — failed branch persistence is only logged while the UI closes/shows success and reloads.

**Evidence:** `admin.html:1376-1377` `upsertBranch`/`removeBranch` only log errors and return no outcome. `admin.html:2443-2460` `saveBranch`/`deleteBranch` proceed to close/show success and reload regardless. After delete failure the reload may restore the row; after save failure no explicit error is presented beyond console logging.

**Recommended action:** Return checked outcomes; on error retain edit state and show an actionable error, and show success only after confirmed persistence.

### Medium: failed vacancy deletion is hidden by optimistic cache update

**Finding:** `vacancy-delete-optimistic-failure` — an unsuccessful delete is shown as successful and the row disappears from the current admin cache.

**Evidence:** `admin.html:1389` `removeVacancy` only logs Supabase delete errors and returns no status. `admin.html:2684-2691` always shows “Vacancy deleted,” filters the row from cache, and rerenders without reloading Supabase.

**Recommended action:** Return and check the delete result; only update cache/show success after confirmed persistence. Otherwise retain the row and surface the error.

### Medium: public candidate CV/photo uploads lack route-level abuse controls

**Finding:** `public-r2-upload-abuse` — unauthenticated endpoints allow repeated R2 writes without route-level rate limiting or Turnstile.

**Evidence:** `Cloudflare-worker/worker.js:2803-2815` accepts `POST /api/upload/candidate-cv`, buffers up to 3 MiB and writes `candidate-cvs/<random>` to `MEDIA_BUCKET`, with no auth or `verifyTurnstile`. Lines `2817-2833` similarly allow unauthenticated photo uploads up to 3 MiB to selectable prefixes. Unlike these routes, poster submission at `2835-2844` verifies Turnstile. `app-forms.js:129-151` calls CV/photo endpoints before form submission, indicating deliberate public workflows, but direct repeated uploads remain possible.

**Recommended action:** If public upload is required, add abuse controls (Turnstile and/or durable rate/size quotas), validate actual file signatures/types, and consider cleanup for abandoned uploads.

### Medium: active Worker deployment workflow omits service-role secret synchronization

**Finding:** `actual-worker-deploy-omits-admin-key-sync` — the GitHub Actions workflow that deploys the Worker omits a secret-sync step present in a duplicate file.

**Evidence:** `.github/workflows/deploy-worker.yml:46-55` deploys the Worker then proceeds to D1 migrations, without setting `SUPABASE_SERVICE_ROLE_KEY`. `Cloudflare-worker/deploy-worker.yml` is outside GitHub Actions' workflow discovery directory; its lines `50-60` contain the missing synchronization step. `Cloudflare-worker/worker.js:2079-2083` returns 503 for admin auxiliary reads if the Worker secret is absent. Static inspection cannot establish whether the secret is already configured via dashboard or another mechanism.

**Recommended action:** Put intended secret synchronization in the active workflow or explicitly manage the secret through a supported deployment mechanism; consolidate or remove the inactive duplicate to prevent drift.

### Medium: advertised daily-track expiry has no reachable caller

**Finding:** `admin-track-retention-uninvoked` — cleanup is defined but no call path invokes it, despite automatic-deletion messaging.

**Evidence:** `admin.html:482-490` says tracks are automatically deleted after one week. `cleanupOldTracks` at `3348-3370` deletes tracks older than `TRACK_RETENTION_DAYS`, including R2 objects, but bounded whole-file search found only its definition and no call site. `enterConsole` (`1091-1110`) loads tracks/checks the table without calling it; save/delete paths (`3411 onward`, `3528 onward`) do not call it. The `loadAll` comment near `900` says destructive expiry cleanup is intentionally not run at startup. No UI button or other caller exposes it.

**Recommended action:** Wire cleanup into an intentional authenticated lifecycle/action with failure handling and accurate semantics, or remove/qualify the automatic-deletion claim. Do not assume runtime cleanup occurs until verified.

### Medium: scraper failures can leave refresh workflow green

**Finding:** `scraper-failures-do-not-fail-refresh-job` — feed failures are recorded but need not fail the workflow or reliably alert.

**Evidence:** `.github/workflows/refresh-static-data.yml:72-90` `run_source` appends failed names but never returns failure; lines `94-97` mark failure-report step `continue-on-error`. `scripts/scraper-failure-report.mjs:44-46` catches errors and sets `process.exitCode = 0`.

**Recommended action:** Continue across sources, then add a final failure step when `failed-sources.txt` is non-empty; separately surface notification failures in job status or a reliable alert channel.

### Medium: featured vacancy direct-apply link bypasses existing apply tracking

**Finding:** `featured-vacancy-apply-untracked` — the daily featured card's click does not meet the existing listener's tracking condition.

**Evidence:** `app-ui.js:354-362` renders the featured card as an external anchor without `data-vacancy-id` or a click handler. `app-alerts.js:61` only processes apply-labelled anchors when a closest ancestor has `data-vacancy-id`; it then tracks `vacancy_apply_click` and, for signed-in users, upserts `vacancy_applications`. Ordinary vacancy CTA markup tracks clicks (`app-vacancy-v2.js:84-94`).

**Recommended action:** Add an explicit handler or a vacancy ID on an ancestor recognized by `app-alerts.js`; verify intended tracking/applied-status semantics, since visiting an external application page does not itself prove an application was submitted.

### Low: public candidate-photo upload trusts MIME label and stores misleading metadata

**Finding:** `public-candidate-photo-validation` — caller-supplied image MIME is not checked against bytes and storage is always labeled JPEG.

**Evidence:** `Cloudflare-worker/worker.js:2817-2833` checks only that Content-Type starts with `image/`, then stores raw bytes under a `.jpg` key with `contentType image/jpeg`; no JPEG signature/decode validation is performed. Admin logo/photo callers include `admin.html:1845, 1877, 1923, 2078`.

**Recommended action:** Validate supported image formats from bytes and either normalize to JPEG or preserve validated format and matching metadata; apply consistently to all callers.

### Low: analytics silently caps counted rows at 10,000

**Finding:** `analytics-hard-limit` — displayed 30-day counts may be partial without notice.

**Evidence:** `admin.html:1723-1728` queries `analytics_events` for the last 30 days with `.limit(10000)`, then calculates event and unique-session counts solely from returned rows. No cursor/next-page or truncation indication is handled.

**Recommended action:** Aggregate server-side or paginate through the full filtered set; if retaining the cap, disclose truncation rather than presenting partial counts as complete.

### Low: no checked-in CI workflow runs the test suite

**Finding:** `automated-test-coverage-gap` — a test command exists but is not invoked by repository workflows.

**Evidence:** `package.json:13` defines `npm test`. No workflow under `.github/workflows` runs tests; Pages deployment runs `npm ci` and `generate-pages.js` only (`.github/workflows/deploy-pages.yml:52-56`).

**Recommended action:** Add non-production CI for `npm ci`, `npm test`, and relevant static build/snapshot validation; keep mutating scheduled operations out of that job.

## Possible orphan features and repository-readiness concerns

These are not confirmed runtime failures. A missing caller or migration in this repository does not prove a feature is unused or absent in a deployed environment.

### Legacy admin loaders appear unused

**Finding:** `legacy-admin-loaders`.

**Evidence:** `admin.html:1251-1261` defines `getReports`, `getSuggestions`, and `getJobEnquiries`; targeted reference search found only definitions. Current `loadAll('aux')` uses `getAdminAuxiliaryData` and assigns those values from the Worker response (`admin.html:1552-1568`); Worker maps keys to `reports`, `suggestions`, and `job_post_enquiries` (`Cloudflare-worker/worker.js:2085-2119`). The legacy helpers catch failures and return empty arrays, which could mask errors if reactivated.

**Recommended action:** Remove if obsolete or route callers through the unified, surfaced-error loader; verify no dynamic references before removal.

### Table-creation migrations not found for referenced features

**Finding:** `database-missing-feature-schema-migrations`.

**Evidence:** `admin.html:1436, 1452-1455` upserts/updates `vacancy_alert_queue`, but no SQL file creates it. `app-forms.js:517-525` inserts `manager_terms_acceptances`, with no table migration found. `admin.html:1298, 3497-3548` queries/writes `daily_tracks`; the only matching migration, `supabase/migrations/20261011_add_spotify_url_to_daily_tracks.sql:2-9`, alters rather than creates the table. Admin code warns about missing `daily_tracks` at `admin.html:3284-3289, 3545-3550`. These tables may have been provisioned outside the repository.

**Recommended action:** Add versioned migrations with exact columns, constraints, indexes, grants and RLS, or document the authoritative external prerequisite and deployment check. Verify deployed schema separately.

### Checked-in migration history lacks foundational schema

**Finding:** `database-incomplete-base-schema-history`.

**Evidence:** The `supabase/migrations` inventory begins at `20260914072349_add_pnet_scraper_tracking_columns.sql` and contains feature/alter migrations, not creation of foundational `public.agencies`, `employers`, `vacancies`, `pool_candidates`, `admin_users`, `reports`, `suggestions`, `app_settings`, or `daily_tracks`. For example, `supabase/migrations/20260918_lock_down_manager_tokens.sql:40-50, 95-101, 273-350` assumes tables already exist; `20260919_add_saved_vacancies_and_submission_ownership.sql:67-83` assumes reports/suggestions and existing policies. Standalone SQL files are additive. Existing deployments may have created the base schema separately.

**Recommended action:** Document the authoritative base-schema source and migration order, or check in a baseline suitable for a clean project. Test against a disposable empty project, not production.

### Vacancy redesign module — resolved

**Status:** Resolved during repository cleanup.

**Evidence:** `app-vacancy-redesign.js` had no runtime or build reference. The active app loads `app.bundle.min.js` and `app-vacancy-v2.js`, which provides the current render and filter handlers.

**Action taken:** Removed the unreferenced alternative script; the active vacancy UI remains in `app-vacancy-v2.js`.

### Duplicate nested Worker deployment workflow may be orphaned

**Finding:** `nested-worker-workflow-possible-orphan`.

**Evidence:** Both `Cloudflare-worker/deploy-worker.yml` and `.github/workflows/deploy-worker.yml` are tracked. The nested path is outside GitHub Actions workflow discovery; it includes service-role secret sync absent from the active workflow. Static inspection cannot establish whether another tool consumes the nested YAML.

**Recommended action:** Maintain one authoritative workflow under `.github/workflows`; remove or clearly label the nested copy if it is template/documentation-only.

## Code paths verified present (static source only)

These checks confirm source-level definitions/wiring, not live runtime success.

### Admin service-role boundary and route/client contracts

**Evidence:** `Cloudflare-worker/worker.js:37-63` validates bearer tokens via Supabase `/auth/v1/user` and checks `admin_users` by verified user ID. Admin vacancy/D1 write-through handlers gate at `1423-1425, 1492-1495`; auxiliary, sync, submissions, job-enquiry, job-seeker, poster and alert routes gate before privileged operations at `2075-2084, 2127-2133, 2146-2152, 2164-2170, 2195-2200, 2232-2237, 2266 onward, 2704 onward`. Service-role credentials are read from Worker env, not returned to clients. This is source-only; deployed auth/RLS is unverified.

**Evidence:** `admin.html:779-784` sets Worker URL and derives authorization from Supabase session. Migration/delete calls (`admin.html:796, 831, 852`) match Worker routes (`worker.js:2962-2988`). Vacancy paging expects `{vacancies,next_cursor}` (`admin.html:1206-1233`) matching `worker.js:1423-1489`. D1 write-through sends allowlisted `{operation,table,rows|ids}` (`admin.html:1141-1186`) matching validation and response shape (`worker.js:1492-1534`). Submission/auxiliary callers (`admin.html:1235-1249`) align with `worker.js:2146-2160, 2075-2119`; poster/job-seeker/job-enquiry callers map to Worker route patterns (`worker.js:2195-2267`) and admin call sites (`admin.html:2355-2367, 3015-3022, 3117-3146`).

**Recommended action:** Preserve route/client contract tests as either side changes; separately verify deployed bindings, admin membership, and live outcomes using an authorized runtime review without exposing credentials.

### Featured-card selection/render and app asset

**Evidence:** `app-ui.js:319-334` filters expired rows, requires title and HTTP(S) link, sorts newest first, and rotates among up to 20 eligible rows by day. `app-ui.js:445-448` builds the home feed; `503-505` calls `renderHomeFeaturedVacancy(homeSourceVacancies())`, rendered at `335-362`. It links to the validated URL in a new tab and uses `icons/v2-icon-512.png`, which exists as a 512×512 PNG. `app-cards.js:542` rerenders after cache filtering; `app-data.js:1278` calls `filterAndRenderCached` after load/refresh.

**Recommended action:** Keep eligibility/expiry checks and logo reference; validate live selection, destination, and empty/error-data cases in a browser. Apply the separately noted tracking fix.

### Standard vacancy save/share and retry-refresh wiring

**Evidence:** `app-vacancy-v2.js:136-137` emits `toggleSave`/`shareVacancy` actions. `app-cards.js:884-905` persists saves to localStorage, calls `syncSavedVacancy`, and renders saved vacancies; `app-core.js:405-431` loads/merges authenticated saves and syncs mutations. `app-manager.js:114-128` implements sharing and `423-432` exposes it on `window` for generated inline calls. `index.html:233` wires `retryLoadAll`; `app-ui.js:758-763` invokes `loadAll({fresh:true})`; `app-data.js:1184-1250` handles startup/live results, preserves prior caches on load errors, sets status/retry banner, and `1271-1285` refreshes stats, vacancy rendering, secondary data and cache.

**Recommended action:** Retain the `window` bridge for classic/generated inline handlers and include runtime service/error-path checks in browser or integration testing.

## Runtime-unverified checks and observed test failures

### Test suite currently fails four assertions

**Finding:** `test-suite-current-failures` (runtime-unverified as to production health; test execution itself was performed locally).

**Evidence:** `npm test` exited nonzero. Failures reported: `homepage-redesign.test.mjs:188` (light navigation SVG styling), `seo-pages.test.mjs:206,229` (dark background and brand color expectations), and `tipchat-autopilot.test.mjs:396` (expects six-hour-plus-30-minute cron expressions while `wrangler.toml` configures one daily cron). This does not establish production runtime health, nor a failing feed parser/build.

**Recommended action:** Decide intended styles/schedule, update assertions only to match that decision, and rerun. Treat the cron assertion alongside the confirmed schedule mismatch; do not interpret the three visual failures as feed/build failures.

### Checks requiring real admin credentials/data or deployed configuration

The audits did not establish the following; they require an authorized runtime review with real admin credentials and representative data/configuration:

- End-to-end login, session authorization, admin UI navigation, forms, upload, CRUD, refresh and error behavior in a browser.
- Effective deployed Supabase grants/RLS, live schema/migration state, and whether externally provisioned tables exist.
- Live Worker bindings/secrets (including `SUPABASE_SERVICE_ROLE_KEY`), route responses, queue state, Turnstile behavior, R2 effects, and actual production admin membership/auth behavior.
- Whether the admin false-success paths manifest under real network/database errors, whether cleanup ever runs through external mechanisms, and the actual analytics volume/truncation impact.
- Current live vacancy payloads, featured card rendering, external destinations, and actual user interaction tracking.
- Whether the nested workflow is consumed by any external system, and whether a dashboard-managed secret compensates for the active workflow omission.

## Failed or blocked audit subtasks

The input reports **no failed or blocked audit subtasks** (`Audit failures: []`). Several runtime checks were intentionally out of scope/unavailable as specified by individual audits: no production API calls, SQL execution, browser/runtime session, credentials, deployed configuration/schema inspection, or mutations were performed. These are coverage limits, not failed static-audit subtasks.

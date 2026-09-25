# SA Recruiters PWA Reliability Audit

**Author:** Manus AI  
**Repository:** `/home/ubuntu/sarecruiters`  
**Status:** Planning report only — **no application code, configuration, migrations, or deployment files were modified**.  
**Basis:** Supplied multi-area production audit, read-only source verification of the cited implementation paths, and the benchmark observations supplied with the audit.

## Executive decision

SA Recruiters has useful resilience foundations: an installable manifest, a cached shell, IndexedDB restoration, an eight-second startup abort, online/offline messaging, and a Worker-backed startup aggregate. Those foundations are being undermined by a small number of high-consequence correctness and update-design flaws.

The first release must address five P0 outcomes. Server-side authorization must prevent ordinary authenticated users from rotating manager bearer tokens. The startup aggregate must obey its intended freshness policy and return correct counts. D1 synchronization must never publish a partial snapshot. A service-worker update must not replace a known-good offline shell with a partial cache or take control of an open old-generation page without a user decision. Finally, cold startup must stop duplicating the aggregate request and fetching a 5.54 MB audio file before a user asks to play it.

After those P0 fixes, P1 work should make the mobile application genuinely keyboard and dialog accessible, make navigation URL-owned, bound runtime caches, correct pagination/error semantics, and eliminate render-blocking third-party work from the home path. P2 work should complete immutable deployment versioning, security headers, observability, and production performance governance.

> **Release rule:** Do not combine the service-worker lifecycle redesign, D1 snapshot migration, and authorization migration in an untested broad release. Each changes a recovery boundary. Deploy them behind measurable integration tests and retain a verified rollback path.

## Scope, confidence, and constraints

This report synthesizes the supplied startup, cache, data, admin, and mobile audits. It also rechecked key source anchors in `sw.js`, `Cloudflare-worker/worker.js`, `app-data.js`, `app-manager-employer.js`, `index.html`, `admin.html`, `generate-pages.js`, `Cloudflare-worker/wrangler.toml`, and `supabase/migrations/20260918_lock_down_manager_tokens.sql`. The repository was clean before this report was added; no runtime behavior was changed.

The performance figures came from a temporary localhost static server. They are strong evidence for shipped bytes, fetch ordering, JavaScript/CSS coverage, and client behavior, but not evidence that production omits compression or cache headers. The live-header observations supplied with the audit are dated **2026-09-24**. The Supabase dashboard, applied historical RLS policies, production D1 schema, Cloudflare dashboard header rules, secrets, and production user telemetry were outside this read-only review. In particular, the token-RPC issue is a **critical deployed exposure if the cited migration is applied as written**; deployment state must be confirmed immediately.

## Benchmark summary and release budgets

### Baseline observations

| Dimension | Observed baseline | Meaning |
|---|---:|---|
| Lighthouse 12.8.2 performance score | 0.41 | The local cold-load path has substantial startup work and delayed meaningful interactivity. |
| First Contentful Paint | 3.5 s | The initial visual response is slow for a mobile directory shell. |
| Largest Contentful Paint | 7.8 s | The user-facing listing experience is materially delayed. |
| Speed Index / Time to Interactive | 9.0 s / 9.9 s | Rendering and useful interaction remain delayed long after navigation. |
| Total Blocking Time | 850 ms | Bundle parsing/execution and third-party work exceed a responsive-input budget. |
| Cumulative Layout Shift | 0 | Preserve this positive result while changing loading behavior. |
| Total page transfer | 7,102 KiB | The cold page is dominated by a nonessential audio transfer. |
| Daily-track MP3 | 5,535,404 bytes | `audio.src` plus `audio.load()` triggers background media retrieval before play intent. |
| `app.bundle.min.js` | 273,000 raw / 62,609 gzip bytes | Lighthouse attributed 207,515 bytes of potentially unused JavaScript on the home view. |
| `styles.css` | 152,384 raw / 30,521 gzip bytes | Lighthouse attributed 105,943 bytes of potentially unused CSS. |
| `content.js` | 35,605 raw / 12,262 gzip bytes | It adds another startup script resource. |
| Startup aggregate requests | Three transfers of about 134 KB | The pre-auth setting check, normal boot, and spotlight fallback can independently fetch the same aggregate. |
| Startup outer HTTP cache | `public, max-age=86400, s-maxage=86400` | It defeats the Worker’s intended 1-hour fresh / 3-hour stale-while-revalidate policy by allowing CDN delivery without Worker execution. |

The reported local transfer and timing values should become **regression baselines**, not production service-level claims. The following gates are proposed for an emulated mobile cold load after functional repairs. They are deliberately measurable and can be adjusted only through a recorded performance-budget review.

| Metric | Proposed release gate | Measurement condition |
|---|---:|---|
| Initial `/api/startup` aggregate requests | Exactly 1 per page load | Network recording with cache disabled; no candidate spotlight double-fetch. |
| Daily-track media before first Play | 0 bytes and no media request | Cold load, card visible, no play interaction. |
| Home-owned JavaScript transferred | ≤ 60 KiB gzip excluding third-party runtime | Production build; only home shell and immediately visible directory code. |
| Non-image/non-media cold transfer | ≤ 1.5 MiB | Mobile cold run; document exceptions in the test result. |
| Lab LCP | ≤ 2.5 s target, ≤ 4.0 s release ceiling | Production HTTPS, mobile emulation, throttled network/CPU, median of at least five runs. |
| Lab TBT | ≤ 200 ms | Same test profile. |
| CLS | ≤ 0.10 | Same test profile. |
| Navigation fallback | Cached shell or offline screen returned within 4 seconds | Stalled navigation simulation after a successful install. |
| Startup data age | Visible and derived from payload `generated_at` | Fresh, stale, and fallback test cases. |

Use field Core Web Vitals in addition to laboratory checks. The Web Vitals targets are useful operating thresholds, while the exact release ceiling should be governed by production percentiles and device/network cohorts rather than a single developer workstation.[1]

## Priority order

| Priority | Required outcome | Principal files | Exit criterion |
|---|---|---|---|
| **P0-1** | Eliminate authorization bypasses and insecure bearer-token issuance. | New `supabase/migrations/20260925_admin_authorization_hardening.sql`; `admin.html`; `Cloudflare-worker/worker.js`; `Cloudflare-worker/wrangler.toml`; `.github/workflows/deploy-worker.yml` | Anonymous and ordinary authenticated users cannot read, mutate, rotate, upload, or delete privileged resources; existing manager tokens are replaced. |
| **P0-2** | Make startup data correct, bounded in freshness, and atomically published. | `Cloudflare-worker/worker.js`; new `Cloudflare-worker/migrations/0001_d1_snapshot_generations.sql`; `Cloudflare-worker/wrangler.toml`; `app-data.js`; Worker deployment workflow | Startup total reconciles with mutually exclusive buckets; failed D1 sync never changes the active snapshot; each response exposes its true data age. |
| **P0-3** | Make service-worker updates safe and deterministic. | `sw.js`; `app-manager-employer.js`; `generate-pages.js`; `.github/workflows/deploy-cloudflare-pages.yml` | A failed precache retains the current worker/cache; update waits for explicit approval; slow navigation reaches cache/fallback within the timeout. |
| **P0-4** | Remove avoidable cold-start work and duplicate aggregate fetches. | `app-data.js`; `app-manager-employer.js`; `index.html`; bundle entry/module files referenced by `scripts/bundle-app.js`; `scripts/bundle-app.js` | One aggregate request, no eager audio, and only home-critical code on the first route. |
| **P1** | Make interaction, mobile navigation, cache retention, and errors accessible and reliable. | `index.html`; `app-cards.js`; `app-sheets.js`; `app-ui.js`; `app-data.js`; `styles.css`; `ios-blue-ui.css`; `sw.js` | Keyboard, modal, Back/Forward, pagination, and first-/repeat-offline scenarios pass browser tests. |
| **P2** | Complete deployment invalidation, security headers, monitoring, and continuous budgets. | `generate-pages.js`; Pages header configuration; `manifest.json`; `admin.html`; workflows; new test/telemetry files | Every mutable asset is versioned or revalidated; headers and RUM/alerting are validated on production HTTPS. |

# P0 fixes

## P0-1 — Enforce privileged authorization at the server boundary

### Risk and root cause

The migration `supabase/migrations/20260918_lock_down_manager_tokens.sql` defines `admin_set_manager_token` and `admin_set_employer_manager_token` as `SECURITY DEFINER` functions. Both only check that `auth.uid()` is non-null, while both are executable by every `authenticated` user. The functions can rotate bearer credentials that authorize manager writes. A comment calls them admin-only, but the function logic does not establish that property.

The `/admin` page compounds the risk. It uses a browser-side `isAuthorizedAdmin()` check, then performs many direct table writes and deletes. Client-side routing and UI checks cannot be treated as authorization. Server-side policies must deny unauthorised requests regardless of what a modified client sends.[2] The admin page also uses a mutable major-version unpkg URL, an additional third-party Ninja script, default persistent Supabase session storage, and no observed response CSP. This increases the blast radius of an XSS or supply-chain compromise.

### Required implementation

1. **Add, do not rewrite deployed migration history.** Create `supabase/migrations/20260925_admin_authorization_hardening.sql`. In replacement versions of both token-rotation functions, require an `EXISTS` check against `public.admin_users` for `auth.uid()`. Fail closed, retain a safe fixed `search_path`, revoke `EXECUTE` from `PUBLIC` and `anon`, and grant only the minimum role required by the approved call path. Add a database test that demonstrates failure for an ordinary signed-in user and success for an approved administrator.

2. **Inventory and enforce RLS for every admin-managed table.** The same migration must explicitly enable and verify Row-Level Security (RLS), grants, and `USING`/`WITH CHECK` policies for agencies, employers, branches, vacancies, pool candidates, posters, reports, suggestions, tracks, job enquiries, analytics, and application settings. Public read paths must be separately narrow and use redacted views where required. Admin access must be based on a server-enforced membership predicate. An RLS policy must cover `SELECT`, `INSERT`, `UPDATE`, and `DELETE`; a UI lookup is not a substitute.[2]

3. **Move manager-token lifecycle to a privileged endpoint.** Add authenticated administrator-only token issuance/rotation to `Cloudflare-worker/worker.js`, such as a scoped `/api/admin/manager-tokens` route. Generate at least 32 random bytes with server cryptography, encode base64url, store only a hash/verifier where the manager-link verification design permits, and attach expiry, revocation time, last-use time, capability scope, and audit identifiers. Update `admin.html` to call this endpoint rather than `genToken()` at line 869 and direct token RPCs. Update the manager verification functions in a new Supabase migration to compare the hashed verifier safely. Immediately rotate all existing `Math.random()`-derived tokens after release. Security-critical tokens require a cryptographically secure random generator rather than `Math.random()`.[3]

4. **Require authentication for media routes by intent and prefix.** In `Cloudflare-worker/worker.js`, require verified administrator authority for agency, employer, and vacancy image upload prefixes and all destructive R2 operations. A candidate self-service upload, if retained, must have its own ownership, Turnstile, rate, size, decoded-image validation, and key-prefix policy. Change the affected upload calls in `admin.html` to send `r2AuthHeader()` consistently, and reject unauthenticated requests server-side.

5. **Harden the privileged delivery boundary.** Remove the Ninja script from `admin.html`. Self-host or pin a specific immutable Supabase build, preferably as a reviewed first-party static asset. Refactor inline scripts and event handlers as necessary to support a strict nonce- or hash-based CSP. At the Pages/Cloudflare header layer, set a tailored CSP with `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and only the required `connect-src`, `img-src`, and media origins. Also set `Strict-Transport-Security`, `Permissions-Policy`, and `Cache-Control: no-store` for authenticated admin API responses. CSP and SRI are complementary controls for limiting script execution and verifying third-party asset integrity.[4]

6. **Repair session and mutation semantics.** In `admin.html`, subscribe to `supabaseClient.auth.onAuthStateChange`. On sign-out or entitlement loss, cancel in-flight work, clear sensitive memory state, close sheets, and return to login. Replace `remove*`, `upsert*`, and submission methods with one typed mutation wrapper that checks response status, errors, and affected row counts. Callers must change the UI or show a success toast only on confirmed success. For permanent deletion, bulk token rotation, publication, and high-risk setting changes, require server-enforced recent reauthentication/MFA and transaction-specific confirmation rather than browser `confirm()` alone.[5]

7. **Replace client-triggered irreversible cleanup.** Remove the `purgeExpiredVacancies()` call from `admin.html` startup and remove `cleanupOldTracks()` from ordinary console entry. Implement scheduled, audited server-side archival/retention logic once a canonical eligibility policy is approved. Media/database changes should use a privileged operation record with ordered commit, retries, and compensating cleanup; do not delete media before the database mutation is confirmed.

### Validation tests

| Test | How to validate | Pass condition |
|---|---|---|
| Token RPC negative authorization | New Supabase SQL/API integration test using anon, ordinary authenticated, and admin JWTs. | Only the approved admin identity can rotate either token; all other calls return an authorization failure and do not alter a record. |
| RLS matrix | Test every admin table/action across anon, ordinary user, manager-token holder, and admin. | Deny-by-default behavior holds for every unapproved tuple; public views expose only intended columns. |
| Token quality/lifecycle | Unit-test issued token format, verifier storage, expiry, revocation, and rotation. | No plaintext verifier is selected by standard admin reads; expired/revoked tokens cannot mutate. |
| Admin session boundary | Browser test signs out in another tab and revokes access during an open console. | Original tab hides data and privileged controls immediately after auth event; server requests remain denied. |
| Mutation truthfulness | Force a 403/500 and zero-row result for each representative save/delete. | The UI retains the prior state, shows an error/retry path, sends no alerts, and records a failed audit event. |
| Media authorization | Call upload/delete endpoints without auth and with a non-admin JWT. | Requests are rejected; valid admin request writes only within an approved prefix. |

## P0-2 — Correct and atomically publish startup data

### Risk and root cause

`Cloudflare-worker/worker.js` sets internal startup freshness at 3,600 seconds and stale allowance at 10,800 seconds. Its response currently advertises `Cache-Control: public, max-age=86400, s-maxage=86400`, so an outer CDN cache can satisfy requests for a day without invoking the Worker’s freshness logic. The supplied production observation showed `cf-cache-status: HIT` with a growing `Age`, including a request with a unique query parameter.

The D1 path also reports an incorrect `counts.vacancies`: it adds general and dedicated counts plus the fetched startup subset, but omits `generalPoolCount` while `counts.general` includes it. The supplied live comparison observed 5,836 instead of 8,213, exactly missing the 2,377 general-pool rows.

Finally, `replaceD1Table()` deletes a live table then inserts chunks, and `syncD1FromSupabase()` replaces the tables serially. One API error can publish an incomplete cross-table state. The current D1 eligibility test only requires a nonempty agencies table. D1 batch rollback applies to an individual batch; it does not make independent deletes, chunks, and tables a single snapshot transaction.[6]

### Required implementation

1. **Correct outer and inner cache layering in `Cloudflare-worker/worker.js`.** Retain a Worker Cache API/D1 snapshot with the intended one-hour fresh and three-hour stale-while-revalidate logic, but return `/api/startup` with an HTTP policy that makes the request enter the Worker, such as `Cache-Control: max-age=0, must-revalidate` after confirming the desired Cloudflare behavior. Do not rely on a one-day CDN response for an endpoint that requires Worker freshness checks. Emit `ETag`, `X-Data-As-Of`, `X-Data-Source`, and the same authoritative `generated_at` in the JSON. The browser must display the payload timestamp rather than assign `Date.now()` as the refresh time.

2. **Correct the aggregate count contract.** In `loadStartupDataFromD1()` in `Cloudflare-worker/worker.js`, make `counts.vacancies` include all mutually exclusive buckets, including `generalPoolCount`. Refactor counts to a single grouped query or a single named count-contract helper so that the total and each displayed folder share semantics. Define whether counts mean all stored records or currently eligible records. Add a contract assertion: `total = general + assigned/startup + dedicated`, with every input category mutually exclusive.

3. **Publish generation-based D1 snapshots.** Add `Cloudflare-worker/migrations/0001_d1_snapshot_generations.sql` and commit all D1 DDL/migrations from this point forward. Create a generation metadata record and a completed-snapshot manifest containing generation ID, source counts, checksum/version, start time, completion time, and status. Sync into a new generation, validate every table and expected count, then atomically flip one `active_generation` metadata row. All D1 reads must filter by the active completed generation. Keep the prior completed generation until after a successful flip. The fallback selector must require a valid completed manifest, not merely one agency row.

4. **Make every mirrored source paginated and validated.** Replace single-call reads for agencies, branches, employers, pool candidate public view, and settings with an explicit paging helper or a documented hard constraint below the backend page cap. Capture source row totals and reject a snapshot when a table unexpectedly truncates. The existing vacancy pagination is a useful model.

5. **Connect ingestion to invalidation.** After an approved administrative mutation or scraper write, invoke an authenticated targeted refresh/invalidation route in `Cloudflare-worker/worker.js`, then invalidate the startup object. The six-hour cron in `Cloudflare-worker/wrangler.toml` remains an eventual-consistency backstop, not the only propagation mechanism. Add the route to `.github/workflows/deploy-worker.yml` or the ingestion workflows rather than relying on a manual operator action.

6. **Align expiry with the data model.** Select one policy. If an explicit closing date is authoritative, normalize it into a UTC `expires_at`/eligibility field at ingestion, index it, and use it identically in list, count, and aggregate queries. If source verification is authoritative, remove the conflicting daily age-delete migration and implement source-specific verification with an audit reason. The current comment saying TTL deletion is retired conflicts with the tracked scheduled deletion migration; that contradiction must be resolved before further cleanup automation.

7. **Coalesce page startup reads in `app-data.js`.** Create one memoized, abortable `getStartupPayload()` promise per active load generation. The pre-auth employer-registration state, `loadAll()`, and candidate spotlight must all consume that promise. Reset it only after a terminal error or an intentional refresh generation. Keep a narrowly scoped settings endpoint only if it demonstrably must precede normal boot. Add one shared fetch wrapper with timeout, abort propagation, limited jittered retry for transient read failures, and response generation checks.

### Validation tests

| Test | How to validate | Pass condition |
|---|---|---|
| Cache-layer test | Issue two `/api/startup` requests after changing internal cache age in a Worker integration harness. | The second request reaches Worker freshness logic; stale data triggers background refresh only within the approved stale window. |
| Count reconciliation | Fixture with general, general-pool, assigned, employer, and dedicated rows. | Reported total equals the sum of mutually exclusive buckets, including general-pool rows. |
| Partial-sync failure | Inject a failing source call and a failing insert chunk in D1 sync test. | Active generation and its visible data remain the prior complete snapshot; failure metadata is recorded. |
| First successful snapshot | Start with empty D1, complete a sync. | Only then does the Worker serve D1; manifest exposes source counts and completion time. |
| Pagination-cap test | Seed more than 1,000 rows for each mirrored table. | Snapshot count matches source count for every table. |
| Invalidation propagation | Perform representative write/ingestion, invoke approved invalidate/sync path. | Startup response changes within the documented SLO and exposes the new `generated_at`. |
| Browser request coalescing | Cold-load network test with spotlight and employer registration enabled. | Exactly one aggregate request occurs; consumers receive the same payload or same error generation. |

## P0-3 — Make service-worker update and offline behavior safe

### Risk and root cause

`sw.js` performs a non-atomic core precache, catches individual failures, always calls `skipWaiting()`, then activates and deletes older SA Recruiters caches. An incomplete deployment can therefore replace a known-good offline shell with a partial one. Immediate activation also conflicts with the page’s advertised user-controlled banner: an existing document can remain old while the new worker claims it. A service worker should normally leave a failed install discarded so the old worker remains authoritative; `skipWaiting()` and `clients.claim()` should be deliberate, tested lifecycle decisions rather than unconditional defaults.[7]

The current public listing strategy is cache-first indefinitely, runtime/image caches have no expiry or cardinality control, navigation fetches have no timeout, and several cache writes are not retained using the fetch event lifetime. Cache Storage does not use HTTP expiry automatically, so these are application responsibilities.[8]

### Required implementation

1. **Make required precache atomic in `sw.js`.** Separate the minimum offline shell from optional assets. Fetch all required shell files with `cache: 'reload'`, validate each response, use `cache.addAll()` or an equivalent all-or-reject transaction, and let install reject if any required item is missing. Required assets include the route shells, their critical CSS/JS, offline page, and necessary icons. Cache optional media and nonessential assets only after the successful required install.

2. **Use a genuine waiting-worker update flow.** Remove install-time `self.skipWaiting()`. Retain the message handler, but invoke it only after the user chooses the existing update banner action. In `app-manager-employer.js`, check `registration.waiting` immediately after registration as well as `updatefound`; on explicit reload, persist safe transient state, send `{type: 'SKIP_WAITING'}` to the waiting worker, wait once for `controllerchange`, and reload. Decide whether `clients.claim()` is needed after that controlled reload; avoid it if cross-generation control remains possible. This follows the conventional explicit update flow.[9]

3. **Use abortable four-second navigation fallback.** Replace the plain `fetch(request)` in `networkFirstNavigation()` with a true aborting timeout, not only a promise race. On timeout, first return an exact cached listing for listing navigation or the appropriate cached shell for SPA/admin navigation, then `offline.html` only if no valid fallback exists. Enable and consume navigation preload if verified across target browsers to avoid worker-startup navigation delay.[10]

4. **Change public listing caching to network-first plus bounded fallback.** For `/agency`, `/vacancy`, and `/poster`, use a short-timeout network-first response, cache a successful result, and fall back to the exact cached listing or `offline.html`. If stale-while-revalidate is selected instead, add an explicit TTL and a client-visible refresh notification. Include generated page content or a deterministic content-revision manifest in the version input.

5. **Bound runtime caches and retain writes.** Replace catch-all same-origin and cross-origin caching with route allowlists. Create separate cache names for listings and images. Enforce max entries, max age, LRU/expiry behavior, and quota purge recovery. Attach all cache updates to `event.waitUntil()` while returning the response immediately. This is the lifecycle mechanism that preserves background cache work after a fetch handler returns.[11]

6. **Complete versioning in `generate-pages.js`.** Add `ios-blue-ui.css`, `icons.svg`, current icon assets, all shell dependencies, and generated listing revision inputs to `STATIC_ASSETS`. Extend `rewriteAssetUrls()` to version these resources or replace them with fingerprinted filenames. Stable URLs must revalidate; content-addressed URLs may receive long-lived immutable cache headers. Do not use a service-worker version bump as the only invalidation path.

### Validation tests

| Test | How to validate | Pass condition |
|---|---|---|
| Atomic update failure | Serve a candidate `sw.js` whose required bundle returns 404 during install. | Existing worker/cache continues serving its verified offline shell; candidate is not activated. |
| Explicit update | Open old client, deploy new worker, inspect state before/after banner action. | Worker waits until user action; no cross-generation control before reload; one reload follows `controllerchange`. |
| Slow navigation | Stall navigation response longer than four seconds after a successful install. | Cached shell/listing or offline page is returned by the deadline. |
| Listing freshness | Visit listing, change generated data, deploy data-only revision, revisit online then offline. | Online response refreshes; offline fallback matches the bounded latest cached version, not an indefinite stale page. |
| Cache-pressure test | Request many images, query variants, and listings; inspect storage estimate. | Entries remain within configured limits and app stays usable after eviction/quota handling. |
| Offline retention | Navigate, wait for worker idle, disable network, reload. | Assets and listing/shell cached during prior online use remain available. |

## P0-4 — Remove redundant startup work and media contention

### Risk and root cause

The initial home path carries route code that the home view does not need. It also makes independent no-store startup aggregate fetches, including candidate spotlight fallback. The daily track is scheduled 250 ms after app start and `renderTrackReady()` sets `audio.src` then calls `load()`, causing the 5.54 MB MP3 transfer before any user play action. The synchronous Turnstile script is also placed immediately before the deferred application bundle.

Code splitting sends only functionality required for the present route and defers parse/compile/execution work until an interaction or navigation needs it.[12] Deferring a resource must not, however, create a flash of unstyled or inaccessible content; the critical path should be intentionally small and stable.[13]

### Required implementation

1. **Create one startup-data client in `app-data.js`.** Implement a memoized page-load promise with a single `AbortController`, a request generation, and a terminal-error reset. Make pre-auth employer registration, `loadAll()`, and `getPublicPoolCandidatesFromWorker()` consume it. Use a narrower setting endpoint only if the registration gate cannot safely be derived from the aggregate.

2. **Make track media user-initiated.** In `app-data.js`, retain track metadata/card rendering but set `audio.preload = 'none'`; do not assign `src` or call `load()` from `renderTrackReady()`. On first successful Play, assign `src`, call `play()`, surface loading state, and cache any subsequent error. Consider an efficient modern format and bitrate after measuring device compatibility. The card may be loaded only after primary content settles, but metadata must not trigger the media transfer.

3. **Split the application bundle by capability.** Use `scripts/bundle-app.js` and the app entry structure to produce an initial directory-shell chunk and dynamic chunks for manager/admin, forms/sheets, Talent Pool, posting, CV, poster, and infrequently opened tabs. The initial module set should contain shell navigation, cached-directory rendering, startup client, and the visible home-card renderer only. Load feature chunks on explicit navigation or first interaction. Run coverage after every significant split rather than assuming byte size equals execution cost.

4. **Move protected third parties behind intent.** Remove synchronous Turnstile from the universal bottom of `index.html`. Load the Turnstile API only when a protected form/sheet opens and initialize it explicitly, or use its documented `async defer` behavior with an explicit readiness callback. Self-host/pin Supabase or load it after the initial visual shell when guest browsing does not need it immediately. Audit font weights; subset/self-host only the required Inter faces or use system text for first paint.

5. **Make CSS readiness deliberate.** Keep a very small inline splash/above-fold critical style set. Split the remaining styles by route or load the core stylesheet normally when it is needed to render the first route. Avoid deferring a critical stylesheet merely to improve a blocking metric if the result keeps users behind a splash. Remove the unused home rules identified by coverage and isolate admin/form/sheet CSS.

6. **Improve initial loading semantics.** In `index.html`, remove `aria-hidden="true"` from user-visible splash status or provide a separate concise visible `role="status" aria-live="polite"` message. In the directory/list region, use `aria-busy="true"` before first/retry rendering and set it false only after the final atomic render. Announce meaningful state changes and a retryable failure rather than rotating verbose messages. `aria-busy` indicates that a live region or dynamic region should not yet be treated as complete.[14]

### Validation tests

| Test | How to validate | Pass condition |
|---|---|---|
| Cold network waterfall | Production-like build, cache disabled, CPU/network throttled. | One startup request, no daily-track download, no synchronous Turnstile parser block. |
| Feature-chunk coverage | Home, manager link, form, Talent Pool, admin, and poster path coverage runs. | Initial home does not fetch/execute unrelated chunks; each feature loads before first use. |
| CSS resilience | Delay CSS, external fonts, Supabase, and Turnstile independently. | Splash has usable styling; primary loading/failure state remains comprehensible; no persistent FOUC. |
| Screen-reader busy/status | NVDA/VoiceOver plus DOM assertions through initial, slow, retry, and loaded states. | Status is exposed once per meaningful change; busy state accurately encloses updates. |
| Audio behavior | Inspect request log before and after first Play. | No media request before intent; playback failure has a recoverable error state. |

# P1 fixes

## P1-1 — Make the mobile interaction model accessible

The home statistic cards use `role="button"` and `tabindex="0"` without keyboard activation. Generated vacancy `<article>` cards are click-only. All examined sheets lack dialog semantics, focus placement, focus trapping, background inertness, and opener restoration. The closed drawer has `aria-hidden="true"` but keeps off-screen descendants in the tab order. These are functional accessibility defects, not metadata polish: keyboard and screen-reader users can be stranded in hidden controls or unable to activate primary cards.

### Required file-level work

- **`index.html`:** Convert static-card controls to native `<button>`/`<a>` where possible. Add a single visible splash status, identify the drawer trigger with `aria-controls`, and make drawer hidden state use `inert` in addition to `aria-hidden`. Add stable labels/headings to every sheet markup.
- **`app-cards.js`:** Replace clickable vacancy `<article>` elements with native buttons/links, or supply a shared Enter/Space handler, role, tabindex, selected/expanded state, and accessible name. Native controls remain preferred.[15]
- **`app-sheets.js`:** Implement a reusable modal manager. On open set `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`; store opener; focus the close control or first meaningful field; trap Tab/Shift+Tab; close with Escape where allowed; set the app background inert; restore opener focus on close. Native `<dialog>` is acceptable only with an iOS/Safari-tested fallback.[16]
- **`app-ui.js`:** Route every navigation transition through a state renderer that can also be called by browser history. On folder close or switch, increment the request generation and abort any active folder request.
- **`styles.css` and `ios-blue-ui.css`:** Keep a visible focus indicator, add a global `prefers-reduced-motion: reduce` override for splash dots/pulse, transitions, ripples, and programmatic smooth scrolling behavior.

### Validation tests

1. Test every primary control with Tab, Shift+Tab, Enter, and Space. No interactive action may depend on a pointer.
2. For every overlay, assert `role`, `aria-modal`, unique label, initial focus, cycle trapping, Escape behavior, inaccessible background, and focus restoration.
3. With drawer closed, enumerate focusable descendants; expected count is zero. With drawer open, initial focus is inside it and close restores the trigger.
4. Run axe-core only as a supplement; use Playwright keyboard assertions and at least one VoiceOver/NVDA manual smoke test because automated tools do not prove focus order or real announcement quality.
5. Emulate reduced motion and verify splash/keyframe animations stop or become nonessential static feedback.

## P1-2 — Make SPA state navigable, shareable, and race-free

Current view changes toggle CSS classes without `pushState`/`popstate`; copied URLs do not represent the current screen, filter, folder, or detail. Pagination applies expiry filtering after the offset query and treats filtered `page.length` as end-of-data. A full raw page with one expired row can incorrectly end pagination. Error panels written in a lazy-loader `catch` are immediately overwritten by a generic empty state in `finally`.

### Required file-level work

- **`app-ui.js`:** Define a serializable route state that includes screen, folder, filters/query, selected vacancy/agency, and sheet where shareable. Call `history.pushState()` for meaningful transitions and render from `popstate`. Preserve manager/PWA query entry points. Use canonical paths/queries for public listing deep links.
- **`app-data.js`:** Order all offset reads by `created_at DESC, id DESC` as an immediate deterministic improvement. Move to keyset/cursor pagination with a stable snapshot boundary for high-churn folders. Return raw length plus filtered rows, or shift eligibility filtering server-side, so `hasMore` is derived from the raw server page. Carry `AbortSignal` into folder reads and ignore stale generations.
- **`app-ui.js`:** Use explicit lazy-list states: `initial-loading`, `ready`, `initial-error`, `append-error`, and `empty`. Never replace initial or append errors with a normal empty state. Preserve previously loaded cards on append error and offer an inline retry.
- **`Cloudflare-worker/worker.js` and Supabase migrations:** Prefer normalized/indexed eligibility such as `expires_at`/verified state, then apply exactly the same predicate to counts and list endpoints.

### Validation tests

| Scenario | Pass condition |
|---|---|
| Browser Back/Forward, Android hardware Back, iOS swipe Back | Restores the prior screen/filter/detail without losing focus or selecting a different record. |
| Refresh/copy URL from general and dedicated folders | The same state restores from the URL or shows an honest unsupported/offline state. |
| 30 raw rows containing expired rows | Pagination continues while raw pages are full; later eligible rows remain reachable. |
| Concurrent insert and same-timestamp rows | Stable `created_at, id` ordering has no duplicate/skip; cursor test remains correct. |
| First-page request fails | Error/retry panel persists and is not rendered as a normal empty list. |
| Later-page request fails | Existing cards remain; only append area shows a retryable failure. |
| Close/switch folder during delayed request | Delayed response cannot reopen or overwrite the abandoned folder. |

## P1-3 — Bound cache growth and retain fresh public content

After P0 lifecycle work, complete the runtime strategy in `sw.js`. Do not cache arbitrary same-origin GETs, authentication/API endpoints, or all cross-origin responses. Separate image, listing, shell, and approved static routes. Give each an explicit purpose, count/age limit, quota behavior, and offline fallback. A cache entry does not expire merely because its HTTP header does; Cache Storage lifetime is managed by application code.[8]

Use `event.waitUntil()` for every asynchronous cache fill and refresh. Cache write failures should be observable but should not unnecessarily fail a good network response. Include a user-accessible cache-clear recovery action and record `navigator.storage.estimate()` telemetry without collecting personal content.

## P1-4 — Improve first-route render ordering without trading correctness for a score

In `index.html`, the Google Font stylesheet remains blocking, `ios-blue-ui.css` is blocking, `styles.css` is asynchronously activated, and Turnstile is classic synchronous. The recommended P0 startup split should be paired with a short resource-order review:

- Keep only proven first-view CSS and one essential font face on the critical path.
- Defer Turnstile and nonessential fonts until the protected flow starts.
- Preserve a styled shell if a third-party origin is delayed or unavailable.
- Pin/self-host dependency assets that must execute before user interaction.
- Re-run Coverage after route splitting; remove or route-split the 105,943 estimated unused CSS bytes rather than merely hiding their transfer timing.

Script `defer` preserves document order and removes parser blocking, whereas `async` does not preserve execution order; the chosen initialization must explicitly account for that behavior.[17]

# P2 fixes

## P2-1 — Complete asset invalidation and production header policy

`generate-pages.js` currently hashes a useful set of static assets but excludes `ios-blue-ui.css`, `icons.svg`, icon files, and generated listing output. Its rewrite only versions four named files. Expand both version input and HTML rewriting, or preferably change the build to content-addressed filenames and immutable cache headers. A data-only listing rebuild must create a changed content revision that the service worker consumes.

Update `.github/workflows/deploy-cloudflare-pages.yml` to include a post-deploy smoke stage against the deployed Pages URL. Validate that fingerprinted CSS/JS/icons use `Cache-Control: public, max-age=31536000, immutable`, while HTML, manifest when stable, and `sw.js` use revalidation/no-cache semantics. Production header checks should cover CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors` behavior. Caching policy must distinguish immutable versioned assets from documents that must revalidate.[18]

## P2-2 — Add reliability observability and error budgets

Add structured, privacy-minimized telemetry in `app-data.js`, `sw.js`, and `Cloudflare-worker/worker.js` for startup request count, `generated_at` age, cache source, D1 snapshot generation, sync success/failure, navigation timeout fallback, service-worker install/update state, cache quota failure, folder fetch error, and mutation result. Do not log tokens, credentials, CV data, contact details, or raw applicant content.

Expose an internal operational dashboard or protected endpoint with last successful D1 sync, duration, source/target count reconciliation, current active generation, aggregate age, and Worker error rate. Alert on stale data beyond the documented SLO, snapshot validation failure, repeated authorization denial, token-rotation event, large cache error, and performance-budget regression.

## P2-3 — Test the install/offline and release matrix continuously

Add a browser test harness, for example `tests/e2e/pwa-reliability.spec.mjs` with a new `playwright.config.mjs`, and add the required development dependency and CI script in `package.json`. The repository currently has useful Node scraper tests but no Worker/PWA end-to-end harness. Preserve `npm test` for existing tests and add separate commands such as `npm run test:worker`, `npm run test:e2e`, and `npm run test:production-smoke` so network-dependent checks are explicit.

Add source-level contract tests near the existing test convention, for example `scripts/startup-contract.test.mjs`, `scripts/sw-update-contract.test.mjs`, and `scripts/admin-authorization-contract.test.mjs`. Where Worker code must be refactored to test pure functions, put those functions in an importable module instead of testing generated/bundled code by string matching.

# Release validation plan

## Required commands and automated gates

The exact commands may need minor adjustment when the test harness is introduced, but these are the intended release gates.

```bash
# Existing repository baseline
cd /home/ubuntu/sarecruiters
npm run generate
npm test
node --check sw.js
node --check app-data.js
node --check app-manager-employer.js

# New deterministic tests after the planned harness is added
npm run test:worker
npm run test:e2e
npm run test:production-smoke

# Production header verification after deploy
curl -sSI https://sa-recruiters.co.za/
curl -sSI https://sa-recruiters.co.za/sw.js
curl -sSI https://sa-recruiters.co.za/app.bundle.min.js
curl -sSI https://sa-recruiters.co.za/ios-blue-ui.css
curl -sSI https://sa-recruiters.co.za/admin
curl -sS -D - https://sarecruiters-uploader.kamogeloralph.workers.dev/api/startup -o /tmp/startup.json
```

The production smoke suite must not use privileged real data destructively. Provision test records in an isolated Supabase/Worker/D1 environment or use tagged disposable fixtures with audited cleanup.

## Browser/PWA matrix

| Area | Minimum scenarios | Required result |
|---|---|---|
| Cold home startup | Cache disabled; slow network/CPU; third parties delayed separately. | One startup aggregate, no eager MP3, meaningful loading state, usable retry. |
| Repeat home startup | IndexedDB populated; network slow/offline. | Cached directory paints promptly and visibly states its age/source. |
| PWA lifecycle | Fresh install, update available, update with required asset missing, stale worker, offline launch. | Safe waiting update, old cache survives failed candidate, deterministic fallback. |
| Navigation | SPA folder/filter/detail, Back/Forward, refresh, copied URL, deep public listing. | URL and rendered state remain consistent; focus is maintained. |
| Offline | First visit offline, repeat visit offline, public listing visited/unvisited offline, reconnect. | Honest “not downloaded” versus cached-age states; no misleading blank route. |
| Accessibility | Keyboard-only, screen reader smoke, modal, drawer, reduced motion, zoom. | All primary flows operable without pointer and with modal focus discipline. |
| Authorization | Anon, ordinary user, manager token, administrator, expired/revoked token. | Server denies every unapproved operation regardless of UI state. |
| Data correctness | Failed snapshot sync, >1,000 source rows, stale response, expired row amid a page, concurrent pagination. | No partial/incorrect aggregate and no false end-of-list/empty state. |

## Performance test protocol

1. Build the production artifact with `npm run generate` and deploy to a staging URL configured like production. Do not use an uncompressed Python static server to make final CDN claims.
2. Run at least five cold Lighthouse/DevTools traces using a representative mobile viewport, 4× CPU slowdown, and documented network profile. Record median and worst run for FCP, LCP, TBT, CLS, transfer, request count, and main-thread long tasks.
3. Capture Resource Timing/Network data for `/api/startup`, audio, font, Turnstile, Supabase, CSS, and chunks. Assert the one-startup/no-audio conditions programmatically.
4. Repeat after a successful visit with IndexedDB and service-worker caches populated, then offline, then a deliberately stalled navigation.
5. Publish the trace IDs, build revision, cache state, device profile, and results alongside each release. Compare against the baseline table; do not treat a single Lighthouse score as a release decision.

# Sequenced implementation plan

## Phase 0 — Containment and factual verification

Before feature work, confirm whether `20260918_lock_down_manager_tokens.sql` has been applied and inspect actual Supabase RLS/grants. If applied, prioritize the authorization migration and token rotation as an emergency change. Remove unauthenticated admin-prefix upload capability in the Worker. Record current D1 schema and production cache/header configuration. Do not run the existing destructive vacancy or track cleanup as part of verification.

## Phase 1 — Correctness and safe recovery boundaries

Ship the append-only Supabase authorization migration in an isolated environment, then the D1 generation migration and atomic snapshot code. Add worker integration tests that inject source and chunk failures. Correct the startup count and outer cache policy. Add the real navigation timeout and atomic precache update protocol. Release these in separate deploys with a verified rollback procedure: the prior Worker/service-worker cache remains usable and the prior D1 generation remains active until the new one validates.

## Phase 2 — Startup and user-path improvements

Introduce the shared startup promise, actual data-age label, audio-on-play behavior, and route-level chunks. Delay Turnstile by intent. Rework dialogs, cards, drawer state, and browser history in cohesive UI increments. Each increment must pass mobile keyboard and Back/Forward tests before moving on.

## Phase 3 — Cache bounds, deployment hygiene, and observability

Add route-specific cache expiry/capacity behavior, exhaustive fingerprinting, production headers, telemetry, alerting, and the release smoke workflow. Finalize the authoritative vacancy eligibility/removal contract and remove any superseded cron or client cleanup code only after the replacement has tests and monitoring.

# Implementation caveats

- **Do not silently make all data “live.”** A direct-Supabase fallback remains appropriate for resilience, but it must expose source and age rather than label cached data as updated now.
- **Do not solve startup by hiding content longer.** The splash is not a substitute for removing unnecessary network, parsing, and media work.
- **Do not make all caches network-first without purpose.** Shell, generated documents, images, APIs, and immutable assets need different freshness and offline rules.
- **Do not rely on client gating for admin security.** Even a perfect admin UI is not an authorization boundary.
- **Do not alter historical applied migrations in place.** Append a corrective migration, record how it was applied, and prove its effective privileges in the deployed database.
- **Do not queue sensitive mutations indiscriminately offline.** Only queue business actions with an idempotency model, explicit user consent, encrypted/local sensitivity assessment, conflict rules, and visible delivery state.

# References

[1]: https://web.dev/explore/fast "web.dev: Fast"
[2]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html "OWASP Authorization Cheat Sheet"
[3]: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html "OWASP Cryptographic Storage Cheat Sheet"
[4]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP "MDN: Content Security Policy"
[5]: https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html "OWASP Transaction Authorization Cheat Sheet"
[6]: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch "Cloudflare D1: batch"
[7]: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers "MDN: Using Service Workers"
[8]: https://developer.mozilla.org/en-US/docs/Web/API/Cache "MDN: Cache"
[9]: https://developer.chrome.com/docs/workbox/handling-service-worker-updates "Chrome for Developers: Handling service worker updates"
[10]: https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager "MDN: NavigationPreloadManager"
[11]: https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil "MDN: ExtendableEvent waitUntil"
[12]: https://web.dev/articles/optimizing-content-efficiency-javascript-startup-optimization "web.dev: JavaScript startup optimization"
[13]: https://web.dev/learn/performance/optimize-resource-loading "web.dev: Optimize resource loading"
[14]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy "MDN: aria-busy"
[15]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Keyboard "MDN: Keyboard accessibility"
[16]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/dialog_role "MDN: ARIA dialog role"
[17]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script "MDN: script element"
[18]: https://web.dev/articles/http-cache "web.dev: HTTP cache"
[19]: https://developer.chrome.com/docs/workbox/modules/workbox-expiration "Chrome for Developers: workbox-expiration"
[20]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation "MDN: Offline and background operation"
[21]: https://sa-recruiters.co.za/sw.js "SA Recruiters production service worker"
[22]: https://sa-recruiters.co.za/ "SA Recruiters production site"


## Coordinated hardening pass — 2026-09-25

The first remediation release implemented the highest-impact correctness and reliability fixes identified by the audit. The Worker now includes general-pool rows in its platform vacancy total and prevents the outer CDN from bypassing its freshness checks for 24 hours. Startup aggregate requests are coalesced per page load. Lazy vacancy pagination now uses a stable `created_at, id` order, preserves raw page length for continuation, filters expired rows after pagination, and retains explicit retry/error states.

Service-worker installation is now atomic because required precache failures reject installation; automatic `skipWaiting()` and `clients.claim()` were removed so an open page is not silently mixed with a new generation. Navigation and public listing requests use a bounded four-second network attempt before cached fallback, and runtime/image caches are bounded. Daily-track media uses `preload="none"` and only receives a source after Play intent.

The admin console no longer performs destructive vacancy or track cleanup during ordinary startup, manager tokens use cryptographically secure browser randomness when available, manager-token saves use the server RPCs, the new migration requires `admin_users` membership for those RPCs, admin session sign-out events clear the console, and job-enquiry actions no longer report success after failed or zero-row mutations. Core vacancy cards now have keyboard semantics and activation support.

The migration must be applied to the connected Supabase project before the server-side token authorization protection is active. The deployment verification must also confirm the Worker and Pages workflows succeeded and that production responses expose the corrected startup cache headers.

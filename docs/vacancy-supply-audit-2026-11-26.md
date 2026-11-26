# Vacancy supply audit — 2026-11-26

**Question:** the app has many scrapers and ATS feeds but only ~2,000 vacancies. Why, and what fixes it?

**Method:** read the whole pipeline end to end (scrapers → Supabase → D1 → R2 snapshot → Worker API → app folders), then executed the real Worker request handler and the real ATS SQL against fake data to prove each finding rather than infer it. No live access was available (see "What I could not verify").

## Findings

| # | Finding | Evidence | Effect |
|---|---|---|---|
| 1 | **Adzuna reads 150 jobs per run.** One unfiltered query, 3 pages × 50, no category, no date sort. Anything not re-fetched in 72h is deleted by `reconcile-vacancy-freshness.mjs`, so the app holds only what the last few runs returned. | `sync-adzuna.mjs`, `refresh-static-data.yml` (`ADZUNA_PAGES: "3"`); old snapshot held 237 Adzuna rows | Largest single shortfall. Adzuna ZA lists thousands of jobs. |
| 2 | **Himalayas reads 100 per run** (5 pages × 20). | `sync-himalayas.mjs`; old snapshot held 173 | ~100–170 rows. |
| 3 | **Every scraper limit was clamped into 250–500** via `Math.min(Math.max(x,250),500)`. Env vars could not raise it, and could not lower it below 250. | Adzuna, Himalayas, Jooble, Oracle, Takealot, Bizcommunity, retail, caps | Hard ceiling regardless of settings. |
| 4 | **Jooble yields zero.** HTTP 200, 0 parsed. Keys are per country domain; the sync hard-coded `jooble.org`. Its SA place whitelist (~90 towns) would also reject most real towns. | `docs/scraper-investigation-2026-11-23.md`, `sync-jooble.mjs` | A whole source contributing nothing. |
| 5 | **ATS feed rows were stored and counted but never listed.** The Worker's General scope excluded rows by agency id and by the `ats_` id prefix, and no UI folder exists for TopJob Seeker, GovPosts, MyJobMag or We Work Remotely. Reproduced by driving the real `/api/vacancies` handler: with `scope=general` all four feeds were filtered out. | `worker.js` `vacanciesResponse`, `app-data.js` `isGeneralDirectoryVacancy`, folder list in `app-ui.js` | The "too many feeds, so few vacancies" symptom. |
| 6 | **ATS rows crowded real agency vacancies out of the 1,000-row startup window** (ordered by `created_at`, ATS rows are always newest). | `loadStartupDataFromD1` | Agency vacancies silently missing from startup data. |
| 7 | **The ATS sync wrote one D1 query per job, sequentially, in the same invocation as the snapshot publish.** The file itself records production "Too many subrequests" failures, and you receive "snapshot Nh old" watchdog emails. | `syncOneAtsFeed`, `scheduled()` | Likely cause of partial ATS imports and stale publishes. Cannot be confirmed without Cloudflare logs. |
| 8 | **ATS rows were never expired.** Stale cleanup ran only for feeds of ≤100 jobs, and it soft-closed rather than removed. Large feeds accumulated dead jobs. A blocked/empty response closed *every* row. | `syncOneAtsFeed` | Inflated and dishonest counts; risk of wiping a feed. |
| 9 | **TopJob Seeker is a WP Job Manager feed**, which returns 10 items unless `posts_per_page` is set. | Feed URL in migration 0012/0014 | Possibly 10 jobs from that feed. *Unverified against the live site.* |
| 10 | **"Remote jobs" folder count read 0 for ATS remote feeds** (it counted `source_type IN (...)` but those rows are `remote`/`ats`). | `DEDICATED_FOLDERS` | Misleading folder card. |
| 11 | **Snapshot filter capped companies at 50; the delete job at 250–500.** Different rules for the same data. "Private Advertiser" was treated as one employer. | `static-vacancy-filter.mjs`, `enforce-vacancy-caps.mjs` | SEO/sitemap inventory far smaller than the app; unrelated jobs trimmed together. |
| 12 | **Live jobs were deleted after 30–60 days from first-seen date and re-created next scrape** (fresh `created_at`, so they re-surfaced as "new"). | `isStaleVacancy` falls back to `created_at` | Churn, false "new" alerts. |
| 13 | **CI could not import the Worker in tests.** `ats-feed.test.mjs` imports `worker.js` → `@sentry/cloudflare`, but the Test workflow only installs root dependencies. | `test.yml`, root `package-lock.json` | That test fails in CI. |

Checked and **not** a cause: the link checker (it only reports, never deletes); the Worker's public read path (paged, no client or API total cap); retail scraper (Pick n Pay really has ~58 postings, already backs off on 429); Careerjet (live search only, never stored).

## What changed

**Scrapers**
- `sync-adzuna.mjs`: category-by-category, newest first, last 30 days, round-robin call budget (default 70/run ≈ 140/day, leaving ~110/day for `/find-jobs` which shares the quota). Categories discovered from Adzuna each run, with a built-in fallback. Stops on 429, fails fast on rejected credentials, tolerates a bad category.
- `sync-himalayas.mjs`: 25 pages/run (was 5), stops when results run out or on 429.
- `sync-jooble.mjs`: probes `jooble.org` then `za.jooble.org` when `JOOBLE_API_ORIGIN` is unset; trusts the `za.` domain's targeting; 30 queries (was 6); stops on 429; logs counts of raw/rejected/stale and the top rejected place names (never the key or payloads).
- `scrape-limits.mjs`: explicit `envInt`; all 250–500 clamps removed. Single-employer sources keep their 500 default (real openings are below it) but are now adjustable both ways.

**Retention**
- `vacancy-policy.mjs`: one shared default cap (500) for the delete job and the snapshot filter; placeholder company names are not capped as one employer.
- `vacancy-freshness.mjs`: a row the source re-confirmed in the last 72h is not aged out by its first-seen date. A real posted date or past closing date still wins.

**Worker / ATS**
- Batched, changed-rows-only writes. Rows that leave a pull feed are removed. Empty/blocked responses never prune; a >80% shrink is reported instead of pruned.
- WP Job Manager feeds get `posts_per_page` (default 300, `ATS_WPJM_PER_PAGE`).
- ATS board feeds now belong to **General**; remote-by-default feeds go to **Remote jobs**. Folder counts and the startup window corrected.
- New `GET /api/ats/status` (per-feed rows held, last status, last sync). `POST /api/ats/sync?feed=<id>` syncs one feed without rebuilding the snapshot. The service-role key is accepted as the bearer, as for `/api/sync-d1/internal`.
- The 6-hourly run now syncs only the single stalest feed; the refresh workflow syncs each feed in its own request.

**Observability**
- `source-yield-report.mjs` (runs after every refresh): per-source count table in the run summary, ATS feed health, and a warning annotation when a source falls below 50% of the previous run.

**CI**
- Test workflow installs Worker dependencies.

## Rollout (in this order)

1. Push. CI runs the tests, deploys the Worker (no D1 migration needed) and rebuilds the frontend bundle (`generate-pages.js` → `bundle-app`; the committed `app.bundle.min.js` is stale until then).
2. Optional repository **variables** (Settings → Secrets and variables → Actions → Variables): `JOOBLE_API_ORIGIN` (`https://za.jooble.org` if you hold a South African key), `ADZUNA_MAX_CALLS`, `HIMALAYAS_PAGES`, `JOOBLE_MAX_REQUESTS`. Leave unset to use the defaults.
3. Run **Refresh static job data** manually once. Read the run summary: the yield table, the ATS feed output, and each scraper's `RESULT` line.
4. Call `GET <worker>/api/ats/status` with `Authorization: Bearer <service key>` and confirm each feed shows rows held and an `ok:` status.
5. Watch for a 429 from Adzuna in the first day. If it appears, lower `ADZUNA_MAX_CALLS`.

## What I could not verify

- **No live access.** I could not call Adzuna, Jooble, Himalayas, any ATS feed, Cloudflare or Supabase. Tests use fakes, except the ATS SQL, which ran on real SQLite.
- **Volumes are expectations, not promises.** The Adzuna call budget allows up to ~3,500 rows/run; the real figure depends on how many ZA listings exist in the last 30 days.
- **Adzuna category tags and the `posts_per_page` behaviour** follow Adzuna's and WP Job Manager's documented conventions but were not checked live. Both fail safe: discovery falls back to a built-in list, and an ignored `posts_per_page` changes nothing.
- **Whether finding 7 is what is making your snapshot go stale** needs the Worker's logs. The change removes the pattern either way.
- **Cloudflare plan limits** are unknown to me. Treated conservatively.
- **Jooble:** I cannot tell which domain your key was issued for. The probe handles both; if it reports zero, create a `za.jooble.org` key.
- **Provider terms:** check Adzuna's and Jooble's API terms on storing results and on attribution before raising volumes.
- Fifteen parser tests (retail, Bizcommunity, Jonsson, Takealot) need the real `cheerio`/`fast-xml-parser`; they could not run offline and were unaffected apart from a one-line limit swap.

## Not changed (noted)

- Headline and folder counts include rows past their closing date until the daily purge removes them.
- The committed `data/startup.json` is an old snapshot (49 rows) and is only a fallback.

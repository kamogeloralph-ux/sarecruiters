# SA Recruiters: zero-cost static architecture

## Runtime

- **GitHub Pages** serves the existing static app and `data/startup.json`.
- The browser loads the public directory from `data/startup.json`, filters and sorts in memory, and uses the existing IndexedDB cache for offline recovery.
- Saved jobs remain device-local in `localStorage` under `savedVacancies`. They work for guests and do not require a database. Signed-in users may still sync them to Supabase as an optional enhancement.
- Supabase and the existing Worker remain available for authentication, admin forms, employer/agency submissions, analytics, and non-directory features. A database or Worker outage no longer prevents public listings from loading.

## Data refresh

`.github/workflows/refresh-static-data.yml` runs every Monday and Friday at 03:30 UTC. It runs the existing Adzuna, Himalayas, Oracle, Government, retail, Simplify, Graduates24, and Careers Page scrapers, then `npm run export:static-data` reads the public rows and writes one compact, token-free JSON snapshot. GitHub Actions commits the changed snapshot back to `main`, which triggers the Pages deployment workflow.

Run it immediately with **Actions → Refresh static job data → Run workflow**. The first run requires these repository Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`

The source scrapers use Supabase as a short-lived staging/upsert layer for compatibility with the existing parser and admin schema; the public runtime source of truth is the committed JSON snapshot. No paid server, database hosting, or scheduler is required.

## GitHub setup

1. In **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
2. Add the four secrets above under **Settings → Secrets and variables → Actions**.
3. Run the refresh workflow once manually, then verify `data/startup.json` changes.
4. The Pages deployment runs on every data commit and code push.

## Counts match what the app keeps live

`scripts/export-static-data.mjs` runs every row through `scripts/static-vacancy-filter.mjs` before writing the snapshot: closed listings (past `closing_date`) are dropped and each real agency, employer and normalized unlinked company keeps only its newest 50, exactly like the daily `enforce-vacancy-caps` job. `counts` (which drives the home "Available Vacancies" tile) is computed from those filtered rows, so it can't include rows the caps job would delete.

## Snapshot contract

`data/startup.json` contains `schema`, `updated_at`, public `agencies`, `branches`, `employers`, `vacancies`, `featured_vacancies`, `counts`, and safe public settings. Manager tokens and other private fields are explicitly omitted by the exporter.

# SA Recruiters

A free, community-maintained directory of South African recruitment agencies. Built as a PWA (installable, works offline) and deployed via GitHub Pages.

## Structure
- `index.html` — the app itself
- `manifest.json` — PWA manifest (icons, theme colors, install behavior)
- `sw.js` — service worker for offline caching
- `privacy.html` / `terms.html` — standalone legal pages (linked from the Play Store listing and the vacancy manager flows)
- `generate-pages.js` — build script that queries Supabase and writes a static HTML page per agency and per vacancy, plus `sitemap.xml`, so Google and link shares see real content
- `icons/` — app icons (favicons, PWA icons, maskable icons)

## Deployment
This repo deploys to GitHub Pages via `.github/workflows/deploy.yml`. On every push to `main`, and on a 3-hourly schedule (so agencies/vacancies added directly through the admin panel or manager links get a public page without needing a code push), the workflow:
1. Installs dependencies (`npm install`)
2. Runs `generate-pages.js`, which queries live Supabase data
3. Deploys the repo root (including the freshly generated `/agency/<slug>/`, `/vacancy/<slug>/` pages and `sitemap.xml`) to GitHub Pages

No separate build service or webhook is needed — the 3-hourly schedule is what keeps static pages in sync with Supabase between deploys.

## Backend
Data (agencies, admin auth) is powered by Supabase — see the Supabase project dashboard for schema and RLS policies.

## Talent Pool
Job seekers can list themselves (R20/year, paid by manual EFT and approved by an admin) so employers can browse and contact them directly — see `CREATE_POOL_CANDIDATES_TABLE.sql`. Registrations land as `pending` in Admin → Talent Pool; approving sets `status = active` and `paid_until` to one year out, which is what makes a candidate visible in the public app. Before launch, replace the placeholder banking details in the registration sheet in `index.html` (search for "Banking details") with real ones.

## Advanced Vacancy Filters
Vacancies now carry `remote` (On-site/Remote/Hybrid) and `experience_level` fields — run `ADD_VACANCY_FILTER_FIELDS.sql` to add the columns. The All Vacancies screen filters on these plus an Industry dropdown (built from agencies' existing Trades field, no schema change needed). Salary range filtering was intentionally left out since salary is still free text.

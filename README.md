# SA Recruiters

A free, community-maintained directory of South African recruitment agencies. Built as a PWA (installable, works offline) and deployed via Netlify.

## Structure
- `index.html` — the app itself
- `manifest.json` — PWA manifest (icons, theme colors, install behavior)
- `sw.js` — service worker for offline caching
- `privacy.html` — privacy policy page (linked from Play Store listing)
- `icon-192.png` / `icon-512.png` — app icons

## Deployment
This repo is connected to Netlify for continuous deployment — every push to `main` triggers a new build automatically. No build command is needed; `netlify.toml` publishes the repo root directly.

## Backend
Data (agencies, admin auth) is powered by Supabase — see the Supabase project dashboard for schema and RLS policies.

## Talent Pool
Job seekers can list themselves (R20/year, paid by manual EFT and approved by an admin) so employers can browse and contact them directly — see `CREATE_POOL_CANDIDATES_TABLE.sql`. Registrations land as `pending` in Admin → Talent Pool; approving sets `status = active` and `paid_until` to one year out, which is what makes a candidate visible in the public app. Before launch, replace the placeholder banking details in the registration sheet in `index.html` (search for "Banking details") with real ones.

## Advanced Vacancy Filters
Vacancies now carry `remote` (On-site/Remote/Hybrid) and `experience_level` fields — run `ADD_VACANCY_FILTER_FIELDS.sql` to add the columns. The All Vacancies screen filters on these plus an Industry dropdown (built from agencies' existing Trades field, no schema change needed). Salary range filtering was intentionally left out since salary is still free text.

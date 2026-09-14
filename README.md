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

## Pnet vacancy scraper

`.github/workflows/scrape-pnet.yml` runs every six hours. Each run fetches the fixed Pnet general-jobs page (`https://www.pnet.co.za/jobs`) into `agency_id = 'general'`, then scrapes one configured agency. It selects agencies with a non-null `pnet_url` in `last_scraped_at` ascending order, with never-scraped agencies first. The scraper only fetches those fixed URLs; it does not attempt web search or URL discovery inside GitHub Actions.

The scraper parses Pnet job cards, uses the stable Pnet posting ID as the vacancy ID (`pnet-<id>`), upserts into `vacancies`, and updates `agencies.last_scraped_at` only after that agency's page has been fetched and parsed. A failed agency remains eligible for the next run. Run `npm test` or `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --test scripts/scrape-pnet.test.mjs` to validate the parser.

Configure these repository Actions secrets before enabling the workflow:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service-role key; keep it server-side and never expose it to the browser |

The migration at `supabase/migrations/20260914072349_add_pnet_scraper_tracking_columns.sql` adds the tracking columns, the rotation index, and the three fixed agency URLs for Michael Page, Network Recruitment, and Communicate Recruitment. General Pnet postings use the existing stable `pnet-<id>` vacancy IDs and are reconciled by canonical link, so repeated runs update records rather than duplicating them.

### Mapping additional agencies

`scripts/map-pnet-agencies.mjs` performs a one-time, rate-limited discovery pass for agencies that do not yet have a `pnet_url`. For each agency it requests Pnet's supported `jobs?q=<agency name>` page, extracts canonical `/cmp/en/<employer>/jobs` links, scores the name match, and writes a reviewable JSON report. It does not write to Supabase by default:

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  npm run map:pnet -- --output reports/pnet-agency-mapping.json
```

Review the `high_confidence`, `review`, `no_match`, and `error` records. Only after reviewing the report should high-confidence matches be applied:

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  npm run map:pnet -- --output reports/pnet-agency-mapping.json --apply
```

`--apply` updates only high-confidence mappings. It never auto-applies ambiguous matches, and it leaves already mapped agencies untouched unless `--all` is supplied. The mapper intentionally runs as a controlled one-time tool rather than a scheduled job because an incorrect employer match would attribute vacancies to the wrong agency.

## Talent Pool
Job seekers can list themselves (R20/year, paid by manual EFT and approved by an admin) so employers can browse and contact them directly — see `CREATE_POOL_CANDIDATES_TABLE.sql`. Registrations land as `pending` in Admin → Talent Pool; approving sets `status = active` and `paid_until` to one year out, which is what makes a candidate visible in the public app. Before launch, replace the placeholder banking details in the registration sheet in `index.html` (search for "Banking details") with real ones.

## Advanced Vacancy Filters
Vacancies now carry `remote` (On-site/Remote/Hybrid) and `experience_level` fields — run `ADD_VACANCY_FILTER_FIELDS.sql` to add the columns. The All Vacancies screen filters on these plus an Industry dropdown (built from agencies' existing Trades field, no schema change needed). Salary range filtering was intentionally left out since salary is still free text.

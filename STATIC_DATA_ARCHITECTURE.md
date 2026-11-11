# SA Recruiters public data and static-page architecture

## Browser runtime

Cloudflare Pages serves the main app from the root `index.html`. The app prefers live, versioned public data from the Cloudflare Worker and falls back to checked-in public startup data when the Worker is temporarily unavailable. Public browser code does not read Supabase tables directly.

The advertising form is a separate hand-maintained route at `advertise/index.html` (`/advertise/`). It is not part of the app homepage or a generator output.

## SEO pages and deployment

`generate-pages.js` reads the committed public data files under `data/` and generates crawlable agency, vacancy, company, poster, category and location pages, along with `sitemap.xml`. The generator does not query Supabase.

The Cloudflare Pages workflow first attempts to refresh the SEO inventory from the live public Worker and validates it when fresh data is available. If that refresh fails, the workflow uses the checked-in snapshot instead. It then runs the generator and deploys the repository root to the Cloudflare Pages project `sarecruiters`.

The frontend bundler creates `app.bundle.min.js` and updates the bundle reference in the root app page. It does not replace the root page with the advertising form. Generated route folders may be recreated by the build; edit their source templates or input data rather than treating generated HTML as hand-maintained source.

## Source refresh

`.github/workflows/refresh-static-data.yml` runs at 03:30 and 15:30 UTC. It runs the configured vacancy scrapers, reports persistent source failures, and saves scraper failure history. It does not run the former full static-data export or commit a full snapshot as part of that workflow.

The checked-in public data remains a build input and outage fallback. Keep it limited to public listing data; candidate records and other private account information must not be included.

## Operational boundaries

- Cloudflare Pages deployment is defined by `.github/workflows/deploy-pages.yml`.
- Worker deployment and D1 migrations are handled separately by `.github/workflows/deploy-worker.yml`.
- Scraper credentials and the Cloudflare deployment credentials are configured as the repository secrets and variables referenced by their workflows; do not place secret values in checked-in data or configuration.

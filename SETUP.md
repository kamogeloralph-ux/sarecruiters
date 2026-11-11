# SA Recruiters repository setup and deployment

## Routes and page ownership

- The Cloudflare Pages site serves the main app from the root `index.html` at `/`.
- The advertising form lives in `advertise/index.html` and serves at `/advertise/`. Keep it in that folder; it is not a replacement for the app homepage.
- `generate-pages.js` builds the cache-busted app bundle and crawlable SEO pages from the checked-in public data. It updates the root app's bundle reference and generates route folders; edit source templates rather than hand-editing generated pages.

## Cloudflare Pages deployment

`.github/workflows/deploy-pages.yml` runs on matching pushes to `main` and can also be started manually from GitHub Actions. It installs dependencies, attempts to refresh the SEO inventory from the public Worker, validates a fresh inventory when available, runs `node generate-pages.js`, checks Cloudflare credentials, and deploys the repository root to the Pages project `sarecruiters`.

The workflow requires the repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. GitHub Pages settings are not used for this deployment.

## Data refresh and build inputs

The browser uses the public Worker for live/versioned public data and keeps the checked-in public snapshot as a fallback. The Pages generator uses the committed public files under `data/` and does not query Supabase directly.

`.github/workflows/refresh-static-data.yml` runs the source scrapers twice daily at 03:30 and 15:30 UTC, with a manual dispatch option. It records scraper failures and does not export and commit a full static snapshot. Configure the source-specific repository secrets and variables referenced by that workflow when enabling those sources.

The Pages deploy workflow separately attempts to refresh the SEO snapshot from the live public Worker. If the Worker is unavailable, deployment continues with the checked-in snapshot.

## Search indexing checks

After a successful Pages deploy, submit `https://sa-recruiters.co.za/sitemap.xml` in Google Search Console. Verify that `/`, `/advertise/`, and representative generated agency or vacancy routes return the intended page. Check the corresponding Actions run if a build or deployment fails.

# Wiring this into your SA Recruiters repo

## 1. Copy files into your repo root (same folder as index.html)
- generate-pages.js
- package.json  (or merge the "generate" script + dependency into an existing package.json if you add one)
- .github/workflows/deploy.yml

## 2. Enable GitHub Pages
In the repo's Settings → Pages, set the source to "GitHub Actions" (not "Deploy from a branch"). The included `deploy.yml` workflow handles the build and deploy itself — no separate static site host or build service is needed.

## 3. Commit and push
On every push to `main` (and on a 3-hourly schedule, so listings added directly in Supabase also get a page — see below), GitHub Actions will:
  1. npm install (pulls in @supabase/supabase-js)
  2. Run generate-pages.js, which queries your live Supabase data
  3. Deploy the repo root — including the freshly generated
     /agency/<slug>/index.html and /vacancy/<slug>/index.html
     pages, plus /sitemap.xml and /static-pages.css — to GitHub Pages

Your existing app at "/" is completely untouched — these are new,
additional pages that exist purely so Google (and link shares) see
real content.

## 4. Link to the new pages from your app (recommended, not required)
In index.html, where agency cards and vacancy cards render, add a
real <a href="/agency/{slug}/"> / <a href="/vacancy/{slug}/"> link
alongside the existing click-to-open-modal behavior, so Google can
actually crawl from your homepage to these pages. Without this,
the pages exist and are in the sitemap, but are "orphaned" (only
reachable via sitemap, not via on-site links), which Google trusts
less than a normally-linked page.

The slug logic in generate-pages.js is deterministic (based on
name/title), so you can compute the same slug in your front-end JS
if you want to build these links dynamically rather than hardcoding.

## 5. Keeping pages in sync when listings change
Since a static page is only written when the workflow runs, a new
agency/vacancy added via the manager link or admin panel won't get
a static page until the next run. This is already handled by the
`schedule: cron: "0 */3 * * *"` entry in `deploy.yml`, which reruns
the workflow every 3 hours regardless of whether anything was pushed
to `main`. To change how often that happens, edit the cron expression
in `.github/workflows/deploy.yml`. You can also trigger a run manually
at any time from the repo's Actions tab via "Run workflow"
(enabled by the `workflow_dispatch` trigger already in the workflow).

## 6. Submit to Google
- Google Search Console > Sitemaps > add https://sa-recruiters.co.za/sitemap.xml
- Request indexing for a couple of individual agency/vacancy URLs to
  speed up initial discovery.

## 7. Verify it worked
After deploy, visit https://sa-recruiters.co.za/agency/<some-slug>/
directly in a browser with JavaScript disabled (or view-source it).
You should see real agency content in the raw HTML, not an empty
shell — that's the proof Google will see it too. You can also check
the Actions tab in GitHub to confirm the workflow run succeeded.

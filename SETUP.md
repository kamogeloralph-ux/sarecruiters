# Wiring this into your SA Recruiters repo

## 1. Copy files into your repo root (same folder as index.html)
- generate-pages.js
- package.json  (or merge the "generate" script + dependency into an existing package.json if you add one)

## 2. Update netlify.toml
Change:
    [build]
      publish = "."
      command = ""

To:
    [build]
      publish = "."
      command = "npm install && node generate-pages.js"

## 3. Commit and push
Netlify will now, on every deploy:
  1. npm install (pulls in @supabase/supabase-js)
  2. Run generate-pages.js, which queries your live Supabase data
  3. Write /agency/<slug>/index.html and /vacancy/<slug>/index.html
     pages, plus /sitemap.xml and /static-pages.css into the publish
     folder, alongside your existing index.html and app files.

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

## 5. Redeploy when listings change
Since this only runs at build time, new agencies/vacancies added via
Smart Manager won't get a static page until the next deploy. Two ways
to automate that:
  a) Netlify Build Hook + Supabase Database Webhook: create a Build
     Hook URL in Netlify (Site settings > Build & deploy > Build
     hooks), then in Supabase (Database > Webhooks) trigger a POST
     to that URL on INSERT/UPDATE for the agencies and vacancies
     tables.
  b) Simplest: Netlify scheduled functions or a cron-triggered build
     (e.g. hourly) so new listings appear within an hour without any
     webhook wiring.

## 6. Submit to Google
- Google Search Console > Sitemaps > add https://sa-recruiters.co.za/sitemap.xml
- Request indexing for a couple of individual agency/vacancy URLs to
  speed up initial discovery.

## 7. Verify it worked
After deploy, visit https://sa-recruiters.co.za/agency/<some-slug>/
directly in a browser with JavaScript disabled (or view-source it).
You should see real agency content in the raw HTML, not an empty
shell — that's the proof Google will see it too.

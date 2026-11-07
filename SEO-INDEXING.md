# SA Recruiters — indexing & SEO

Everything below is produced by `generate-pages.js` on every deploy (no manual steps).

## What gets its own crawlable URL
| Corner of the app | Static URL | In sitemap | Photos in image sitemap |
|---|---|---|---|
| Every vacancy | `/vacancy/{slug}/` | yes | company logo |
| Every agency | `/agency/{slug}/` | yes | agency logo |
| Hiring companies (registered employers + companies with open vacancies) | `/company/{slug}/` | yes | company logo |
| Vacancy posters | `/poster/{slug}/` | yes | poster image |
| Directories / archives | `/vacancies/` (paged), `/agencies/`, `/companies/` (paged), `/posters/` | yes | all logos / posters on the page |
| CV submission | `/submit-cv/` + a "Submit your CV" card on every agency page (opens the CV Box) | yes | agency logos |
| Province / category hubs, careers, apply, about, FAQ, terms … | existing | yes | – |

Every page is linked from at least one other crawlable page (vacancy archive → vacancies, directories → agencies/companies), so Google can reach 100% of them even without the sitemap.

## CV submission always goes through the CV Box
Every "Submit your CV" button — on agency pages, vacancy pages (when the vacancy has no apply link) and `/submit-cv/` — links to `/?section=candidates&cvbox=submit`. The app opens the CV Box and its upload form (`openPoolRegisterSheet()`); the inline handler at the bottom of `index.html` does this and then removes `cvbox=submit` from the address bar. Agencies' own email / WhatsApp / website routes are no longer offered for CV submission.

## Not indexed on purpose
- **CV Box candidates (names, photos, CVs)** — personal information (POPIA). Never put on public pages.
- `admin.html`, manager-link tokens (`?manage=`, `?manage_employer=`), unsubscribe and payment-return URLs — blocked in `robots.txt`.

## After you deploy (once)
1. Google Search Console → add **Domain** property `sa-recruiters.co.za` (DNS TXT record in Cloudflare).
2. Sitemaps → submit `https://sa-recruiters.co.za/sitemap.xml`.
3. URL inspection → "Request indexing" for `/`, `/vacancies/`, `/agencies/`, `/companies/`, `/submit-cv/`.
4. Check Pages → Indexing and Search results → Search type: Image after 1–2 weeks.
Google decides what to index and when; the site now makes every page discoverable and crawlable, but "100% indexed" is not something anyone can force.

## Photo hosting tip
Photos are served from `pub-…r2.dev`. Cloudflare treats r2.dev as a development URL (rate-limited). For image search, attach a custom domain to the bucket (e.g. `media.sa-recruiters.co.za`, R2 → bucket → Settings → Custom Domains) and verify it in Search Console too.

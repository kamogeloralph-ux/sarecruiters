# Moving sa-recruiters.co.za from Netlify to GitHub Pages

## 1. Add these files to your repo (root level, same folder as index.html)
- .github/workflows/deploy.yml
- CNAME              (already contains: sa-recruiters.co.za)
- generate-pages.js  (from earlier)
- package.json       (from earlier)

## 2. Enable GitHub Pages
In your GitHub repo: Settings → Pages → Build and deployment →
Source: "GitHub Actions" (not "Deploy from a branch").
This lets the workflow control the deploy instead of Pages' own
default builder.

## 3. Push to main
On push, the workflow will:
  1. Check out your repo
  2. npm install
  3. node generate-pages.js  (queries Supabase, writes /agency,
     /vacancy pages + sitemap.xml, same as before)
  4. Upload the whole repo root as the Pages artifact
  5. Deploy it

Check the "Actions" tab in GitHub to watch it run and catch errors.

## 4. Point your domain at GitHub Pages
At your DNS provider, replace whatever records point at Netlify with:

  A     @     185.199.108.153
  A     @     185.199.109.153
  A     @     185.199.110.153
  A     @     185.199.111.153

(If you also serve a www. subdomain, add:
  CNAME  www   <your-github-username>.github.io )

DNS changes can take anywhere from a few minutes to ~24 hours to
propagate. GitHub auto-issues free SSL once it detects the domain is
correctly pointed at Pages — check this under Settings → Pages, it
will show "DNS check successful" and an option to enforce HTTPS.

## 5. Don't touch Netlify's DNS-facing settings until GitHub Pages is confirmed working
Keep the Netlify deploy alive (just stop pushing to trigger new
builds — the free tier or an unused site costs nothing extra) until
you've verified GitHub Pages is serving correctly. That way if
anything's wrong, you haven't already cut over your live domain.

## 6. Test before considering it done
- Visit the site on the GitHub Pages default URL first (e.g.
  <username>.github.io/<repo>) to confirm the build works before
  DNS even matters.
- After DNS cutover, visit https://sa-recruiters.co.za/agency/<slug>/
  with JS disabled — you should see real content, same check as before.
- Confirm https://sa-recruiters.co.za/sitemap.xml loads.
- Reinstall/test the PWA to make sure the service worker still
  updates correctly (this is the one behavior that could subtly
  regress — see the caching header note below).

## 7. Once confirmed working, you can delete/pause the Netlify site
To stop any further Netlify usage or charges.

---

## Note on headers
GitHub Pages doesn't support the custom Cache-Control /
security headers your netlify.toml set (e.g. forcing /sw.js and
/index.html to never cache, so PWA updates roll out immediately).
This mostly won't be noticeable, but if users ever seem stuck on an
old app version after a deploy, that's the likely cause. Free fix if
it comes up: put Cloudflare in front of the GitHub Pages site (free
tier, DNS-only proxy) and set the same header rules there.

## Note on the Supabase auto-rebuild webhook
If/when you wire up "new vacancy added → auto rebuild," swap the
Netlify Build Hook URL for a GitHub Actions repository_dispatch or
workflow_dispatch API call instead — same idea, different trigger
mechanism.

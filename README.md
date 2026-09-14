# Scheduled rebuilds for Cloudflare Pages

**What this replaces:** the `schedule: "0 */3 * * *"` cron in the old
`.github/workflows/deploy.yml`, which ran on GitHub Actions to catch
agencies/vacancies added directly in Supabase (via the admin panel)
that don't otherwise get a static page until `generate-pages.js` runs
again.

Cloudflare Pages only rebuilds automatically on a `git push`. This
folder is a tiny Worker that calls your Pages project's **Deploy
Hook** every 3 hours to force a rebuild without a push.

## 1. Create the Pages project (if you haven't yet)

Cloudflare Dashboard → Workers & Pages → Create → Pages → connect
this GitHub repo.

- Build command: `npm install && node generate-pages.js`
- Build output directory: `/` (repo root — `generate-pages.js`
  writes static pages alongside the existing `index.html`)

Cloudflare will now deploy automatically on every push to `main`,
same as the old GitHub Actions workflow did — that part needs no
extra code.

## 2. Create a Deploy Hook

In the Pages project → **Settings → Builds & deployments → Deploy
hooks → Add deploy hook**. Name it e.g. `rebuild-cron`, point it at
the `main` branch, and copy the URL it gives you
(`https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/...`).

Treat this URL as a secret — anyone with it can trigger a rebuild.

## 3. Deploy this Worker

```bash
cd cloudflare-rebuild-cron
npm install -g wrangler   # if you don't have it
wrangler login
wrangler secret put PAGES_DEPLOY_HOOK_URL
# paste the Deploy Hook URL from step 2 when prompted
wrangler deploy
```

The cron schedule (`0 */3 * * *`, same as before) is already set in
`wrangler.toml`.

## 4. Test it manually

Trigger a rebuild on demand instead of waiting for the next cron
tick:

```bash
curl -X POST https://sarecruiters-rebuild-cron.<your-subdomain>.workers.dev
```

Check the Pages project's **Deployments** tab — a new deployment
should appear within a few seconds, triggered by "Deploy Hook"
rather than "Push".

## 5. Retire the old workflow

Once this is confirmed working, delete
`.github/workflows/deploy.yml` and the repo-root `CNAME` file — both
were GitHub Pages-specific and do nothing on Cloudflare Pages.

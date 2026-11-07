# Moving file storage from Supabase to Cloudflare R2

**What this changes:** candidate photos and daily-track MP3s now live in
Cloudflare R2 instead of Supabase Storage. This is what was eating your
Supabase egress — the database itself (agencies, employers, vacancies,
candidates, etc.) stays in Supabase and is untouched.

The R2 bucket **`sarecruiters-media`** already exists in your Cloudflare
account. You need to do 3 things to finish the switch:

## 1. Make the bucket's files publicly readable

Cloudflare Dashboard → R2 → `sarecruiters-media` → **Settings** →
**Custom Domains** → connect `media.sa-recruiters.co.za` (production). Set
`R2_PUBLIC_BASE_URL = "https://media.sa-recruiters.co.za"` in `wrangler.toml`.
The r2.dev address is only a rate-limited development URL.

## 2. Deploy the upload Worker

This folder (`cloudflare-worker/`) contains a small Worker that handles
uploads/deletes securely (R2 credentials never touch the browser). Public
reads bypass it entirely and go straight to the bucket's public URL from
step 1.

```bash
cd cloudflare-worker
npm install -g wrangler   # if you don't have it
wrangler login
```

Open `wrangler.toml` and replace `R2_PUBLIC_BASE_URL` with the URL from
step 1. Then:

```bash
wrangler deploy
```

### Automatic deployment from GitHub Actions

The repository includes `.github/workflows/deploy-worker.yml`. It deploys the
Worker automatically when changes are pushed to `main` under
`Cloudflare-worker/**`, and it can also be started manually from the Actions
tab with **Run workflow**.

Add these repository secrets in GitHub before the first automated deployment:

- `CLOUDFLARE_API_TOKEN` — an API token with permission to edit Workers Scripts
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID that owns the Worker

The workflow uses the `keep_vars = true` setting in `wrangler.toml`, so
dashboard-configured Worker variables and secrets such as
`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, and `GEMINI_API_KEY` are retained
when a deployment runs.

This prints your Worker's URL, e.g.
`https://sarecruiters-uploader.<your-subdomain>.workers.dev`.

## 3. Point the site at the Worker

In both `app.js` and `admin.html`, find:

```js
var R2_WORKER_URL = 'https://REPLACE-ME.workers.dev';
```

and replace it with the URL from step 2. Then redeploy/push the site as
usual (GitHub Pages will pick it up).

---

### How admin auth works here
The daily-track upload/delete endpoints require the logged-in admin's
Supabase session token — the Worker checks it against Supabase's own
`/auth/v1/user` endpoint. No separate password to manage; if you're
signed into `admin.html`, uploads work.

### Old data
Anything already uploaded to Supabase Storage (`candidate-photos`,
`daily-tracks` buckets there) stays where it is and will keep working —
this only changes where *new* uploads go. If you want to migrate the old
files too, say the word and I'll write a one-off script for that.


## D1 public-data write-through

Admin writes that affect public directories use `POST /api/admin/d1/write-through`. The admin UI sends the row representation returned by the same Supabase mutation, so the Worker does not issue a second Supabase row read. The Worker verifies the admin session, applies a table/column allowlist, writes the row (or deletion) and increments `sync_meta.public_data_version` atomically in D1.

`/api/startup`, `/api/vacancies` and `/api/posters` use that version to bypass stale D1/R2/Worker cache entries. When a vacancy snapshot has an older version, the Worker filters/paginates directly from D1; it does not run a full mirror sync. The static Pages snapshot remains a fallback when the Worker is unavailable. The scheduled/manual mirror sync is still used for scraper imports, reconciliation and recovery.

## Yoco paid CV Box downloads

The CV download checkout charges **R49 per CV** (4,900 cents). The Worker creates each checkout server-side, verifies Yoco Checkout API webhook signatures, confirms the checkout directly with Yoco, and only then emails the buyer a private 72-hour download link plus the candidate’s contact details (phone/email from the private pool_candidates row, looked up at payment time), and emails `ADMIN_NOTIFY_EMAIL` an instant "CV payment received" alert. Candidate CV URLs are never sent to the browser before payment.

Before enabling payment fulfillment, ensure these Worker secrets are configured in Cloudflare (never commit or paste the values into source):

- `YOCO_LIVE_SECRET_KEY` — the existing Yoco live secret binding. The Worker uses this name first and also accepts `YOCO_SECRET_KEY` as a fallback.
- `YOCO_WEBHOOK_SECRET` — the one-time `whsec_...` signing secret returned when registering the Yoco Checkout webhook. This is a separate secret and must be saved as a Worker secret before payment fulfillment can run.

`RESEND_API_KEY` must also be configured so buyers receive their paid download. The public non-secret settings are `CV_DOWNLOAD_PRICE_CENTS=4900`, `SITE_URL=https://sa-recruiters.co.za`, and `WORKER_URL=https://sarecruiters-uploader.kamogeloralph.workers.dev` in `wrangler.toml`.

Register one Checkout API webhook in Yoco pointing to `https://sarecruiters-uploader.kamogeloralph.workers.dev/api/yoco/webhook`. The D1 migration `0006_cv_download_orders.sql` creates the private order table; the normal deploy workflow applies remote D1 migrations. Until Yoco secrets and Resend are configured, checkout fails closed and the WhatsApp contact option remains available. Yoco's success redirect is not trusted for payment confirmation; signed webhooks and a server-side checkout lookup are required.

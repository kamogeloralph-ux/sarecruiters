# Moving file storage from Supabase to Cloudflare R2

**What this changes:** candidate photos and daily-track MP3s now live in
Cloudflare R2 instead of Supabase Storage. This is what was eating your
Supabase egress — the database itself (agencies, employers, vacancies,
candidates, etc.) stays in Supabase and is untouched.

The R2 bucket **`sarecruiters-media`** already exists in your Cloudflare
account. You need to do 3 things to finish the switch:

## 1. Make the bucket's files publicly readable

Cloudflare Dashboard → R2 → `sarecruiters-media` → **Settings** →
**Public Access** → enable **"Allow Access"** (r2.dev subdomain).

Copy the `https://pub-xxxxxxxx.r2.dev` URL it gives you.

*(Optional, better for production: attach a custom domain, e.g.
`media.sarecruiters.co.za`, instead of the r2.dev URL — same Settings tab.)*

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

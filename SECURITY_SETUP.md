# Security & integrations setup (Sept 2026)

This covers the three changes shipped together:

1. **Smart Manager token lockdown** — `manage_token` is no longer readable or
   writable by the public; manager links are verified server-side.
2. **Server-side email (Resend)** — admin notifications are sent from the
   Cloudflare Worker instead of the browser (EmailJS stays as a fallback).
3. **Turnstile spam protection** — public report/suggestion forms are gated by
   a Cloudflare Turnstile check verified in the Worker.

## 1. Run the database migration (required — do this first)

Open the Supabase SQL Editor and run **both** of these, in order:

```
supabase/migrations/20260918_lock_down_manager_tokens.sql
supabase/migrations/20260918b_fix_column_grants.sql
```

The second file is required: the first one's column-level `REVOKE`s are
no-ops while Supabase's default table-level grants exist (Postgres effective
privilege = table-level ∪ column-level), so `manage_token` would remain
readable. Part 2 revokes the table-level grants and re-grants explicit
column lists that exclude `manage_token`.

Both are idempotent (safe to re-run). Together they:

- Revokes `manage_token` reads/writes from the anon role (agencies + employers).
- Adds `verify_manager_token` / `verify_employer_manager_token` RPCs used by
  the Worker to resolve manager links server-side (returns no token).
- Adds `manager_add_branch` / `manager_add_vacancy` /
  `manager_employer_add_vacancy` SECURITY DEFINER RPCs that authorize writes
  by token in the database.
- Adds `admin_set_manager_token` / `admin_set_employer_manager_token` RPCs for
  admin token rotation (requires a Supabase Auth session).
- Revokes direct anon INSERT on branches/vacancies/reports/suggestions (all
  four now go through token-authorized or Turnstile-gated RPCs).
- Keeps anon INSERT on `pool_candidates` (public Talent Pool self-registration
  is intentional; RLS keeps pending rows invisible).
- Part 2 keeps anon SELECT/INSERT/UPDATE on every `agencies`/`employers`
  column EXCEPT `manage_token` (admin = `authenticated` role and the
  scrapers = service role are unaffected; public employer self-registration
  still works).

**Rollout order matters:** run this migration BEFORE (or at the same deploy
as) the new Worker + app code. The new app no longer reads tokens from public
data, so nothing breaks if the migration lands first. If the Worker deploys
first without the migration, its verify/RPC endpoints return 502s and the app
falls back gracefully.

## 2. Set the Worker secrets

```bash
cd Cloudflare-worker

# Email (Resend) — enables server-side admin notifications
npx wrangler secret put RESEND_API_KEY
#   Get the key from https://resend.com/api-keys (re_...)

# Spam protection (Turnstile) — enables the /api/submit/* gate
npx wrangler secret put TURNSTILE_SECRET_KEY
#   Get it from Cloudflare Dashboard → Turnstile → your site → secret key

# Optional overrides (defaults shown; only set if you want different values)
npx wrangler secret put ADMIN_NOTIFY_EMAIL   # default: sarecruiters.directory@gmail.com
npx wrangler secret put EMAIL_FROM           # default: SA Recruiters <onboarding@resend.dev>

wrangler deploy
```

Notes on Resend's `from` address: while `EMAIL_FROM` is left at the default
`onboarding@resend.dev`, Resend only delivers to your own account's email
address. For production, verify `sa-recruiters.co.za` in Resend (Domains →
Add domain → add the DKIM/SPF DNS records) and set:

```
EMAIL_FROM = "SA Recruiters <notifications@sa-recruiters.co.za>"
```

(If you prefer not to use a wrangler secret for these two non-secret values,
they can also go in `wrangler.toml` `[vars]`.)

## 3. Turnstile site key (client side)

1. Cloudflare Dashboard → Turnstile → **Add site**
2. Domain: `sa-recruiters.co.za` (add `localhost` too for local testing)
3. Widget mode: **Managed** (invisible is also fine)
4. Copy the **site key** and paste it into `app-sheets.js`:

```js
var TURNSTILE_SITE_KEY = '0x4AAAAAAA...'; // replace the placeholder
```

The **secret key** from step 2 goes to the Worker as `TURNSTILE_SECRET_KEY`.

Until the site key is set, the forms render without a widget and submissions
go through the Worker with no token — which the Worker accepts only when
`TURNSTILE_SECRET_KEY` is also unset (fail-closed otherwise). Once both keys
are set, the check is fully enforced.

## 4. Deploy the site

Push as usual. Cloudflare Pages runs `npm install && node generate-pages.js`,
which bundles the 8 `app-*.js` files into `app.bundle.min.js` and rewrites the
service-worker version. The build's `verify-critical-globals.js` gate now
enforces the new security invariant (`manage_token` must NOT appear in public
selects) in addition to the existing manager-link function checks.

## 5. Verify it works

| Check | How |
| --- | --- |
| Token privacy | `curl "https://ythznnktswgymerdcxky.supabase.co/rest/v1/agencies?select=manage_token&limit=1" -H "apikey: <anon key>"` → `[]` or error, never token values |
| Manager link | Open an agency's Smart Manager link → should open the agency manager screen as before (via `/api/verify-manager`) |
| Employer link | Same for `?manage_employer=...` links |
| Manager writes | From a manager link, add a branch + vacancy → appears in the directory |
| Reports | Submit a report → row appears in admin Reports, email notification arrives |
| Suggestions | Submit a suggestion → row appears in admin Suggestions, email arrives |
| Turnstile | With keys set: submitting without completing the widget is rejected with a clear message |

## What changed in the code

- `supabase/migrations/20260918_lock_down_manager_tokens.sql` — new (all DB
  logic: RPCs, token-write lockdown, submission RPCs)
- `supabase/migrations/20260918b_fix_column_grants.sql` — new (fixes the
  column-grant semantics: table-level revoke + explicit re-grants so
  `manage_token` is truly hidden)
- `Cloudflare-worker/worker.js` — Turnstile verify, Resend email,
  `/api/verify-manager*`, `/api/manager/*`, `/api/submit/*` endpoints
- `app-data.js` / `app-core.js` — public reads drop `manage_token`; token
  saves prefer the admin RPC; anon token backfill removed
- `app-manager.js` / `app-manager-employer.js` — token resolution and writes
  go through the Worker (server-side authorization)
- `app-forms.js` — manager-mode branch/vacancy saves call the Worker
- `app-sheets.js` — Turnstile loader/render; report + suggestion submit via
  the Worker with legacy fallbacks
- `index.html` — no changes needed (Turnstile containers are injected by JS)
- `scripts/verify-critical-globals.js` — verifier now enforces the inverse
  contract: tokens must NOT be in public selects
- `generate-pages.js` — explicit column lists (no `select('*')`) so static
  pages can never carry tokens

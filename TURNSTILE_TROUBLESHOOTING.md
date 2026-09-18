# Turnstile secret key troubleshooting (Sept 18, 2026)

Symptom: the deployed Worker returns

```
503 {"error":"Spam protection is not configured."}
```

from `/api/submit/*` even though `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY`
were saved in the Cloudflare dashboard (Worker → Settings → Variables and
Secrets) and the Worker was redeployed afterwards.

## Diagnosis checklist, in order

1. **Exact name match.** The code reads `env.TURNSTILE_SECRET_KEY` and
   `env.RESEND_API_KEY` (see `verifyTurnstile()` and `sendAdminEmail()` in
   `Cloudflare-worker/worker.js`). A name like `TURNSTILE_SECRET` or a
   trailing space in the name field will silently miss.
2. **Secret vs Variable type.** Both must be type **Secret** (encrypted).
   A plain Variable also works functionally, but only if the name matches —
   `env.X` does not care about the type.
3. **Environment.** The Worker has a single Production environment (no
   preview environment is configured in `wrangler.toml`). If the dashboard
   offered "Preview" vs "Production", the value must be on **Production**.
4. **CI deploys wipe dashboard bindings (root cause found Sept 18).**
   By default `wrangler deploy` DELETES every dashboard-set Variable/Secret
   that is not declared in `wrangler.toml` (`keep_vars` defaults to false).
   Every GitHub-Actions deploy was silently erasing the dashboard secrets
   seconds after they were saved. FIXED: `wrangler.toml` now sets
   `keep_vars = true`, so dashboard bindings survive CI deploys.

## Recommended fix (already wired up)

Two independent paths now exist; either alone is sufficient:

**Path A — dashboard (simplest, works now).** With `keep_vars = true` in
`wrangler.toml`, the secrets you saved in the dashboard (Worker →
Settings → Variables and secrets: `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`
as Secret, `TURNSTILE_SITE_KEY` as Variable) survive every deploy. Just
make sure one Worker deploy happens AFTER `keep_vars` lands in the repo,
then re-save the two secrets in the dashboard once (their earlier values
were deleted by old deploys) and the Worker picks them up.

**Path B — GitHub Actions secrets (reproducible from the repo).**
`.github/workflows/deploy-worker.yml` has a
"Sync Worker secrets (RESEND + TURNSTILE)" step that runs
`npx wrangler secret put ...` AFTER the deploy for each secret present in
repo Actions secrets, so nothing can wipe them; skipped cleanly when not
configured.

To use Path B:

1. GitHub repo → **Settings → Secrets and variables → Actions**
2. Add repository secrets:
   - `RESEND_API_KEY` = the `re_...` key from resend.com/api-keys
   - `TURNSTILE_SECRET_KEY` = the `0x4AAA...` secret key from
     Cloudflare Dashboard → Turnstile → your site
   (`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already set —
   the existing deploy step uses them.)
3. Re-run the **Deploy Cloudflare Worker** workflow (Actions tab → select
   the workflow → Run workflow), or push any change under
   `Cloudflare-worker/`.

## Verify

```bash
# With the secret live, this must be 403 (rejected), NOT 503:
curl -s -o - -w "\nHTTP %{http_code}\n" \
  -X POST "https://sarecruiters-uploader.kamogeloralph.workers.dev/api/submit/report" \
  -H "Content-Type: application/json" \
  -d '{"agencyName":"probe","details":"probe","turnstileToken":"XXXX.DUMMY.TOKEN.XXXX"}'
```

Expected: `HTTP 403` with a Turnstile "invalid input token" style error.
`HTTP 503 Spam protection is not configured.` means the secret still is not
reaching the Worker.

Note: the public **site** key (`0x4AAAAAAAE781UzzffMh7u8L`) is NOT a secret;
it lives in `app-sheets.js` (`TURNSTILE_SITE_KEY`) and as a plain dashboard
Variable. Only the **secret** key goes in Actions secrets / dashboard
secrets.

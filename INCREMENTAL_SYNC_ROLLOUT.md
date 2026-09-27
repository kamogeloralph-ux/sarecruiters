# Incremental vacancy sync rollout

## Current state

- Supabase production now has `vacancies.updated_at`, an update trigger, and an index.
- Cloudflare D1 production still needs the migration in `Cloudflare-worker/migrations/0002_incremental_vacancy_sync.sql`.
- The D1 migration was blocked by the account's daily free-tier row-read limit.
- Do not deploy `Cloudflare-worker/worker.js` until the D1 migration has succeeded.

## After the D1 quota resets

From `Cloudflare-worker/`:

```bash
npx wrangler d1 execute sarecruiters-d1 --remote --file=migrations/0002_incremental_vacancy_sync.sql
```

Then verify the schema:

```bash
npx wrangler d1 execute sarecruiters-d1 --remote --command "PRAGMA table_info(vacancies);"
```

The result must include `updated_at` before deploying the Worker.

## Deployment order

1. Apply the D1 migration.
2. Deploy the Worker.
3. Trigger `POST /api/sync-d1` from the authenticated admin console, or wait for the next scheduled run.
4. Confirm the sync response reports `vacancy_writes` and that the second sync writes zero vacancies when no changes occurred.
5. Deploy the Pages app. It now tries `/api/vacancies` for general and dedicated listings, with Supabase fallback during rollout.

The new API supports both the current offset pagination and cursor pagination. The frontend currently uses offset pagination for compatibility; cursor pagination can be enabled after production latency is measured.

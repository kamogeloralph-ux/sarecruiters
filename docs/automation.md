# SA Recruiters automation

The app runs itself through four layers, each backing up the one before it:

1. **TipChat Autopilot** (Supabase Postgres) moderates every post and comment automatically.
2. **Scheduled jobs** (GitHub Actions) scrape, clean, back up and report.
3. **Watchdog** (Cloudflare Worker cron) notices when anything above stops, restarts it, and only emails you if that did not work.
4. **An outside dead-man's switch** (optional free ping service) notices if the watchdog itself dies.

## Schedules

| Job | Schedule | Purpose |
| --- | --- | --- |
| Refresh static data | 03:30 and 15:30 UTC | Runs all vacancy scrapers, exports the public snapshot and validates it |
| Expire stale vacancies | 03:20 UTC | Removes closed and source-stale vacancies |
| Vacancy caps | 02:30 UTC | Keeps each poster/company at its newest 50 vacancies |
| Link checks | 04:30 UTC | Checks application links and records repeated failures |
| PWA health | 05:30 UTC | Checks the live shell, manifest, service worker, snapshot and icon |
| Community risk scan + moderator digest | Hourly | Flags likely scams/spam and emails a digest of items awaiting review. **Stops emailing once Autopilot is `live`** (Autopilot resolves items itself) |
| TipChat Autopilot insert trigger | On every post/comment | Scores and resolves the submission instantly (Postgres trigger) |
| TipChat Autopilot sweep | Every 5 min (`pg_cron`) | Re-scores pending items, expires unresolved holds, hides heavily reported content |
| Watchdog | Every 30 min (Cloudflare cron, :15/:45) | Site up, D1 sync healthy, Autopilot sweep alive, GitHub workflows alive; self-heals |
| Watchdog deep check + Autopilot digest | Every 6 h; digest at 06:00 UTC | Validates the public snapshot; emails the daily Autopilot summary |
| Backup | 01:30 UTC | Exports operational tables to a private 30-day GitHub artifact |
| Weekly analytics | Mondays 06:00 UTC | Emails a seven-day event summary |

## TipChat Autopilot

Migration: `supabase/migrations/20261013_tipchat_autopilot.sql`.

Every submission is risk-scored the instant it is inserted:

| Outcome | When | Result |
| --- | --- | --- |
| Approve | Score below 30 (new author) or 50 (trusted author) | Live immediately |
| Hide | A *critical* rule fires (advance-fee scam, credential phishing, SA ID number) or score >= 80 | Hidden immediately |
| Hold | Anything in between, and any poster image from a non-trusted author (images cannot be read) | Stays pending; re-scored every 5 min; **hidden after 48 h** if still unresolved |
| Crowd hide | An approved item is reported by 3 distinct accounts older than a day | Hidden automatically |

Authors earn trust: 3+ approved items, nothing hidden in the last 30 days, account 2+ days old. Two hidden items in 30 days makes an author *restricted* (everything they post is held). Items that merely *expired* while held do not count against an author.

Rules, weights and thresholds are **data**, not code. Tune them in the Supabase SQL editor (see the bottom of the migration), no deploy needed.

### Rolling it out (one-time)

1. Apply the migration. It starts in **shadow** mode: it records what it *would* do in `community_moderation_log` and changes nothing. Humans keep moderating exactly as before.
2. After a day or two, review the shadow decisions (queries are in the migration footer, and the daily digest email lists examples).
3. Go live: `update public.community_automod_settings set mode = 'live', updated_at = now();`

Kill switch at any time: set `mode = 'off'` and the old manual flow resumes immediately. Autopilot only ever changes items that are still `pending` (or approved items that got reported); **a human decision is never overridden**.

### What it cannot do

It is rule-based, not a language model. It reliably catches the common job-scam patterns, personal-data leaks, link-shortener spam, duplicates and abuse. It will not catch a novel, well-written scam on first sight; the report threshold, the 48 h fail-closed expiry and the daily digest are the safety nets. Poster images are never inspected, so only established authors can post a poster without a hold.

## Watchdog (Cloudflare Worker)

Code: `Cloudflare-worker/watchdog.js`, scheduled in `wrangler.toml`. It lives on Cloudflare deliberately, so a GitHub or Supabase outage cannot also silence the thing that watches them.

**Heals first, alerts second.** A problem is only emailed if it is still there on the next run (30 minutes later), and then at most once per 24 h, followed by a one-line "recovered" note.

| Detects | Does automatically |
| --- | --- |
| A workflow GitHub switched off after 60 days without repository activity | Re-enables it and runs it |
| A workflow that has not succeeded within ~1.5-2x its schedule | Runs it now (at most once every 6 h) |
| `pg_cron` stopped firing the TipChat sweep | Runs the sweep itself so moderation continues, and tells you |
| Website down, public snapshot empty or older than 36 h, D1 sync failing/stuck/stale | Alerts |
| A workflow failing 3 runs in a row, or the watchdog's GitHub token expired | Alerts |

A workflow a person disabled on purpose is reported but never turned back on.

### Watchdog configuration

All optional; each unlocks one more check. Set them on the Worker (Cloudflare dashboard -> Workers -> sarecruiters-uploader -> Settings -> Variables and Secrets, or `npx wrangler secret put NAME` in `Cloudflare-worker/`).

| Name | Type | Purpose |
| --- | --- | --- |
| `GITHUB_REPO` | Variable | `owner/repo`. Turns on GitHub workflow self-healing |
| `WATCHDOG_GH_TOKEN` | **Secret** | Fine-grained GitHub token, this repository only, permission **Actions: Read and write**. (GitHub reserves names starting `GITHUB_` for its own secrets, hence the name.) Set an expiry reminder: an expired token is itself reported |
| `HEALTHCHECK_PING_URL` | Secret | A free healthchecks.io (or similar) ping URL, called every run. If the watchdog ever stops, that service emails you. Set its period to ~1 hour |
| `OPS_ALERT_EMAIL` | Variable | Alert recipient (falls back to `ADMIN_NOTIFY_EMAIL`) |
| `SITE_URL`, `GITHUB_BRANCH` | Variable | Defaults: `https://sa-recruiters.co.za`, `main` |

`RESEND_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already configured for the Worker and are reused.

## Required GitHub secrets

Existing secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`

Add these repository Actions secrets:

- `OPS_ALERT_EMAIL` = `sarecruiters.directory@gmail.com`
- Optional `EMAIL_FROM` = a verified Resend sender, for example `SA Recruiters Alerts <alerts@sa-recruiters.co.za>`

Set them in GitHub under **Settings → Secrets and variables → Actions → New repository secret**. The email address is intentionally not committed to source control.

## Safety behavior

- Closing-date cleanup treats a vacancy as visible on its closing date and removes it from the next day.
- Link failures are recorded; the checker reports repeated failures rather than deleting on a single transient outage.
- TipChat Autopilot is the one automation that changes user content. That is why it ships in shadow mode, is fully audited (`community_moderation_log`, 90 days), fails closed (nothing doubtful is published) and never overrides a human. Every other automation here only flags, reports or restarts.
- Backups are private GitHub artifacts with 30-day retention. For long-term disaster recovery, download periodic artifacts to a separate private storage location.
- PWA health checks are deterministic HTTP checks; they do not claim to simulate every device/browser installation path.

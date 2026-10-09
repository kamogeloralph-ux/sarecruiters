# SA Recruiters automation

The repository now runs eight operational automations through GitHub Actions and Supabase.

## Schedules

| Job | Schedule | Purpose |
| --- | --- | --- |
| Refresh static data | 03:30 and 15:30 UTC | Runs all vacancy scrapers, exports the public snapshot and validates it |
| Expire stale vacancies | 03:20 UTC | Removes closed and source-stale vacancies |
| Vacancy caps | 02:30 UTC | Keeps each poster/company at its newest 50 vacancies |
| Link checks | 04:30 UTC | Checks application links and records repeated failures |
| PWA health | 05:30 UTC | Checks the live shell, manifest, service worker, snapshot and icon |
| Community risk scan | Every 6 hours | Flags likely scams, payment requests and spam for moderator review |
| Backup | 01:30 UTC | Exports operational tables to a private 30-day GitHub artifact |
| Weekly analytics | Mondays 06:00 UTC | Emails a seven-day event summary |

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
- Community risk scanning creates moderator flags and does not automatically delete or hide user content.
- Backups are private GitHub artifacts with 30-day retention. For long-term disaster recovery, download periodic artifacts to a separate private storage location.
- PWA health checks are deterministic HTTP checks; they do not claim to simulate every device/browser installation path.

# Monthly agency vacancy email — implementation and review

## Agreed scope

Send at most one message per agency in a month, only when its current listing email has explicitly opted in through that agency's private Manager Link. Do not include non-consenting addresses or addresses whose email has changed since consent. Every message must provide one-click unsubscribe. Use the existing `EMAIL_FROM` configuration and schedule the first send for 09:00 Africa/Johannesburg time on the first day of the month.

The campaign flag is intentionally `false` by default. No campaign should be enabled or sent until the owner reviews and approves the exact copy below. The opt-in panel only records an agency manager's affirmative choice; it does not enroll existing addresses automatically.

## Proposed message — pending owner approval

**From:** `SA Recruiters <notifications@sa-recruiters.co.za>` (configured `EMAIL_FROM`)

**Subject:** Share your agency vacancies for free on SA Recruiters

**Body:**

> Hi [Agency Name] team,
>
> You can list your agency's current vacancies on SA Recruiters for free. Add or update your listings using your private manager link:
>
> **Manage your listings**
>
> Your manager link is unique to your agency. Keep it private and do not forward it.
>
> You are receiving this monthly reminder because your agency opted in. If you don't want any more monthly reminders, unsubscribe here.
>
> SA Recruiters<br>
> https://sa-recruiters.co.za

This copy is a draft only. Production sending stays disabled until it is approved.

## Safety and delivery design

- A separate consent record stores the agency id, the email address at consent time, opt-in/opt-out timestamps, and an opaque unsubscribe token. Existing directory emails are not treated as consent.
- Manager-only preference operations and campaign claims are executed by server-role-only database functions. Browser callers never receive campaign recipients or other agencies' preferences.
- The campaign ledger uses a unique `(agency_id, month)` key and a per-month email-address uniqueness constraint. It rechecks the current agency email and active consent immediately before claiming a send.
- Resend's `Idempotency-Key` protects bounded same-day retries; its documented deduplication window is 24 hours, so the database month ledger remains the durable duplicate-prevention mechanism.
- RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers use a hard-to-forge opaque token. A normal GET only presents a confirmation page; the one-click POST unsubscribes directly, avoiding mail-scanner GETs that accidentally opt people out.
- The first campaign is not sent as part of implementation or deployment. Enabling the explicit Worker flag requires the copy review and confirmation that the sender domain is verified.

## Technical references

- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) — supported email endpoint, request header, and 24-hour retention.
- [Resend custom email headers](https://resend.com/docs/dashboard/emails/custom-headers) — custom `List-Unsubscribe` header support.
- [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058/) — one-click unsubscribe via HTTPS POST and the `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header.
- [South African Information Regulator direct-marketing guidance](https://inforegulator.org.za/wp-content/uploads/2020/07/GUIDANCE-NOTE-ON-DIRECT-MARKETING-IN-TERMS-OF-THE-PROTECTION-OF-PERSONAL-INFORMATION-ACT-4-OF-2013-POPIA.pdf) — retained as a project reference; the selected implementation follows the user's opt-in-only instruction.

# TODO

## Google-style vacancy feed redesign

- [x] Replace the tall, cluttered vacancy rows with compact, title-first job cards using quiet separators, employer branding, inline metadata, bookmark/share actions, and a direct apply affordance.
- [x] Refresh the vacancy search surface with calmer chips, tighter controls, clearer result status, and a cache-busted stylesheet version while preserving existing filters, sorting, saving, sharing, and detail expansion.

## Manager-scoped vacancy activity metrics

- [x] Agency and employer manager links show per-vacancy tracked apply-link clicks and self-reported application counts for the last 30 days.
- [x] Keep event reads behind a server-role-only, manager-token-scoped SQL function; return aggregate counts only and preserve manager access when metrics are unavailable.
- [x] Add regression coverage for owner scoping, service-role access, privacy, and the UI fallback.
- [x] Apply `supabase/migrations/20261111084515_manager_vacancy_analytics.sql` to SA.Recruiters; confirm it is recorded and `service_role`-only.

## Manager-link mobile layout

- [x] On agency and employer manager links, the entire manager screen scrolls vertically on mobile, including its header/banner and all branch/vacancy content; remove the horizontal divider between the intro and manager content.

## Monthly agency vacancy outreach

- [x] Implement the monthly free-listing invitation with explicit opt-in only, no more than one email per agency and shared address per month, current-email/consent matching, one-click unsubscribe, the configured `EMAIL_FROM`, and a 1st-of-month 09:00 Africa/Johannesburg schedule with bounded retries.
- [x] Add the private manager-link consent control and server-side preference routes; existing directory email addresses are not enrolled automatically.
- [ ] Apply `supabase/migrations/20261114080000_agency_monthly_outreach.sql` to production and verify the service-role-only grants before enabling manager consent controls.
- [ ] Keep `AGENCY_VACANCY_OUTREACH_ENABLED` false until the exact message in `AGENCY-OUTREACH-PLAN.md` is reviewed and approved; do not send the first campaign before approval.

## Remaining production checks

- [x] Worker deployment for commit `32fde7b` succeeded; check the latest Worker publish after upstream updates before closing rollout.
- [ ] Publish and confirm the Pages workflow after applying the transient-503 retry; the live export also filters expired/capped rows and passed validation with 6,034 current rows.
- [x] Confirm the Worker has `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a non-empty `EMAIL_FROM` binding. The sender domain's verification status remains unconfirmed.
- [x] Verify production grants for `20261104042157_restrict_server_only_rpc_execute.sql`; the protected RPCs show `postgres` and `service_role` execution only.

## Shared candidate flows and compact home/account cards

- [x] The Home “Take your next step” candidate and employer cards use the same content, structure, visual treatment, and actions as their Quick Access counterparts, reduced in padding, icon, typography, and button size.
- [x] The account “Need help finding work?” and hamburger-menu “Looking for work?” actions open the existing CV Box application/profile flow, so a signed-in candidate can create or update the same CV Box profile and a signed-out visitor follows the existing account gate.
- [x] Quick Access candidate upload and the Home candidate action use the same shared CV Box entry point; the legacy private job-seeker request flow is not launched by the converted entry points.
- [x] The saved vacancy-alert card is compact and has the same centered content width as neighboring account cards.

## White public pages and full-color branding

- [x] All public listing, contact, Terms, Privacy, FAQ, and Know Your Rights pages keep a white background and light color scheme regardless of device dark mode.
- [x] Agency/company/poster imagery on public listings stays in its source color, and public/legal headers plus favicons use a color SA Recruiters mark.
- [x] Regression tests cover the shared page theme and legal-resource pages.

## App-wide blue visual identity

- [x] App screens, cards, navigation, menus, forms, dialogs, and selected/focus states use the same blue accent and the white/light surface style of the public pages in light mode; the existing optional dark mode remains usable with the same blue brand accent.
- [x] Every in-app SA Recruiters mark, favicon, installed/PWA icon, share/preview logo, and notification icon uses the blue logo; maskable icons keep their safe-area composition and monochrome mask icons keep their required monochrome treatment.
- [x] App browser-theme and install metadata use the new blue/white palette.

## App visibility and contrast follow-up

- [x] Small app icons across navigation, cards, controls, and sheets are crisp and clearly visible in light and dark modes, with slightly stronger size/stroke/opacity while preserving semantic colors.
- [x] The “Support the Directory” message is readable against its ticker background in both the Home footer section and hamburger Menu hero, including narrow screens and reduced-motion mode.
- [x] The Home hamburger visibly renders three high-contrast bars inside a clear, accessible touch target; it opens the site drawer above the page, and close/backdrop/keyboard-focus states remain visible across responsive layouts and themes.

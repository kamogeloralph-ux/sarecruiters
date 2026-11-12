# TODO

## Google-style vacancy feed redesign

- [x] Replace the tall, cluttered vacancy rows with compact, title-first job cards using quiet separators, employer branding, inline metadata, bookmark/share actions, and a direct apply affordance.
- [x] Refresh the vacancy search surface with calmer chips, tighter controls, clearer result status, and a cache-busted stylesheet version while preserving existing filters, sorting, saving, sharing, and detail expansion.

## Manager-scoped vacancy activity metrics

- [x] Agency and employer manager links show per-vacancy tracked apply-link clicks and self-reported application counts for the last 30 days.
- [x] Keep event reads behind a server-role-only, manager-token-scoped SQL function; return aggregate counts only and preserve manager access when metrics are unavailable.
- [x] Add regression coverage for owner scoping, service-role access, privacy, and the UI fallback.
- [ ] Apply `supabase/migrations/20261111100000_manager_vacancy_analytics.sql` to the correct SA Recruiters Supabase project and verify the RPC there.

## Remaining production checks

- [ ] Confirm the Worker and Pages deployments succeeded after the source update.
- [ ] Confirm the Worker has `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a verified `EMAIL_FROM` domain configured.
- [ ] Verify the production grants for `20261104042157_restrict_server_only_rpc_execute.sql`.

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

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
- [x] Apply `supabase/migrations/20261115043514_20261114080000_agency_monthly_outreach.sql` to production; verify both tables have RLS and all outreach RPCs use a fixed search path with execute grants only for `postgres` and `service_role`.
- [x] Owner approved the exact message in `AGENCY-OUTREACH-PLAN.md` on 2026-11-15; campaign activation is deployed, with no immediate send and the first possible run on 2026-12-01 at 09:00 Africa/Johannesburg.

## Remaining production checks

- [x] The Test, Cloudflare Pages, and Cloudflare Worker workflows succeeded for rollout commit `7c079c9`.
- [x] Activation commit `0cc54ea` passed Test and Worker deployment; the live Worker now has the approved campaign flag enabled.
- [x] Publish and confirm the Pages workflow after applying the transient-503 retry; the live export also filters expired/capped rows and passed validation with 6,034 current rows.
- [x] Confirm the Worker has `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and a non-empty `EMAIL_FROM` binding. The sender domain's verification status remains unconfirmed.
- [ ] Confirm Resend has verified `sa-recruiters.co.za` before the first scheduled message; the verification status is not confirmed here.
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

## Production workspace UI refactor acceptance outcomes

- [x] The existing static PWA is refactored in place to match the supplied `new-ui-preview.html` visual design and structure while preserving all existing functionality; it remains the current static PWA rather than becoming a new website.
- [x] The workspace keeps the dark navy sidebar `#111c2e`, light-gray/paper canvas `#f7f9fc`, white cards, electric indigo-blue accent `#4f6df5`, mint/green status badges `#dff7ed` / `#138a67`, 16px–22px rounded corners, and subtle elevation shadows.
- [x] Overview, Find vacancies, Agencies, CV Box talent, Employers, and Saved roles remain visible and usable, together with the top search bar, quick actions, and Post a vacancy CTA.
- [x] Responsive behavior is audited at `<=1000px` and `<=700px`; no desktop, tablet, or mobile section, navigation link, action, or feature is hidden. Smaller layouts use scrolling, wrapping, stacking, and accessible compact controls.
- [x] Overview transitions stay in memory and do not use `location.reload()` or lose the active application state.
- [x] Find vacancies keyword, mode, and location filters, Agencies search, Employers directory, and CV Box talent are connected to the existing real data, state, APIs, and profile workflow, with clean loading, empty, and error states.
- [x] Save role persists across views and sessions, updates counts and indicators everywhere, and supports direct removal from Saved roles; the implementation reuses localStorage plus Supabase `saved_vacancies`.
- [x] Post a vacancy, Create CV Box profile, View agency, and View company call the existing production workflows/routes/detail views rather than placeholder modals or prototype-only handlers.
- [x] Every existing app feature remains accessible, including authentication/account, feedback, scam check, ads, branches, manager links, submissions, legal links, theme controls, and existing posting/profile flows.
- [x] The refactor has no duplicate style/script blocks, duplicate IDs, conflicting global state, prototype-only saved key, hard-coded talent/directory cards, or reload-based navigation.
- [ ] Focused regression coverage, `npm run build:app`, syntax/build checks, full `npm test`, route-manifest validation, and `git diff --check` pass before the final change is fetched/rebased, committed, and pushed to `origin/main`.

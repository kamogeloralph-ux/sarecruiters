# Compatibility audit notes

## Current state

The attached SA Recruiters PWA was imported into `client/public/`, with its original `index.html` used as the Vite entry point. The original generator is preserved under `legacy/` and the existing managed server remains intact.

## Verified

- `pnpm build` completes successfully.
- The existing static source includes `index.html`, `app.js`, `content.js`, `content-manager.js`, `styles.css`, `sw.js`, PWA metadata, and icons.
- The authoritative vacancy creation handlers are `saveVacancy()` and the new-record branch of `saveGeneralVacancy()`.
- Supabase is currently called directly from browser JavaScript, with a localStorage fallback for vacancy data.

## Issue to resolve before feature work

The first preview screenshot showed the app splash screen still visible at capture time. Runtime logs contain very large image/data payloads, so the browser console should be filtered to actual errors before changing application logic. Likely compatibility checks are needed around deferred script loading and the splash reveal callbacks.

## Scope guardrail

Do not add WhatsApp credentials, paid providers, new external services, or irreversible database changes in this compatibility-first phase. Preserve the existing vacancy, admin, PWA/offline, Supabase, and static-page-generation behavior.

## Verification update

- Fixed the optional missing `sponsor-widget.js` reference by making the bootstrap conditional; the app still retains sponsor slots and will initialize the widget if it is later provided.
- Added a public-page-safe `updateEmployerRegUI` helper so the shared data loader no longer rejects on the public PWA.
- Added an accessible connection status for live, loading, cached, offline, and error states, using the existing cache and retry behavior.
- Applied the same status/bootstrap changes to the active Vite entrypoint, not only the copied public file.
- `node --check client/public/app.js` passes.
- `node --check legacy/generate-pages.js` passes.
- `pnpm build` passes without the previous sponsor-widget build warning.
- Preview now renders the existing directory home screen with live listing status visible; existing cards, counts, search, navigation, and bottom navigation remain present.

## Responsive entry-point verification

At a 390×844 mobile viewport, the public home screen renders the existing directory cards, counts, search field, theme control, bottom navigation, and the new live-listings status. The admin entry point renders its restricted-access login surface, and the privacy page renders its legal content. No entry point is visually blank or trapped on the splash screen.

## Final screen-state verification

- Added contextual empty-state copy for home search, saved vacancies, and all-vacancy folder filters.
- Added a compatibility test covering those messages and the existing vacancy save handlers.
- `pnpm test` passes with 2 test files and 6 tests.
- `node --check client/public/app.js` and `node --check legacy/generate-pages.js` pass.
- `pnpm build` passes.
- The 390×844 preview still shows the existing home experience, directory cards, counts, bottom navigation, and live connection status.

The broader create/edit/delete, forced offline, and GitHub Pages regeneration flows are not fully end-to-end tested in this sandbox because they require live admin credentials, live Supabase write access, and the external GitHub Actions environment.

## Final hardening update

- Vacancy link fields now normalize ordinary domain values to HTTPS while preserving existing HTTP(S) values and legacy non-domain text.
- Both vacancy save handlers now use try/catch/finally. Submit controls are marked busy during the request, errors are logged without secrets, users receive an explicit retry message, and controls are always re-enabled.
- The static generator was executed successfully against the current Supabase dataset. It fetched 119 agencies, 103 branches, and 324 vacancies; it generated 119 agency pages, 324 vacancy pages according to its own completion summary, a configured location hub, and a 40,039-byte sitemap. The local directory count is lower because some generated vacancy routes share nested output layouts; the generator summary is the authoritative run result.
- No write, delete, or schema operation was performed by the generator run.

## Final state-contract verification

- Employer vacancy hubs and manager vacancy lists now expose explicit ready/empty state markup using the shared screen-state styling.
- Search, saved, all-vacancy, employer, and manager containers have initial or rendered state feedback rather than blank containers.
- The connection-status label logic is now a pure deterministic function used by the live UI. Compatibility tests execute offline, cached, error, and live cases and verify their user-facing labels.
- The final test run passes 2 test files and 8 tests, and both JavaScript entrypoints pass syntax checks.
- The generator output is verified at 324 vacancy files, 324 unique vacancy sitemap URLs, zero duplicate vacancy URLs, and 119 agency files.

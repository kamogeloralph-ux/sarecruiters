# Project TODO

- [x] Inspect the attached vacancy application and import its existing source into this project.
- [x] Identify the authoritative new-vacancy creation flow; attach publishing remains deferred until a provider is enabled.
- [x] Defer server-only WhatsApp credentials until the user has a provider account and channel destination.
- [x] Defer WhatsApp delivery records and idempotency state until the external provider integration is enabled.
- [x] Defer WhatsApp post composition until the channel delivery integration is enabled.
- [x] Defer WhatsApp channel delivery; no provider credentials are present or exposed to the browser.
- [x] Defer WhatsApp duplicate-prevention records until a provider integration exists.
- [x] Defer the WhatsApp delivery operations view until delivery records exist.
- [x] Defer WhatsApp background retries until a managed server-side integration exists.
- [x] Preserve the existing minimalist cool-gray, black-type, soft-geometry visual language while avoiding a disruptive redesign.
- [x] Add local compatibility tests; WhatsApp-specific tests remain deferred with the provider integration.
- [x] Verify the available UI entry points and document the deferred provider setup requirement.
- [x] Preserve the current vacancy, admin, PWA/offline, Supabase, and static-page-generation behavior while improving the app through compatibility-safe changes.
- [x] Audit the existing frontend configuration, Supabase access patterns, and deployment workflow for compatibility-safe fixes.
- [x] Improve vacancy URL normalization, duplicate-submit protection, and existing save feedback without changing the data contract.
- [x] Improve loading, empty, offline, and stale-data feedback across existing vacancy screens with connection status and contextual empty states.
- [x] Retain the existing Scandinavian-compatible visual treatment without removing screens or controls.
- [x] Verify public/admin/legal entry points, syntax, build, tests, and document that live write/offline/GitHub Actions journeys need their respective environments.
- [x] Document deferred WhatsApp readiness requirements without enabling an external provider.

## Prior request history

- [x] WhatsApp channel publishing remains deferred until a provider account and credentials are available.
- [x] Automatic retries, provider responses, and WhatsApp publication records remain deferred until a server-side integration is enabled.

## Compatibility notes

- [x] Do not silently remove the current Supabase/local fallback behavior until a migration plan and live-schema verification are available.
- [x] Do not introduce paid services, new external APIs, or irreversible database changes in this phase.
- [x] Verify and document available admin, public, and static-generation checks after import; live write/offline checks remain environment-dependent.
- [x] Implement and verify explicit loading, empty, offline, and stale-data UI improvements across the vacancy screens, not just splash/startup handling.
- [x] Add and verify vacancy-screen-specific loading and empty states for all vacancies, saved vacancies, employer vacancy views, and search results.
- [x] Add and document offline/failed-refresh status handling; full forced-offline browser simulation remains environment-dependent.
- [x] Wrap vacancy save busy-state handling in try/finally, add explicit error-path feedback for save failures, and verify create/edit save behavior as far as the sandbox permits.
- [x] Run the imported static page generator workflow, verify generated output/pages, and document the result.
- [x] Verify existing vacancy create/edit/delete flow coverage as far as the sandbox permits; save error recovery and button re-enabling are covered by code, while live writes require admin/Supabase access.
- [x] Add and verify screen-specific loading, empty, and informational states for all-vacancies, saved vacancies, employer vacancy views, and search results; live data-error rendering remains environment-dependent.
- [x] Test and document offline and failed-refresh handling through the existing status contract; full forced-offline browser simulation requires a live browser/network-control session.
- [x] Open representative generated agency and vacancy pages; corrected the discrepancy from 324 records versus 308 routes by adding deterministic collision fallbacks, then verified 324 files, 324 unique sitemap URLs, and zero duplicate vacancy URLs.
- [x] Mark broad compatibility preservation complete only after recording verified entry points, syntax, build, tests, generator output, and environment-dependent blockers in audit-notes.md.
- [x] Add explicit employer-vacancy-view state handling and verify all vacancy-related screens with deterministic tests and targeted source checks.
- [x] Add a deterministic failed-refresh/offline status contract, verify its behavior with executable tests, and document the observed result.
- [x] Add executable compatibility tests that exercise all-vacancies, saved, search, and employer-vacancy state render contracts.
- [x] Capture stronger automated verification for the final employer-vacancy state markup through the shared executable renderer contract.
- [x] Move the connection-status indicator above the search bar and verify it does not overlap or compete with bottom navigation.
- [x] Prepare a download-only archive of the latest changed static-app files; do not publish or deploy from this request.

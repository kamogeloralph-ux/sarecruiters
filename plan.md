# Vacancy marketplace redesign plan

## Outcome
Redesign the public vacancies experience in the existing SA Recruiters static app so it feels like a premium, modern job marketplace while preserving the current Supabase/live data layer and application actions.

## Architecture
- Keep the current static SPA shell and classic-script architecture.
- Reuse `vacanciesCache`, `agenciesCache`, `featuredVacanciesCache`, `vacancyCard`, save/share/apply handlers, source folders, and the existing load-more flows.
- Expand the vacancies screen markup with a marketplace header, search controls, filter chips, industry discovery, and sorting.
- Add a focused redesign stylesheet at the end of `styles.css` so existing screens remain stable.
- Add a small JS enhancement layer for industry normalization, sort state, active filter summaries, and control wiring; do not add a new data provider or credentials.

## UX decisions
- Search-first browse surface inspired by high-performing job boards: clear query + location, prominent results count, one-tap chips, and a compact filter row.
- Industry is a first-class control and a visible horizontal discovery rail. It is derived from vacancy fields and agency trades so it works with current live data.
- Default sort is newest; users can switch to relevance, salary high-to-low, or title A–Z when data supports it.
- Cards keep the existing expandable details and apply/contact links, but gain stronger metadata hierarchy, saved state, featured treatment, and mobile-friendly spacing.
- Use deep ink, warm surfaces, lime highlight, and coral accent with clear focus states and reduced-motion support.

## Delivery and validation
The app is a static frontend with no new server or database capability. The existing `generate-pages.js`/bundle process remains the build contract. Validate with the existing Node test suite, rebuild the app bundle, start the configured Preview listener on port 3000, and check HTTP readiness plus source-level behavior.

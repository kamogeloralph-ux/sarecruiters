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

## Interview Tips visual system refresh

- **Design movement:** compact community-product UI with soft editorial surfaces and a confident blue gradient anchor.
- **Core principles:** clear hierarchy, quiet borders, compact controls, and consistent card rhythm.
- **Color philosophy:** deep ink and cool blue create trust and focus; lavender-blue surfaces make actions discoverable without visual noise; muted gray text keeps dense directory data readable.
- **Layout paradigm:** stacked content groups with strong section labels, compact headers, and full-width cards rather than isolated dashboard tiles.
- **Signature elements:** blue-to-indigo feature surfaces, 15–18px rounded cards, and small uppercase utility labels paired with concise supporting copy.
- **Interaction philosophy:** every primary action is a clear filled control; secondary actions use quiet outlined or tinted surfaces; focus states use the same accent-soft halo as Interview Tips.
- **Animation:** retain the app’s existing motion, but keep hover/lift subtle and respect reduced-motion preferences.
- **Typography system:** Inter for all UI, 800-weight compact headings, 10–12px utility labels, and 12–14px readable body copy.
- **Brand essence:** a trusted South African recruitment community that makes finding work and connecting talent feel clear, human, and practical; **focused, welcoming, credible**.
- **Brand voice:** direct and supportive — “Find your next opportunity” and “Ask the community.”
- **Wordmark & logo:** preserve the existing SA Recruiters mark while giving it a stronger blue product shell.
- **Signature brand color:** Interview Tips blue `#2268ce`, paired with indigo `#574ce5` and accent-soft blue surfaces.

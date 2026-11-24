## Home Top Jobs This Week

- **Purpose:** Add a compact, table-like Home surface inspired by the supplied reference image without copying its branding or artwork.
- **Selection:** Inspect active vacancies posted in the last seven days, infer each vacancy's native South African province from explicit province fields and location/address text, rank newest/featured roles, and choose the three provinces with the strongest weekly activity.
- **Presentation:** Render one province panel per selected province, with up to five ranked vacancy rows, a weekly role count, and a link to the province's public listings.
- **Interaction:** Each row opens the exact vacancy in the existing vacancy screen; the province link opens the generated provincial SEO page.
- **Responsive behavior:** Three panels appear side-by-side on wider screens and become a horizontal snap rail on mobile, keeping the Home screen continuous and compact.

## Consistent candidate and account-card flows

- **Shared CV Box application:** The Home “Take your next step” candidate card, Quick Access candidate upload action, account “Need help finding work?” card, and hamburger “Looking for work?” action all open the existing CV Box profile application/edit flow. Signed-out visitors follow its existing free-account gate; signed-in candidates can create or update the same profile.
- **Home card presentation:** Reuse the Quick Access candidate/employer card structure and actions in “Take your next step,” with reduced padding, icon, typography, and button dimensions so the two home sections read as one system.
- **Vacancy alerts:** Keep the saved-search alerts card compact and align its width with the other centered account cards.
- **Project structure:** `index.html` owns static screen/menu markup, `app-ui.js` owns the shared Home CV Box entry point and Home card rendering, and `styles.css` owns shared and compact card presentation. The existing `app-sheets.js` CV Box application remains the single source of registration/edit behavior.


## App-wide blue brand refresh

Carry the public pages’ blue-and-white brand through the app using the existing blue mark and shared app theme tokens. In light mode, use white and very light blue-gray surfaces, dark readable text, and the same brand blue for navigation, focus, links, buttons, selected states, and highlights. Keep the existing manual dark-mode option, but use the same blue brand accent and matching logo there. Recolor every shared SA Recruiters app/PWA logo variant without changing the mark silhouette or the PWA maskable safe area; keep the dedicated monochrome notification-mask icons monochrome. Update browser chrome and install metadata to match.


### Visibility and contrast polish

Keep app icons crisp across light and dark modes by restoring full opacity, slightly increasing small icon size/stroke weight, and using contrast-appropriate navigation colors without erasing semantic success, warning, or danger colors. Make the Home and Menu support ticker text legible on a solid white pill with blue type. Render the hamburger as three visible blue bars in a white, high-contrast 48px control; preserve its existing open/close behavior, add clear focus feedback, and keep the drawer/backdrop visible above app screens at mobile and desktop widths.

## Production workspace UI refactor

### Implementation approach

Refactor the existing static PWA in place. Add a production workspace shell around the current `.screen` collection: a persistent dark-navy workspace sidebar, a contextual top workspace bar, and the existing screen stack as the content region. The shell is presentation and navigation only; vacancy, directory, authentication, CV Box, posting, manager-link, account, feedback, scam-check, advertising, and legal workflows remain owned by their current modules and endpoints. A small `app-workspace.js` module maps the six workspace destinations to the existing in-memory transitions (`goBackHome`, `showAllVacancies`, `showAllAgencies`, `goPool`, `showAllEmployers`, and Saved) and observes the active screen so the sidebar and saved indicators stay accurate.

The top workspace search forwards keyword input to the existing vacancy search state and renderer, while the Post a vacancy, Create CV Box profile, quick directory, profile, theme, feedback, and saved controls call existing production handlers. No reload-based navigation, preview-only saved key, hard-coded directory data, placeholder toast, duplicate state store, or new backend route is introduced. The current local-storage plus Supabase `saved_vacancies` synchronization remains the source of truth; saved changes emit a small UI event so every shell indicator can update without a reload.

### Approved visual system

Use the supplied `new-ui-preview.html` as the visual reference: `#111c2e` navy workspace chrome, `#f7f9fc` paper canvas, white cards, `#4f6df5` electric indigo actions, `#dff7ed` / `#138a67` mint status treatment, 16–22px card radii, and restrained elevation shadows. The workspace uses a spacious editorial dashboard composition rather than replacing the production content with mock cards. Existing live vacancy, agency, employer, and CV Box renders are styled as the reference’s role, directory, and talent surfaces. The existing blue SA Recruiters identity, light/dark theme support, and semantic success/warning/danger colors remain intact where they carry product meaning.

### Responsive and accessibility behavior

At desktop widths the workspace sidebar is a full-height vertical rail and the top bar/content sit in the adjacent paper canvas. At widths up to 1000px the rail becomes a sticky, horizontally scrollable workspace navigation strip with every destination still present and labelled. At widths up to 700px the top bar wraps into an accessible full-width search and compact action rows; cards stack, filters wrap or scroll, and content remains vertically scrollable. No workspace navigation link, core action, production section, or feature is removed with `display:none`; compact controls use wrapping, overflow scrolling, and stacking. All new buttons have labels, keyboard focus styles, live status where needed, and respect reduced-motion preferences.

### State, routing, and project structure

- `index.html` owns the shell landmarks, six navigation buttons, top search/actions, and the wrapper around the existing app screens.
- `app-workspace.js` owns only shell navigation mapping, active-state synchronization, saved/auth indicator updates, and forwarding shell actions to existing window/module handlers.
- `workspace-ui.css` is the single appended workspace design layer loaded after the legacy theme layers, so the current screen/component CSS remains reusable and no duplicate style block is added.
- `app-entry.js` imports the workspace module after the production modules are available; `app-cards.js` emits saved-change notifications after local and remote persistence.
- Existing query/deep-link behavior and `manus-routes.json` remain unchanged because this refactor does not add page routes. In-memory transitions preserve current state and use the existing session restoration model.

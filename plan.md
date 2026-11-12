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

# Admin Separation — Standalone Admin Console (Option A)

## Problem
The public app (`index.html`) contained a plaintext admin PIN (`910821`) directly in the
page source. Anyone could open **View Source** and read the PIN. The localStorage-based
lockout (5 attempts / 15 minutes) was trivially bypassed by clearing localStorage or
opening an incognito window. Users were "taking chances with the pin."

## Solution — Option A: Separate Admin URL
Admin access has been moved out of the public app entirely into a standalone
`admin.html` console, protected by **Supabase email/password authentication** (not a PIN).

### What changed in the public app (`index.html`)
1. **Removed the plaintext `ADMIN_PIN = '910821'`** — now `var ADMIN_PIN = '';` (unused).
2. **Removed the admin login button** from the header (top-right lock icon).
3. **Removed the "Admin login" menu item** from the Profile → Account section.
4. **Removed the "Smart Manager" and "Submissions" menu items** from Profile → Post & Manage
   (these were admin-only and are now managed from the admin console).
5. **Removed the `fab-admin` floating action button** (add-agency FAB) — agency add/edit
   is now done from the admin console.
6. **Removed the entire admin sheet** (PIN gate, login fields, logged-in toggle).
7. **Removed all Supabase auth calls** from the public app (`signInWithPassword`,
   `auth.signOut`, `auth.getSession`). No session is restored in the public app.
8. **Stubbed out** `verifyPin`, `showPinLockMsg`, `isPinLocked`, `openAdminSheet`,
   `adminLogin`, `adminLogout`, `updateAdminUI` as no-ops (so any leftover references
   don't throw errors). `openAdminSheet()` now shows an alert pointing to admin.html.
9. **`isAdmin` is permanently `false`** in the public app, so all `if (isAdmin)` guarded
   features (edit buttons, verified toggle, admin FAB) stay hidden.

### What was KEPT intact in the public app
- **`?manage=TOKEN` agency self-service flow** — agencies can still add/edit their own
  branches and vacancies via their unique manager token URL. This is non-admin and
  unaffected by the changes.
- **Public vacancy posting** — controlled by the `public_vacancy_posting` setting in
  `app_settings` (now toggled from the admin console). When closed, public users see the
  "Vacancy posting is closed" sheet with a WhatsApp link to request access.
- **All user-facing features** — search, agency cards, branches, vacancies, ratings,
  suggestions, reports, content articles, theme toggle, etc.

### New standalone admin console (`admin.html`)
A complete, self-contained admin console at a separate URL (`admin.html`), **not linked
from the public app**. Features:
- **Login gate** — Supabase email/password auth. No session = no access (login screen only).
- **Session restore** — reloads keep you logged in via Supabase session.
- **Sidebar navigation**: Dashboard, Agencies, Branches, Vacancies, Submissions, Settings, Content.
- **Dashboard** — live counts of agencies, branches, vacancies, reports, suggestions.
- **Agencies CRUD** — add, edit, delete, upload logo, regenerate manager token, toggle verified.
- **Branches CRUD** — add, edit, delete (with parent agency selector).
- **Vacancies CRUD** — full field editing.
- **Submissions inbox** — reports (resolve/reopen/delete) + suggestions (delete), tabbed.
- **Settings** — public vacancy posting toggle.
- **Content manager** — edit/delete/add articles (uses `content.js` + `content-manager.js`).
- **Dark/light theme** with localStorage persistence.
- **Manager link generator** — each agency shows its `?manage=TOKEN` URL for sharing with
  the agency.

## How to use
1. **Deploy** `admin.html` alongside `index.html` (same directory).
2. **Access** the admin console by navigating directly to `admin.html` (e.g.
   `https://yourdomain.com/admin.html`). It is intentionally not linked from the public app.
3. **Log in** with your Supabase admin credentials (email + password).
4. **Bookmark** the admin URL for convenience — but it requires auth every time.

## Security notes
- The admin PIN is gone. There is no PIN in the public app source anymore.
- Admin access requires a valid Supabase auth session (email + password), managed server-side.
- For production hardening, consider adding **Row Level Security (RLS) policies** in Supabase
  so that write operations on `agencies`, `branches`, `vacancies`, `reports`, `suggestions`,
  and `app_settings` require an authenticated admin user (not just the anon key). This
  prevents anyone with the anon key from writing directly via the API.
- The `?manage=TOKEN` flow relies on token secrecy — keep manager tokens private and
  regenerate them from the admin console if one is compromised.

## Files modified
- `index.html` — removed PIN, admin login UI, admin auth calls; stubbed admin functions.
- `sw.js` — cache version bumped v47 → v48; `admin.html` added to precache list.
- `admin.html` — NEW standalone admin console (Supabase auth + full CRUD).

# SA Recruiters — Diagnosis & Fix Report

## What I did
I unzipped your `sarecruiters-main-updated.zip`, read through the full application (`index.html`, `sw.js`, `manifest.json`, `offline.html`, the SQL setup files), and then **tested your live Supabase backend directly** to confirm exactly what is and isn't working. I also served the app from a subdirectory in a browser to reproduce the logo issue. Below are the findings, the fixes I applied, and the one action you still need to take.

---

## ISSUE 1 — Vacancies only show on your device, not to other users

### Root cause (confirmed by live testing)
The **`vacancies` table does not exist** in your Supabase database. I verified this by querying your live Supabase REST API, which returns:

```
HTTP 404 — "Could not find the table 'public.vacancies' in the schema cache"
```

Your app saves vacancies like this: it *tries* to write to the Supabase `vacancies` table, and if that fails it **silently falls back to your browser's localStorage**. Because the table is missing, every save fails → the vacancy is stored only in **your** browser. Other users' browsers have empty localStorage and get the same 404 from Supabase, so they see **nothing**.

For comparison, I tested every other table — `agencies`, `branches`, `app_settings`, `ratings`, `reports`, `suggestions` — and **all of them exist and work**. That's why agencies and branches show up for everyone, but vacancies don't. (Your live stats confirm this: 66 agencies and 99 branches load fine, but Vacancies = 0.)

The SQL file to create the table (`CREATE_VACANCIES_TABLE.sql`) is already in your project folder — it just was never run in the Supabase dashboard.

### The fix (TWO parts)

**Part A — What YOU must do (1 minute, this is the real fix):**
Run the SQL in your Supabase dashboard to create the `vacancies` table:

1. Go to your Supabase Dashboard → **SQL Editor** → **New query**
2. Paste the entire contents of `CREATE_VACANCIES_TABLE.sql` (also reproduced at the bottom of this report)
3. Click **Run**

Once the table exists, every vacancy you publish is stored in Supabase and **instantly visible to all users on all devices**. No code change needed — the app already writes to this table; it just can't until the table exists.

**Part B — What I already did in the code (resilience improvement):**
Previously, when a save fell back to localStorage, the app showed a misleading "Vacancy published" toast. I changed `saveVacancy()` and `saveGeneralVacancy()` so that when a save does **not** reach Supabase, you now see a clear warning instead:

> ⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).

This way you'll never again think a vacancy went live when it didn't. After you run the SQL, the toast will correctly say "Vacancy published".

> Note: any vacancies you saved *before* creating the table are trapped in your browser's localStorage and won't automatically move to Supabase. After creating the table, just re-add them once and they'll be live for everyone.

---

## ISSUE 2 — The "+" add-agency icon is missing

### Root cause (confirmed in the code)
The floating "+" button (`<button id="fab-admin">`) was **accidentally deleted from the HTML**. The JavaScript still tries to control it in three places (`updateAdminUI`, `enterManagerMode`, `exitManagerMode`), but because the element no longer existed, `document.getElementById('fab-admin')` returned `null` and nothing was shown. I verified this is the **only** missing element in the entire app — every other ID the code references exists.

### The fix (already applied in the code)
I re-added the `fab-admin` button to `index.html`, right next to the existing suggestion button. It:
- Shows a blue circular "+" icon
- Appears only when you're logged in as admin (hidden for regular visitors)
- Calls `openForm()` to open the "Add agency" form (verified working — clicking it opens the form with title "Add agency")
- Hides correctly in Manager Mode

I also added a small CSS rule (`.fab svg`) so the "+" icon sizes correctly.

---

## ISSUE 3 — Logos don't display (brand logo, favicons, PWA icons)

### Root cause (confirmed by testing in a browser)
Every image reference in the app used an **absolute path** that started with a leading slash, e.g. `/icons/icon-512.png`. An absolute path always resolves against the **domain root**. That works only when the app is hosted at the root of a domain (e.g. `https://example.com/`). But if the app is served from a **subdirectory** — for example `https://example.com/recruiters/`, a Netlify sub-path, or any folder under another site — the browser requests `https://example.com/icons/icon-512.png` instead of `https://example.com/recruiters/icons/icon-512.png`, which 404s. Result: the brand logo, the profile avatar, the favicons, the apple-touch-icon, and every PWA manifest icon are all broken.

I reproduced this exactly: serving the app from a subdirectory, the brand logo reported `naturalWidth: 0` (failed to load). After the fix it reported `naturalWidth: 512` (loaded successfully). I also confirmed the fix doesn't break root-hosting — relative paths resolve correctly from the root too.

This affected three files:
- **`index.html`** — 2 in-page `<img>` tags (brand logo + profile avatar) and 16 `<link>` favicon/apple-touch/mask-icon references
- **`manifest.json`** — 20 icon `src` values, 5 screenshot `src` values, plus `start_url` and `scope`
- **`offline.html`** — 3 image references (favicon, apple-touch-icon, logo img)

### The fix (already applied in the code)
I converted **every** absolute path to a **relative** path by removing the leading slash:
- `/icons/icon-512.png` → `icons/icon-512.png`
- `/screenshots/screen1.png` → `screenshots/screen1.png`
- `start_url: "/?source=pwa"` → `"./?source=pwa"`
- `scope: "/"` → `"./"`

Relative paths resolve against the **location of the HTML file itself**, so the icons are found whether the app lives at the domain root or in any subdirectory.

I also added an `onerror` fallback on the two in-page logo images: if `icons/icon-512.png` ever fails, they automatically swap to `sa-recruiters-512-rounded.png` (a copy that lives in the project root). This is a belt-and-suspenders safety net.

---

## FEATURE — Agency Ratings moved to the Profile section (ranked leaderboard)

### What changed
Previously the "Rate this agency" feature lived only inside each agency's expanded card on the Home/Search screen (the "Rate ⭐" tab). Rating results were hard to find and there was no way to see which agencies were rated best. I moved the rating feature into the **Profile section** so users can rate and compare all agencies in one place, and highly-rated agencies automatically climb to the top.

### How it works now
1. **Profile → "Rate Agencies" menu item** opens a ranked leaderboard of all 66 agencies.
2. **Each agency row** shows its rank number, logo, name, star score (e.g. ★★★★★ 5.0), and number of ratings. Agencies with no ratings yet say "Not rated yet — be the first!"
3. **Tap any agency** to expand an inline rating panel where you can pick an emoji (😍 Great / 🙂 Good / 😐 Okay / 😕 Poor / 👎 Bad), optionally add your name and a comment, and submit — all without leaving the Profile screen.
4. **The results appear right there**: overall star score, a summary of how many of each emoji were given, and the individual public reviews (most recent first).
5. **Ranking**: agencies are sorted by average rating score (😍=5 points down to 👎=1 point), then by verified status, then by number of ratings, then alphabetically. So an agency with lots of high ratings automatically climbs to the #1 spot. The top 3 ranks get gold / silver / bronze badges.
6. **The Home and Search lists now sort the same way** — highly-rated agencies rise toward the top everywhere, not just in the leaderboard.
7. **The agency profile card (hub card) still has its "Rate ⭐" tab**, and now it also shows the overall star score and review count as a badge on the card itself (e.g. ⭐5.0), plus the full results inside the tab. So rating results appear on the profile card too.

### What I added to the code
- A numeric score for each emoji and an `agencyScore()` helper that computes the average score, count, and star rating for any agency.
- A `starsHtml()` helper that renders a 5-star row.
- A `renderRatingBoard()` function that builds the ranked leaderboard with inline rating panels.
- A `toggleRatingBoard()` function wired to the new "Rate Agencies" Profile menu item.
- A `ratingsLoaded()` callback that re-sorts and re-renders the agency lists after ratings finish loading from Supabase (ratings load asynchronously, so without this the initial sort would miss them).
- Updated the sort logic in `loadAll()` and `refreshRatingBoard()` to rank by score first.
- The rating badge on each hub card now shows the average score (⭐5.0) instead of just the count.
- New CSS for the leaderboard: rank badges, score rows, star display, inline panel, and overall-score box.
- After a rating is submitted (or edited/deleted by admin), the leaderboard and all lists refresh immediately so the agency climbs or descends to its correct rank.

### Verified in the browser
- Frogg Recruitment SA (which had one 😍 "Great" rating = 5.0) climbed to **#1** on both the Profile leaderboard and the Home list, ahead of all verified but unrated agencies.
- Tapping an agency expands the inline rating form; submitting a rating updates the rank in real time.
- The "Rate ⭐" tab on the hub card shows the overall score (★★★★★ 5.0, "Based on 1 rating") and the individual review.
- No JavaScript syntax errors.

---

## Other things I checked (all healthy)
- **All HTML element IDs** referenced by JavaScript resolve correctly (after the fab-admin fix). No other missing buttons/inputs.
- **No JavaScript syntax errors** — the entire inline app script parses cleanly.
- **Service worker** bumped from v40 → v42 so the cached HTML, manifest, and offline page all update for returning users.
- **Stale code comment** updated — it incorrectly claimed the `branches` table didn't exist; branches actually works fine, only `vacancies` was missing.
- **Agencies, branches, ratings, reports, suggestions, app_settings** tables all confirmed present and functioning in your live Supabase project.
- **Agency photos** (base64 data URIs in the `agencies` table `photo` column) were verified to load correctly — they were never part of the logo problem.

---

## Files I changed
| File | Change |
|------|--------|
| `index.html` | Re-added the `fab-admin` "+" button + `.fab svg` CSS rule; improved vacancy-save warning toasts; updated stale comment; converted 2 logo `<img>` + 16 favicon `<link>` paths from absolute to relative with onerror fallback; **new rating leaderboard feature** — emoji scores, `agencyScore()`/`starsHtml()`/`renderRatingBoard()`/`toggleRatingBoard()`/`ratingsLoaded()` functions, "Rate Agencies" Profile menu item, ranked leaderboard UI + CSS, score-first sort, rating badge shows avg score on hub cards |
| `sw.js` | Bumped cache version v40 → v43 |
| `manifest.json` | Converted 20 icon + 5 screenshot `src` from absolute to relative; changed `start_url` to `./?source=pwa` and `scope` to `./` |
| `offline.html` | Converted 3 icon references (favicon, apple-touch-icon, logo img) from absolute to relative |

## Files you should keep (no change, but use them)
| File | Purpose |
|------|---------|
| `CREATE_VACANCIES_TABLE.sql` | **Run this in Supabase SQL Editor** to fix Issue 1 |

---

## SQL to run in Supabase (Issue 1 fix) — also in CREATE_VACANCIES_TABLE.sql

```sql
CREATE TABLE IF NOT EXISTS public.vacancies (
    id TEXT PRIMARY KEY,
    agency_id TEXT NOT NULL DEFAULT 'general',
    title TEXT NOT NULL DEFAULT '',
    company TEXT DEFAULT '',
    location TEXT DEFAULT '',
    closing_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    link TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'vacancies'
                   AND column_name = 'company') THEN
        ALTER TABLE public.vacancies ADD COLUMN company TEXT DEFAULT '';
    END IF;
END $$;

ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vacancies_select_all" ON public.vacancies;
CREATE POLICY "vacancies_select_all" ON public.vacancies
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "vacancies_insert_all" ON public.vacancies;
CREATE POLICY "vacancies_insert_all" ON public.vacancies
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "vacancies_update_all" ON public.vacancies;
CREATE POLICY "vacancies_update_all" ON public.vacancies
    FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vacancies_delete_all" ON public.vacancies;
CREATE POLICY "vacancies_delete_all" ON public.vacancies
    FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_vacancies_agency_id ON public.vacancies(agency_id);
```

After running it, verify with: `SELECT * FROM public.vacancies LIMIT 5;` (it should return an empty table, HTTP 200, no error).

---

## Summary
- **Issue 2 (missing "+" icon): FIXED in the code.** Re-deploy the updated files and the add-agency button will be back for admins.
- **Issue 3 (logos not displaying): FIXED in the code.** All image paths converted from absolute to relative so logos, favicons, and PWA icons load correctly whether the app is hosted at the domain root or in a subdirectory. Re-deploy the updated files.
- **Agency Ratings feature: ENHANCED.** Ratings now live in the Profile section as a ranked leaderboard — users rate agencies inline, results appear on each agency's profile card, and highly-rated agencies climb to the top of the leaderboard, Home, and Search lists.
- **Issue 1 (vacancies not visible to users): Root cause = missing Supabase table.** I made the app warn you clearly when a save isn't live, but the **actual fix is to run `CREATE_VACANCIES_TABLE.sql` in your Supabase dashboard**. Once done, vacancies publish to the cloud and all users see them immediately.

**To deploy the fixes:** upload the updated `index.html`, `sw.js`, `manifest.json`, and `offline.html` to your web server (replacing the old ones), then run the SQL above in Supabase. Because the service worker cache version was bumped to v43, returning visitors will automatically pick up the new files on their next visit — no manual cache-clear needed.

---

# Update 4 — iOS-Style Profile Redesign + Expandable Vacancy Cards

## What changed

### 1. Profile section → iOS/Luno-style grouped lists with colored icon tiles

The Profile section was redesigned from a flat list of buttons into **iOS-style grouped lists** (like the Settings app on iPhone, or the Luno app). Each menu item now has its own **distinct colored rounded-square icon tile** instead of a plain monochrome icon.

**Group structure:**

| Group | Items | Tile colors |
|-------|-------|-------------|
| **Account** | Admin login, Rate Agencies | Blue, Amber |
| **Post & Manage** | Post a Vacancy, Smart Manager (admin only), Submissions (admin only) | Green, Indigo, Orange |
| **Community** | Suggest or comment, Support & Donations, Report a problem | Teal, Pink, Red |
| **Resources** | Learning Hub, How to Prepare Your CV, CV Revamp Service, Interview Tips, Know Your Rights, FAQ | Blue, Purple, Mint, Orange, Brown, Gray |
| *(unnamed)* | Privacy Policy, Switch to day/night mode | Gray, Gray |

**Key design details:**
- Each icon tile is a 34×34px rounded square (9px radius) with a two-color linear gradient (145°)
- 12 tile colors available: blue, purple, teal, green, orange, red, indigo, pink, gray, mint, amber, brown
- SVG icons inside tiles render in white (stroke:#fff) with 2px stroke width
- Chevron arrows (›) appear at the right end of each row
- Separator lines between rows (indented 52px from left, like iOS)
- Section headers in uppercase, 13px, secondary text color
- Cards remain neutral (card background, border) — only the icons are colored, keeping a professional look

**CSS classes added:** `.profile-card-ios`, `.profile-avatar-ios`, `.pgroup-label`, `.pgrouped-list`, `.tile-blue` through `.tile-brown`, `.mi-chev`

### 2. Vacancy cards → expandable iOS-style cards with company logos

Vacancy cards were completely redesigned from flat text cards into **expandable cards** (like the job app screenshots the user provided). Key features:

**Collapsed state (always visible):**
- **Company logo tile** — 46×46px rounded square with a gradient background and company initials (e.g. "BE" for Basic Education). Agency vacancies show the agency's actual photo/logo if available.
- Job title (bold, 15px)
- Company/agency name (12.5px, secondary text)
- **Info chips** — small rounded pills showing location, employment type, contract type, salary, and closing date
- Save/bookmark star button (top right)

**Expanded state (tap to expand):**
- **Detail rows** with icon + label + value:
  - Location (pin icon)
  - Employment Type (briefcase icon) — combined with contract type
  - Salary (money icon)
  - Hours (clock icon)
  - Work Schedule (calendar icon)
  - Start Date (calendar icon)
  - Closing Date (calendar icon)
  - Company/Agency (building icon)
- **Job description** section (from the Notes field)
- **Action buttons:**
  - "Apply here" (green, if a link exists) → opens the application URL
  - "Contact agency" (green, for agency vacancies with contact info) → opens agency website
  - "Contact to apply" (green, if no link) → shows a toast message
  - "Close" (neutral) → collapses the card
- **Admin actions** (admin only, general vacancies): Edit + Delete buttons

**Logo tile gradients:** 12 deterministic gradient classes (`grad-blue` through `grad-gray`) — the gradient is chosen by hashing the company/agency name, so each company gets a stable, consistent color.

**CSS classes added:** `.vac-card`, `.vac-card-main`, `.vac-logo`, `.grad-*`, `.vac-body`, `.vac-title`, `.vac-company`, `.vac-chips`, `.vac-chip`, `.vac-save`, `.vac-detail`, `.vac-detail-inner`, `.vac-detail-row`, `.vac-detail-icon`, `.vac-detail-label`, `.vac-detail-value`, `.vac-desc`, `.vac-actions`, `.vac-apply`, `.vac-close-btn`, `.vac-admin-actions`

### 3. Vacancy form → new optional fields

Both the **agency vacancy form** ("Add vacancy") and the **general vacancy form** ("Post a vacancy") now include these optional fields:
- Employment type (e.g. Full-time, Part-time, Contract)
- Contract type (e.g. Permanent, Fixed-term, Casual)
- Salary (e.g. R18,000 pm or TBC)
- Hours (e.g. 45 hours per week)
- Work schedule (e.g. Mon–Fri, shifts)
- Start date (e.g. ASAP or 1 Oct 2026)

These fields power the new detail rows and chips in the expandable vacancy cards. They are all optional — existing vacancies without these fields still display correctly (the detail rows simply don't appear for missing fields).

### 4. Supabase vacancies table → new columns

`CREATE_VACANCIES_TABLE.sql` was updated to include the new columns: `employment_type`, `contract_type`, `salary`, `hours`, `work_schedule`, `start_date`. The script uses `DO $$ ... END $$` blocks with `IF NOT EXISTS` checks so it's safe to re-run on an existing table — it will `ALTER TABLE ADD COLUMN` only for columns that don't yet exist.

**If you already created the vacancies table:** simply re-run `CREATE_VACANCIES_TABLE.sql` in your Supabase SQL Editor — it will add the new columns without dropping any data.

### 5. Service worker cache bumped to v44

`sw.js` version updated from `sa-recruiters-v43` → `sa-recruiters-v44` so returning visitors automatically pick up the redesigned Profile and vacancy cards on their next visit.

## Files changed
- `index.html` — Profile HTML restructured into iOS grouped lists; vacancy card CSS + JS rewritten; vacancy forms extended with new fields; theme icon JS updated for tile rendering
- `sw.js` — cache version v43 → v44
- `CREATE_VACANCIES_TABLE.sql` — new columns added

## Verification
- ✅ All JavaScript parses cleanly (`node --check` passes on both inline JS and `sw.js`)
- ✅ Profile screen renders with 5 grouped sections, all colored tiles visible
- ✅ Admin-only items (Smart Manager, Submissions) hidden when not logged in, shown when admin
- ✅ Vacancy cards display with company logo tiles, info chips
- ✅ Tap-to-expand works: detail rows (Location, Closing Date, Company) appear with icons
- ✅ "Contact to apply" + "Close" buttons render and function correctly
- ✅ Theme toggle icon updates correctly (sun/moon) on the gray tile

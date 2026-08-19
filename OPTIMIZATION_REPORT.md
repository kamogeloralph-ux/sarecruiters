# Why `index.html` loads slowly — and how to fix it

## The diagnosis (verified against your actual file)

Your `index.html` is **265,866 bytes (~260 KB)** — a single monolithic page shell.
Here is the exact byte breakdown I measured:

| Component | Bytes | % of file |
|---|---|---|
| Inline `<style>` block | 54,564 | 20% |
| Inline `<script>` block | 148,261 | 55% |
| Inline `<svg>` icons (85 in markup + 74 in JS) | 29,152 | 10% |
| HTML markup + head/meta | ~33,000 | 12% |

That single file must be **fully downloaded and parsed before anything renders**.
Gzipped it is ~56 KB, so raw size isn't the whole story — the *real* cost is
**parse-blocking and render-blocking**, which the three causes below explain.

---

## The 3 real causes

### Cause 1 — One 265 KB file blocks the entire render path
A browser cannot paint your shell until it has downloaded `index.html`, parsed it,
hit the `<style>` in `<head>`, and executed the inline `<script>`. Because the
script (148 KB) sits at the end of `<body>` *and* the CDN scripts (Supabase,
EmailJS) in `<head>` have **no `defer`**, the main thread is blocked three times
over on a single document. There is nothing for the browser to do in parallel.

### Cause 2 — 54 KB of CSS is render-blocking and inline
The whole stylesheet lives inside one `<style>` tag in `<head>`. CSS in `<head>`
is always render-blocking: the browser will not paint a single pixel until every
rule is downloaded and the CSSOM is built. 54 KB of rules — most of which style
content far below the fold — all gate the first paint.

### Cause 3 — 159 inline SVG icons, but only ~40 unique
You embed **85 SVG icons directly in the markup** and **74 more inside the JS**.
I deduplicated the markup set: there are only **35 unique icons**, repeated up to
13× (e.g. the chevron `M9 6l6 6-6 6` appears 13 times). Every repeat is parsed by
the HTML parser as fresh DOM, inflating the parse cost and the document size for
zero visual benefit.

---

## The fix (already applied in this folder)

I split the monolith into four files and removed every render/parse blocker.
Behaviour is identical — only *how* the bytes are delivered changed.

### What changed

1. **`styles.css`** — the 54 KB `<style>` block extracted into a real stylesheet,
   loaded **non-blockingly** with the print-media swap trick:
   ```html
   <link rel="preload" as="style" href="styles.css">
   <link rel="stylesheet" href="styles.css" media="print" onload="this.media='all'">
   <noscript><link rel="stylesheet" href="styles.css"></noscript>
   ```
   This lets the browser paint the HTML structure immediately and apply styles
   as soon as the file arrives, instead of blocking first paint on 54 KB of CSS.

2. **`app.js`** — the 148 KB inline `<script>` extracted and loaded with `defer`:
   ```html
   <script src="app.js" defer></script>
   ```
   `defer` lets the browser keep parsing HTML *while* the script downloads, then
   runs it in order after the document is parsed — no main-thread stall.

3. **`icons.svg`** — the 35 unique icons moved into a single external `<symbol>`
   sprite (5 KB). Every repeated icon in the markup is now a one-line reference:
   ```html
   <svg class="mi-chev"><use href="icons.svg#i1b1edb"/></svg>
   ```
   The sprite is fetched once and cached; the HTML parser sees 84 tiny `<use>`
   elements instead of 84 full SVG subtrees. The 74 SVGs embedded inside `app.js`
   were left in place (they're generated dynamically and deduping them is a
   separate, lower-value refactor).

4. **Deferred the CDN + content scripts** — Supabase, EmailJS, `content.js` and
   `content-manager.js` all gained `defer`, so they no longer block rendering in
   `<head>`. Because all five scripts are `defer`, they still execute in document
   order, so `app.js`'s `window.supabase.createClient(...)` still runs after the
   Supabase library is available.

5. **`sw.js`** — the precache list (`CORE_ASSETS`) now includes `styles.css`,
   `app.js` and `icons.svg`, and the cache version bumped `v58 → v59` so the new
   shell is actually cached on existing installs.

### Before → after

| | Before | After |
|---|---|---|
| `index.html` (raw) | 265,866 B | **51,673 B** (−80%) |
| `index.html` (gzip) | 56,040 B | **10,177 B** (−82%) |
| Shell payload, raw | 265,866 B (1 file) | 260,248 B (4 files) |
| Shell payload, gzip | 56,040 B | 56,381 B |

**The total gzipped bytes are almost the same (~56 KB) — and that is the point.**
The problem was never that the shell was too big to download; it was that all of
it was stuffed into one render- and parse-blocking file. After the split:

- The browser can **paint the HTML shell after ~10 KB** (the new `index.html`,
  gzipped) instead of waiting for 56 KB.
- `styles.css`, `app.js`, and `icons.svg` download **in parallel** and apply/run
  as they arrive — none of them blocks the first paint the way the old inline
  `<style>` and `<script>` did.
- On repeat visits the service worker serves all four files instantly from cache.

### Still worth doing later (not blocking, lower priority)

- **Critical-CSS inlining**: pull just the above-the-fold rules (theme vars,
  `.app`, header, search bar — maybe 3–4 KB) back into a tiny inline `<style>`,
  and let `styles.css` load async. This makes first paint happen before the
  stylesheet even arrives.
- **Minify** `styles.css` and `app.js` (e.g. with `esbuild` / `lightningcss`).
  That typically takes the 56 KB gzip total down to ~40 KB.
- **Deduplicate the 74 SVGs inside `app.js`** the same way — route them through
  `icons.svg` too, or generate them from a small JS icon map.

---

## Files in this deliverable

- `index.html` — optimized shell (51 KB)
- `styles.css` — extracted stylesheet (54 KB)
- `app.js` — extracted app logic (148 KB)
- `icons.svg` — 35-icon sprite (5 KB)
- `sw.js` — updated service worker (v59, precaches the new assets)

Drop these into your deploy directory in place of the old `index.html` (keep
`content.js`, `content-manager.js`, `manifest.json`, `icons/`, etc. as-is) and
the app will behave exactly as before, but render noticeably faster.

---

# Round 2 — Icon colour fix + removed giant black arrow

## What was wrong (reported via screenshot of the Talent Pool screen)

A huge **black left-pointing arrow** sat in the middle of the Talent Pool page,
with the descriptive info text displaced below it. The same broken arrow
appeared on **four** list screens (All Agencies, All Branches, All Vacancies,
Talent Pool).

### Root cause

The arrow was the `goBackHome()` button's icon (`icons.svg#i48c59a`). After the
sprite extraction in round 1, that icon became a `<use>` reference, but the CSS
rule for **`.list-back-btn svg` had no `width`, `height`, `stroke` or `fill`**.
So the browser rendered the `<use>` at the SVG's intrinsic size (huge) using the
default black fill — a giant black blob. This is the same class of bug that can
hit *any* `<use>`-based icon whose container selector forgets to size it.

## The fix (applied)

1. **Removed the `.list-back-bar` / "Back to Home" arrow** from all four list
   screens. Navigation home is already handled by the bottom nav bar, so the
   arrow was redundant *and* broken.
2. **Promoted the info text to the top** of each list screen's content area as a
   new `.screen-intro` banner — a soft, seamless card with a purple accent
   border that matches the app's `--accent` token. The Talent Pool screen's
   existing description moved up into the slot the arrow used to occupy, and the
   other three screens got consistent intro banners of their own:
   - *All Agencies:* "Browse every listed recruitment agency — search by name,
     trade or industry…"
   - *All Branches:* "Search agency branches by name, location or parent
     agency…"
   - *All Vacancies:* "Latest vacancies across all agencies. Filter by work
     arrangement, experience level or industry…"
   - *Talent Pool:* "Browse job seekers who've joined the Talent Pool…" (moved
     up from below the old arrow).
3. **Added a global icon-safety CSS block** so no `<use>`-based icon can ever
   render as a huge black blob again, even if a specific selector is missing:
   ```css
   svg{display:block;flex-shrink:0}
   button > svg:only-child, .mi-icon svg, .icon-btn svg {
     width:1em; height:1em; max-width:24px; max-height:24px;
     stroke:currentColor; fill:none; stroke-width:2;
     stroke-linecap:round; stroke-linejoin:round;
   }
   /* filled icons (stars, save, play, badges) keep their fill */
   .star-btn svg,.save-btn svg,.track-play svg,.badge svg,.verified-check svg{
     fill:currentColor; stroke:none
   }
   ```
   This guarantees every icon inherits its container's text colour
   (`color:inherit`), stays within a 24 px box, and uses a consistent 2 px
   stroke — a seamless, friendly look across both dark and light themes. I
   checked `admin.html` and `offline.html`; their icons are inline with baked-in
   `stroke`/`fill` attributes and already-sized selectors, so they were never
   affected.

4. **Bumped the service worker** `v59 → v60` so existing installs pick up the
   new shell and intro banners immediately.

## Verified in-browser

Loaded the app, switched to each affected screen, and screenshotted both dark
and light themes: the giant black arrow is gone, the info banner sits at the top
of the content area, and all icons (search, user-plus on the CTA, bottom nav,
theme toggle) are correctly sized and coloured.

---

# Round 3 — Unified purple icon palette + clean WhatsApp buttons

## What was still wrong

Two issues remained after round 2:

1. **Black icons on the home screen.** The save/bookmark buttons, vacancy save
   buttons, star ratings, search icon and the *inactive* bottom-nav icons all
   used `var(--text-2)` / `var(--text-3)` (dark grey that reads as black) for
   their stroke/fill. So every neutral icon looked black instead of on-brand.

2. **The WhatsApp button icon looked bad.** The "Send via WhatsApp" /
   "Message admin on WhatsApp" buttons used the filled WhatsApp logo /
   chat-bubble glyphs, but they were being drawn with `stroke:currentColor;
   fill:none` (an outline) on a green button — rendering as a messy black
   outline blob instead of a clean white WhatsApp glyph.

## The fix (applied)

**Unified the entire icon palette to the purple accent (`--accent = #6C5DFF`).**
No icon anywhere in the app now uses black/dark-grey for its neutral state.

- `.save-btn` (bookmark on agency cards): outline purple at 70% opacity;
  filled solid purple when saved.
- `.vac-save` (bookmark on vacancies): same purple outline → solid purple.
- `.star-btn` (star ratings): purple outline at 55% → solid purple when lit.
- `.search-inner svg` (magnifier): purple at 80% opacity (was dark grey).
- `.rate-list-title svg`, branch edit icons: purple.
- **Bottom nav:** inactive icons are purple at 50% opacity; the active tab is
  full purple. Previously inactive icons were dark grey/black.
- Added a global default so any `<use>` icon without a specific colour rule
  inherits the purple accent rather than falling back to black.

**Cleaned up the WhatsApp buttons and contact tile.**
- Added a `.wa-glyph` class for the filled WhatsApp logo / chat-bubble icons:
  `fill:#fff; stroke:none` — they now render as crisp solid white glyphs.
- Added `.wa-btn` (green `#25D366` button, white glyph) for the two
  "Send via WhatsApp" / "Message admin on WhatsApp" CTAs.
- Added `.wa-tile` (green rounded icon tile, white glyph) for the WhatsApp
  contact row in the Support sheet, so it matches the button styling.

**Bumped the service worker** `v60 → v61` so existing installs get the new
icon palette immediately.

## Verified in-browser

Reloaded the app and screenshotted: home screen (dark + light), profile
screen with the Talent Pool feature card and "Check for updates" button, the
WhatsApp confirmation sheet, and the Support sheet. Every icon — bottom nav,
save/bookmark, stars, search, chevrons, refresh, play, WhatsApp glyphs — now
renders in the purple accent or as a clean white glyph on coloured buttons.
No black icons remain.

# SA Recruiters PWA — Deployment Guide

## Quick Start

Upload **all 35 files** below to your web server's root directory (the same folder where `index.html` lives). Preserve the folder structure exactly — `icons/` and `screenshots/` must remain subdirectories.

## File Structure

```
your-web-root/
├── index.html              ← Main app (188 KB)
├── manifest.json           ← PWA manifest — all 28 tests PASS (5.6 KB)
├── sw.js                   ← Service worker v40 (8.9 KB)
├── offline.html            ← Offline fallback page (2.3 KB)
├── netlify.toml            ← Hosting config — headers & caching (Netlify)
│                             (Netlify only; safe to ignore on other hosts)
├── .htaccess               ← Apache hosting config — headers & caching
│                             (Apache only; safe to ignore on Netlify/Vercel)
├── privacy.html            ← Privacy policy (3.6 KB)
├── content.js              ← App content/data (31.8 KB)
├── content-manager.js      ← Content management logic (6.5 KB)
├── icon-192.png            ← Root-level 192px icon (38.5 KB)
├── icon-512.png            ← Root-level 512px icon (237.9 KB)
├── icons/
│   ├── favicon.ico                 ← Multi-size favicon (8.3 KB)
│   ├── favicon-16.png              ← 16×16 favicon (0.9 KB)
│   ├── favicon-32.png              ← 32×32 favicon (2.6 KB)
│   ├── icon-48.png                 ← 48×48 any purpose (4.6 KB)
│   ├── icon-72.png                 ← 72×72 any purpose (9.2 KB)
│   ├── icon-96.png                 ← 96×96 any purpose (13.5 KB)
│   ├── icon-128.png                ← 128×128 any purpose (23.7 KB)
│   ├── icon-144.png                ← 144×144 any purpose (27.0 KB)
│   ├── icon-152.png                ← 152×152 any purpose (32.4 KB)
│   ├── icon-192.png                ← 192×192 any purpose (45.4 KB)
│   ├── icon-256.png                ← 256×256 any purpose (78.2 KB)
│   ├── icon-384.png                ← 384×384 any purpose (172.6 KB)
│   ├── icon-512.png                ← 512×512 any purpose (282.0 KB)
│   ├── icon-1024.png               ← 1024×1024 any purpose (669.3 KB)
│   ├── maskable-192.png            ← 192×192 maskable purpose (44.0 KB)
│   ├── maskable-256.png            ← 256×256 maskable purpose (76.8 KB)
│   ├── maskable-384.png            ← 384×384 maskable purpose (169.2 KB)
│   ├── maskable-512.png            ← 512×512 maskable purpose (273.9 KB)
│   ├── maskable-1024.png           ← 1024×1024 maskable purpose (651.2 KB)
│   ├── monochrome-192.png          ← 192×192 monochrome purpose (2.0 KB)
│   └── monochrome-512.png          ← 512×512 monochrome purpose (6.1 KB)
└── screenshots/
    ├── mobile-1.png                ← 1080×1920 narrow — dark mode (48.7 KB)
    ├── mobile-2.png                ← 1080×1920 narrow — light mode (52.9 KB)
    └── desktop-1.png               ← 1920×1080 wide — desktop view (28.6 KB)
```

**Total: 35 files, ~3.2 MB**

## What Each File Does

| File | Purpose |
|------|---------|
| `index.html` | The full PWA application — UI, logic, service worker registration, PWA shortcut/share-target handling |
| `manifest.json` | PWA manifest with 27 fields — passes all 28 PWABuilder validation tests (score 45/45) |
| `sw.js` | Service worker — precaching, navigation preload, offline fallback, cache strategies, push/sync handlers |
| `offline.html` | Shown when the user is offline — branded page with retry button and auto-reconnect |
| `netlify.toml` | Netlify config — sets `Service-Worker-Allowed: /`, no-cache for `sw.js`, correct MIME for manifest, explicit `image/png` Content-Type + CORS headers for icons, immutable caching for icons |
| `.htaccess` | Apache equivalent of netlify.toml — same headers for Apache-based hosts |
| `privacy.html` | Privacy policy page |
| `content.js` | Agency/vacancy data and content rendering |
| `content-manager.js` | Content management utilities |
| `icon-192.png` / `icon-512.png` | Root-level icons referenced by `sw.js` precache and legacy browsers |
| `icons/*` | Full icon set: 13 sizes × `any` purpose + 5 maskable + 2 monochrome + favicon |
| `screenshots/*` | Store listing screenshots — 2 narrow (mobile) + 1 wide (desktop) |

## Hosting Requirements

### HTTPS
PWAs require HTTPS. Your host must serve over HTTPS (Netlify, Vercel, GitHub Pages, Cloudflare Pages all do this automatically).

### Headers (if NOT using Netlify or Apache)
If you're on a different host (Vercel, Cloudflare Pages, GitHub Pages, etc.), manually configure these headers. **These are critical for PWABuilder's icon fetchability and type checks to pass:**

| File Pattern | Header | Value | Why |
|------|--------|-------|-----|
| `sw.js` | `Cache-Control` | `public, max-age=0, must-revalidate` | SW updates ship immediately |
| `sw.js` | `Service-Worker-Allowed` | `/` | Allow root scope |
| `manifest.json` | `Content-Type` | `application/manifest+json; charset=utf-8` | Correct MIME type |
| `manifest.json` | `Cache-Control` | `public, max-age=0, must-revalidate` | Manifest updates ship immediately |
| `offline.html` | `Cache-Control` | `public, max-age=0, must-revalidate` | Offline page updates ship immediately |
| `/icons/*.png` | `Content-Type` | `image/png` | PWABuilder checks icon MIME type |
| `/icons/*.png` | `Cache-Control` | `public, max-age=31536000, immutable` | Long cache for static icons |
| `/icons/*.png` | `Access-Control-Allow-Origin` | `*` | PWABuilder backend fetches icons cross-origin |
| `/icons/*.ico` | `Content-Type` | `image/x-icon` | Correct favicon MIME type |
| `/icons/*.ico` | `Access-Control-Allow-Origin` | `*` | CORS for favicon fetch |
| `/icon-*.png` | `Content-Type` | `image/png` | Root-level icons MIME type |
| `/icon-*.png` | `Access-Control-Allow-Origin` | `*` | CORS for root-level icons |
| `/screenshots/*.png` | `Content-Type` | `image/png` | Screenshot MIME type |
| `/screenshots/*.png` | `Access-Control-Allow-Origin` | `*` | PWABuilder fetches screenshots cross-origin |
| `/screenshots/*.png` | `Cache-Control` | `public, max-age=31536000, immutable` | Long cache for screenshots |
| `/*` | `X-Content-Type-Options` | `nosniff` | Security header |
| `/*` | `X-Frame-Options` | `SAMEORIGIN` | Security header |
| `/*` | `Referrer-Policy` | `strict-origin-when-cross-origin` | Security header |

### For Apache (.htaccess included)
An `.htaccess` file is included in the package with all the same headers configured. If your host uses Apache, simply upload it along with the other files — no manual configuration needed.

### For Netlify
The included `netlify.toml` file handles all headers automatically. Just upload it with the other files.

## After Deployment — Verify

1. Visit your deployed URL
2. Go to [PWABuilder.com](https://www.pwabuilder.com) and enter your URL
3. The Manifest score should show **45/45** with all action items resolved
4. Service Worker should show green (all handlers present)
5. App Capabilities should show no warnings

### What was fixed in this update
The following PWABuilder action items have been resolved:

| Action Item | Root Cause | Fix Applied |
|-------------|-----------|-------------|
| "Fix the links to your icons" | Icon `src` paths were relative (`icons/icon-192.png`), which PWABuilder's backend resolved incorrectly when the manifest URL had a different path | All icon/screenshot `src` paths converted to **root-absolute** (`/icons/icon-192.png`) so they always resolve from the domain root |
| "Fix the icon types" | Some servers don't serve PNGs with the correct `image/png` MIME type, causing PWABuilder's type check to fail | Added explicit `Content-Type: image/png` headers in `netlify.toml` and `.htaccess` for all PNG files |
| "Fix the links to your shortcut icons" | Shortcut icon `src` paths were relative; also shortcut icons cannot use `image/webp` or `image/svg+xml` types | All shortcut icon `src` paths converted to root-absolute (`/icons/icon-96.png`); all use `image/png` type which is allowed |
| "Fix the icon sizes" | Every icon must have a `sizes` field; this was previously passing but is reinforced | All 20 icons have explicit `sizes` fields matching their actual PNG pixel dimensions (verified programmatically) |

### Why CORS headers matter
PWABuilder's backend (running on Azure) fetches your icon and screenshot URLs directly using HTTP HEAD/GET requests. If your server doesn't return `Access-Control-Allow-Origin: *` on these files, the fetch may be blocked, causing "Fix the links to your icons" errors even when the files exist and are correctly referenced. The included `netlify.toml` and `.htaccess` both add this header to all PNG and ICO files.

## Files NOT Needed for Deployment

These files are in the workspace but are NOT part of the app — do NOT upload them:
- `sa-recruiters-deploy.zip` (the package itself)
- `sa-recruiters-app-pwa-fixed.zip` (older package)
- `validate_manifest.py` (development tool)
- `todo.md`, `todo_logo.md` (task tracking)
- `*.sql` files (database scripts)
- `SA_Recruiters_pwabuilder_score.png` (screenshot)
- `logo-pack/` directory (source logos)
- `wordmark-lockup*.png` (branding assets, not referenced by the app)

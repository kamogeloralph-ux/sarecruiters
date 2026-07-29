# SA Recruiters

A free, community-maintained directory of South African recruitment agencies. Built as a PWA (installable, works offline) and deployed via Netlify.

## Structure
- `index.html` — the app itself
- `manifest.json` — PWA manifest (icons, theme colors, install behavior)
- `sw.js` — service worker for offline caching
- `privacy.html` — privacy policy page (linked from Play Store listing)
- `icon-192.png` / `icon-512.png` — app icons

## Deployment
This repo is connected to Netlify for continuous deployment — every push to `main` triggers a new build automatically. No build command is needed; `netlify.toml` publishes the repo root directly.

## Backend
Data (agencies, admin auth) is powered by Supabase — see the Supabase project dashboard for schema and RLS policies.

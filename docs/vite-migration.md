# App JS: classic scripts -> ES modules (Vite)

## What changed
- `app-*.js` (11 files) are ES modules. Each one imports what it uses from the others and exports its top-level declarations.
- `app-entry.js` is the entry. `scripts/bundle-app.js` builds it with Vite (`vite.config.mjs`) into `app.bundle.min.js`
  and rewrites the hashed `<script type="module">` tag in `index.html`. `generate-pages.js` still calls it first, so the
  Cloudflare build command is unchanged (`npm install && node generate-pages.js`).
- If Vite is missing or fails, the same entry is bundled with esbuild instead (force with `SA_BUNDLER=esbuild`, make a
  Vite failure fatal with `SA_BUNDLER=vite`).
- Identifiers are now minified (they were not before). Anything called by name from HTML or the classic scripts is
  exposed by the `window bridge` block at the bottom of each module; `verify-critical-globals.js` checks those keys in
  the built output.

## Rules for editing
1. New app file: create it, import it in `app-entry.js`, add it to `FILES` in `scripts/bundle-app.js`.
2. Using something from another module: `import { name } from './app-x.js'`. The bundler fails on a missing export.
3. Shared mutable state (`var`/`let` in another module) is read through the import. To write it, call `set_<name>(value)`
   (exported by the owner module). Imports are read-only.
4. A new function used from an inline `onclick="..."`: it is exported on `window` automatically by the bridge block
   (add it to that block by hand if you add it to an existing file).
5. `vacancyCard` and `renderAllVacanciesList` are replaced at runtime by `app-vacancy-v2.js` (`window.X = ...`), so
   module code calls them as `window.vacancyCard(...)` / `window.renderAllVacanciesList()`. Keep it that way.

## Dev
`npm run dev` serves the repo with Vite and loads `app-entry.js` unbundled (source maps, no build step).

## Cleanup this makes possible (not done yet)
- Replace inline `onclick="fn()"` with `addEventListener`, then shrink the window bridges.
- Move the shared `var` state in `app-core.js` into a `state` module and delete the `set_*` setters.
- Split rarely used screens (manager, community, forms) into dynamic `import()` chunks and drop `inlineDynamicImports`.

// ============================================================
//  SA RECRUITERS — vite.config.mjs
// ============================================================
//  Production: `node scripts/bundle-app.js` (also run first thing by
//  generate-pages.js) calls `vite build` with this config. It bundles
//  the ES-module graph rooted at app-entry.js into
//  build-tmp/app.bundle.min.js; bundle-app.js then verifies it, copies
//  it to the repo root, and rewrites the hashed <script type="module">
//  tag in index.html. Vite only builds the app JS: index.html and the
//  static pages are still produced by generate-pages.js, so SEO output
//  is unchanged.
//
//  Development: `npm run dev` serves the repo root with Vite and swaps
//  the built bundle tag for the unbundled app-entry.js, so you get
//  per-file source maps and instant reloads while editing app-*.js.
// ============================================================
import { defineConfig } from 'vite';

// Dev only: point the page at the source entry instead of the built bundle.
function devEntry() {
  return {
    name: 'sa-recruiters-dev-entry',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /<script type="module" src="app\.bundle\.min\.js\?v=[^"]*"><\/script>/,
        '<script type="module" src="/app-entry.js"></script>'
      );
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: false, // the repo root already is the static site
  plugins: [devEntry()],
  build: {
    outDir: 'build-tmp',
    emptyOutDir: true,
    copyPublicDir: false,
    target: 'es2018',
    minify: 'esbuild',
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: 'app-entry.js',
      output: {
        format: 'es',
        entryFileNames: 'app.bundle.min.js',
        inlineDynamicImports: true, // one file for now; drop this to enable route-level code splitting later
      },
    },
  },
});

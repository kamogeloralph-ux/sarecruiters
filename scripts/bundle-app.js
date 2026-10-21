// ============================================================
//  SA RECRUITERS — scripts/bundle-app.js
// ============================================================
//  Builds the app bundle from the ES-module graph rooted at
//  app-entry.js (app-core, app-data, app-cards, app-forms,
//  app-sheets, app-ui, app-manager, app-manager-employer,
//  app-pending-submissions, app-community, app-install) into one
//  minified app.bundle.min.js, then rewrites index.html's script
//  tag to point at it with a content-hash query string for
//  cache-busting.
//
//  Bundler: Vite (vite.config.mjs). If Vite is not installed or its
//  build fails, falls back to a plain esbuild bundle of the same
//  entry so a tooling problem never blocks a deploy (set
//  SA_BUNDLER=esbuild to force the fallback, SA_BUNDLER=vite to
//  make a Vite failure fatal).
//
//  Called from generate-pages.js at the start of every build, so
//  it runs automatically on every Cloudflare Pages deploy (both
//  git-push builds and the cron-triggered rebuilds) without
//  needing a separate build command.
//
//  Unlike the old concatenated bundle, identifiers ARE minified
//  now: every name that index.html's inline onclick="..." handlers
//  or the classic scripts need is exported on window by the bridge
//  block at the bottom of each app-*.js file, as an object key that
//  survives minification. verify-critical-globals.js checks those
//  keys in the built output.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { verifyCriticalGlobals } = require('./verify-critical-globals');

const ENTRY = 'app-entry.js';
// Every module the entry must import (order matches app-entry.js).
const FILES = [
  'app-core.js',
  'app-data.js',
  'app-cards.js',
  'app-forms.js',
  'app-sheets.js',
  'app-ui.js',
  'app-manager.js',
  'app-manager-employer.js',
  'app-pending-submissions.js',
  'app-community.js',
  'app-install.js',
];

const BUNDLE_NAME = 'app.bundle.min.js';
const VITE_OUT_DIR = 'build-tmp';
// Matches the old classic tag and the new module tag:
//   <script src="app.bundle.min.js?v=ANYTHING" defer></script>
//   <script type="module" src="app.bundle.min.js?v=ANYTHING"></script>
const SCRIPT_TAG_RE = /<script (?:type="module" )?src="app\.bundle\.min\.js\?v=[^"]*"(?: defer)?><\/script>/;

function checkEntryImportsEveryModule(rootDir) {
  const entry = fs.readFileSync(path.join(rootDir, ENTRY), 'utf8');
  const missing = FILES.filter((f) => !entry.includes("'./" + f + "'"));
  if (missing.length) {
    throw new Error('[bundle-app] ' + ENTRY + ' does not import: ' + missing.join(', ') + '. Every app module must be imported by the entry or it will silently be left out of the bundle.');
  }
}

function resolveViteBin(rootDir) {
  try {
    const pkg = require.resolve('vite/package.json', { paths: [rootDir] });
    const bin = path.join(path.dirname(pkg), 'bin', 'vite.js');
    return fs.existsSync(bin) ? bin : null;
  } catch (e) {
    return null;
  }
}

function buildWithVite(rootDir, viteBin) {
  const outFile = path.join(rootDir, VITE_OUT_DIR, BUNDLE_NAME);
  fs.rmSync(path.join(rootDir, VITE_OUT_DIR), { recursive: true, force: true });
  execFileSync(process.execPath, [viteBin, 'build', '--config', 'vite.config.mjs', '--logLevel', 'warn'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (!fs.existsSync(outFile)) {
    throw new Error('vite build finished but ' + VITE_OUT_DIR + '/' + BUNDLE_NAME + ' was not produced (check build.rollupOptions.output.entryFileNames in vite.config.mjs).');
  }
  return fs.readFileSync(outFile, 'utf8');
}

function buildWithEsbuild(rootDir) {
  const esbuild = require('esbuild');
  const result = esbuild.buildSync({
    entryPoints: [path.join(rootDir, ENTRY)],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2018',
    write: false,
    logLevel: 'error',
  });
  return result.outputFiles[0].text;
}

function buildBundleSource(rootDir) {
  const forced = process.env.SA_BUNDLER;
  if (forced !== 'esbuild') {
    const viteBin = resolveViteBin(rootDir);
    if (viteBin) {
      try {
        return { code: buildWithVite(rootDir, viteBin), bundler: 'vite' };
      } catch (err) {
        if (forced === 'vite') throw err;
        console.warn('[bundle-app] vite build failed, falling back to esbuild:', err && err.message ? err.message : err);
      }
    } else if (forced === 'vite') {
      throw new Error('[bundle-app] SA_BUNDLER=vite but vite is not installed. Run "npm ci" (vite is a devDependency).');
    } else {
      console.warn('[bundle-app] vite is not installed, falling back to esbuild. Run "npm ci" to build with Vite.');
    }
  }
  return { code: buildWithEsbuild(rootDir), bundler: 'esbuild' };
}

function runBundle(rootDir) {
  checkEntryImportsEveryModule(rootDir);

  const { code: output, bundler } = buildBundleSource(rootDir);

  // Hard safety net: abort the whole build if the result would break a
  // function referenced by name from static HTML, break the manager-link
  // business flow specifically, or if the manage_token column has been
  // dropped from the agency/employer queries. See verify-critical-globals.js.
  verifyCriticalGlobals(rootDir, output);

  const outPath = path.join(rootDir, BUNDLE_NAME);
  fs.writeFileSync(outPath, output);

  const hash = crypto.createHash('sha1').update(output).digest('hex').slice(0, 10);

  const indexPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!SCRIPT_TAG_RE.test(html)) {
    throw new Error(
      `[bundle-app] Could not find the app.bundle.min.js script tag in index.html. ` +
      `Expected a tag like <script type="module" src="app.bundle.min.js?v=..."></script>.`
    );
  }
  const newHtml = html.replace(
    SCRIPT_TAG_RE,
    `<script type="module" src="${BUNDLE_NAME}?v=${hash}"></script>`
  );
  fs.writeFileSync(indexPath, newHtml);

  const rawBytes = FILES.reduce((n, f) => n + fs.statSync(path.join(rootDir, f)).size, 0);
  const outBytes = output.length;
  console.log(
    `[bundle-app] Bundled ${FILES.length} modules via ${bundler} (${(rawBytes / 1024).toFixed(1)}KB source) ` +
    `into ${BUNDLE_NAME} (${(outBytes / 1024).toFixed(1)}KB, minified) [v=${hash}]`
  );

  return { outPath, hash, bundler, rawBytes, outBytes };
}

// ---- Self-hosted Supabase client (replaces the unpkg.com <script>) ----
const VENDOR_REL = 'vendor/supabase.min.js';
const VENDOR_TAG_RE = /<script src="vendor\/supabase\.min\.js\?v=[^"]*" defer><\/script>/;

function buildSupabaseVendor(rootDir) {
  const outFile = path.join(rootDir, VENDOR_REL);
  try {
    const esbuild = require('esbuild');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    esbuild.buildSync({
      entryPoints: [path.join(__dirname, 'supabase-entry.js')],
      bundle: true,
      minify: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2018',
      legalComments: 'none',
      outfile: outFile,
      absWorkingDir: rootDir,
      logLevel: 'error',
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (!fs.existsSync(outFile)) {
      // Never ship an index.html that points at a file that does not exist: without it there is no
      // Supabase client (sign-in and every write break). Fail the build loudly instead.
      throw new Error('[bundle-app] Could not build ' + VENDOR_REL + ' (' + msg + '). esbuild must be listed in devDependencies in package.json and installed with "npm ci" (do not use --omit=dev / NODE_ENV=production for this build step).');
    }
    console.warn('[bundle-app] Supabase vendor rebuild failed, keeping the existing ' + VENDOR_REL + ':', msg);
  }
  const bytes = fs.readFileSync(outFile);
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 10);
  const indexPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!VENDOR_TAG_RE.test(html)) {
    throw new Error('[bundle-app] Could not find the vendor/supabase.min.js script tag in index.html.');
  }
  fs.writeFileSync(indexPath, html.replace(VENDOR_TAG_RE, '<script src="' + VENDOR_REL + '?v=' + hash + '" defer></script>'));
  console.log('[bundle-app] Built ' + VENDOR_REL + ' (' + (bytes.length / 1024).toFixed(1) + 'KB) [v=' + hash + ']');
  return { outFile, hash, bytes: bytes.length };
}

module.exports = { runBundle, buildSupabaseVendor, FILES, BUNDLE_NAME };

// Allow running directly: node scripts/bundle-app.js
if (require.main === module) {
  const root = path.join(__dirname, '..');
  runBundle(root);
  buildSupabaseVendor(root);
}

// ============================================================
//  SA RECRUITERS — scripts/bundle-app.js
// ============================================================
//  Concatenates the 8 split app-*.js files (app-core, app-data,
//  app-cards, app-forms, app-sheets, app-ui, app-manager,
//  app-manager-employer) into a single minified bundle, and
//  rewrites index.html's script tag to point at it with a
//  content-hash query string for cache-busting.
//
//  Called from generate-pages.js at the start of every build, so
//  it runs automatically on every Cloudflare Pages deploy (both
//  git-push builds and the cron-triggered rebuilds) without
//  needing a separate build command.
//
//  If esbuild is unavailable for any reason, falls back to an
//  unminified concatenation rather than failing the whole build —
//  a slower bundle is far better than no deploy at all.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyCriticalGlobals } = require('./verify-critical-globals');

const FILES = [
  'app-core.js',
  'app-data.js',
  'app-cards.js',
  'app-forms.js',
  'app-sheets.js',
  'app-ui.js',
  'app-manager.js',
  'app-manager-employer.js',
];

const BUNDLE_NAME = 'app.bundle.min.js';
// Matches: <script src="app.bundle.min.js?v=ANYTHING" defer></script>
const SCRIPT_TAG_RE = /<script src="app\.bundle\.min\.js\?v=[^"]*" defer><\/script>/;

function concatenateSource(rootDir) {
  return FILES.map((f) => {
    const filePath = path.join(rootDir, f);
    const code = fs.readFileSync(filePath, 'utf8');
    return `/* ---- ${f} ---- */\n${code}`;
  }).join('\n;\n');
}

function minify(code) {
  // Lazily require esbuild so a missing/broken install degrades
  // gracefully instead of crashing the entire site build.
  const esbuild = require('esbuild');
  // IMPORTANT: minifyIdentifiers is deliberately OFF. This bundle is a
  // concatenation of classic (non-module) scripts that declare top-level
  // functions/vars referenced by NAME from static onclick="..."/oninput="..."
  // attributes in index.html (e.g. onclick="retryManagerTokenFromStatus()",
  // managerAddBranch(), etc. — 50+ of these). esbuild's identifier minifier
  // has no way to see those HTML-string references, so with it on it
  // silently renames the functions those attributes call, breaking them at
  // runtime with no error surfaced anywhere obvious. Whitespace + syntax
  // minification are both safe (they don't touch top-level names) and still
  // give most of the size win.
  const result = esbuild.transformSync(code, {
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    target: 'es2018',
    loader: 'js',
  });
  return result.code;
}

function runBundle(rootDir) {
  const concatenated = concatenateSource(rootDir);

  let output;
  let minified = true;
  try {
    output = minify(concatenated);
  } catch (err) {
    console.warn(
      '[bundle-app] esbuild minification failed, falling back to unminified bundle:',
      err && err.message ? err.message : err
    );
    output = concatenated;
    minified = false;
  }

  // Hard safety net: abort the whole build (not just skip minification)
  // if the result would break a function referenced by name from static
  // HTML, break the manager-link business flow specifically, or if the
  // manage_token column has been dropped from the agency/employer
  // queries. See verify-critical-globals.js for why this exists.
  verifyCriticalGlobals(rootDir, output);

  const outPath = path.join(rootDir, BUNDLE_NAME);
  fs.writeFileSync(outPath, output);

  const hash = crypto.createHash('sha1').update(output).digest('hex').slice(0, 10);

  const indexPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!SCRIPT_TAG_RE.test(html)) {
    throw new Error(
      `[bundle-app] Could not find the app.bundle.min.js script tag in index.html. ` +
      `Expected a tag like <script src="app.bundle.min.js?v=..." defer></script>.`
    );
  }
  const newHtml = html.replace(
    SCRIPT_TAG_RE,
    `<script src="${BUNDLE_NAME}?v=${hash}" defer></script>`
  );
  fs.writeFileSync(indexPath, newHtml);

  const rawBytes = concatenated.length;
  const outBytes = output.length;
  console.log(
    `[bundle-app] Bundled ${FILES.length} files (${(rawBytes / 1024).toFixed(1)}KB raw) ` +
    `into ${BUNDLE_NAME} (${(outBytes / 1024).toFixed(1)}KB${minified ? ', minified' : ', NOT minified — esbuild unavailable'}) ` +
    `[v=${hash}]`
  );

  return { outPath, hash, minified, rawBytes, outBytes };
}

module.exports = { runBundle, FILES, BUNDLE_NAME };

// Allow running directly: node scripts/bundle-app.js
if (require.main === module) {
  runBundle(path.join(__dirname, '..'));
}

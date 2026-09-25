// ============================================================
//  SA RECRUITERS — scripts/verify-critical-globals.js
// ============================================================
//  Guards against a whole class of "silent breakage" bugs:
//
//  1. index.html has ~60 static onclick="fn()" / oninput="fn()" /
//     onchange="fn()" attributes that call global functions by
//     NAME. Nothing connects them to the JS at build time — if a
//     future change (re-enabling identifier minification, a typo
//     during a refactor, deleting a function that still has a
//     caller) removes one of those names from the bundle, the
//     button just silently does nothing at runtime. No error
//     anywhere. This is exactly what broke the manager-link
//     buttons on 2026-09-16.
//
//  2. Manager/employer-manager links depend on `manage_token`
//     being selected from Supabase in getAgencies()/getEmployers().
//     It's easy to "clean up" a select() column list without
//     realizing this one is load-bearing for the whole manager-link
//     business flow.
//
//  Both are checked here, AFTER bundling, BEFORE anything is
//  written to disk. If either check fails, this throws — which
//  bundle-app.js lets propagate up through generate-pages.js,
//  which is a hard, uncaught error, so the whole Cloudflare Pages
//  build fails and nothing gets deployed. The previous good
//  deployment stays live. A broken build should never silently
//  become the new production site.
// ============================================================

const fs = require('fs');
const path = require('path');

// Explicit safety net for the manager-link business flow specifically —
// checked by name even if index.html's onclick list changes, since some
// of these (agencyIdFromToken, fastResolveManagerToken, ...) are called
// from JS-to-JS, not from onclick attributes, so the HTML-scan alone
// wouldn't catch a break in them.
const CRITICAL_MANAGER_FUNCTIONS = [
  'agencyIdFromToken',
  'employerIdFromToken',
  'getManagerToken',
  'setManagerToken',
  'getEmployerManagerToken',
  'setEmployerManagerToken',
  'enterManagerMode',
  'exitManagerMode',
  'enterEmployerManagerMode',
  'fastResolveManagerToken',
  'retryManagerTokenFromStatus',
  'buildManagerLink',
  'buildEmployerManagerLink',
  'verifyManagerTokenServer',
  'openManagerScreen',
  'openEmployerManagerScreen',
  'workerManagerAddBranch',
  'workerManagerAddVacancy',
  'workerManagerEmployerAddVacancy',
];

function extractOnAttrCalledNames(html) {
  // Matches on<word>="...contents..." for any inline event handler
  // attribute (onclick, oninput, onchange, onended, etc.), single or
  // double quoted.
  const attrRe = /\bon[a-z]+\s*=\s*"([^"]*)"|\bon[a-z]+\s*=\s*'([^']*)'/g;
  // Within an attribute's contents, a bare function call: an identifier
  // immediately followed by "(" that is NOT preceded by "." (so
  // this.closest(...) doesn't count — that's a method call, not a
  // reference to one of our globals).
  const callRe = /(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  const names = new Set();
  let m;
  while ((m = attrRe.exec(html))) {
    const contents = m[1] !== undefined ? m[1] : m[2];
    let c;
    callRe.lastIndex = 0;
    while ((c = callRe.exec(contents))) {
      names.add(c[1]);
    }
  }
  return Array.from(names);
}

function isDeclaredInBundle(name, bundleCode) {
  const re = new RegExp(
    '\\bfunction\\s+' + name + '\\s*\\(' +
    '|\\b(?:var|let|const)\\s+' + name + '\\s*=' +
    '|\\bwindow\\.' + name + '\\s*='
  );
  return re.test(bundleCode);
}

function verifyManageTokenSelected(rootDir) {
  const dataSrc = fs.readFileSync(path.join(rootDir, 'app-data.js'), 'utf8');
  const problems = [];
  // SECURITY INVARIANT (since the 2026-09 token lockdown):
  // getAgencies()/getEmployers() must NOT select `manage_token`. The column is
  // revoked from the anon role in
  // supabase/migrations/20260918_lock_down_manager_tokens.sql, and public data
  // must never carry manager-link tokens — they are verified server-side via
  // the Worker's /api/verify-manager endpoints instead. Re-adding it here
  // would either fail every agencies/employers query (column revoked) or, if
  // the grant was ever re-added, leak every Smart Manager link publicly.
  const agenciesSelect = dataSrc.match(/function\s+getAgencies[\s\S]{0,400}?\.select\('([^']*)'\)/);
  if (!agenciesSelect || /manage_token/.test(agenciesSelect[1])) {
    problems.push(
      "getAgencies()'s Supabase .select(...) must NOT include 'manage_token'. " +
      "Tokens are resolved server-side via /api/verify-manager (see app-manager.js); " +
      "selecting the column would break every agencies query under the lockdown " +
      "migration or leak every manager link if the grant was re-added."
    );
  }
  const employersSelect = dataSrc.match(/function\s+getEmployers[\s\S]{0,400}?\.select\('([^']*)'\)/);
  if (!employersSelect || /manage_token/.test(employersSelect[1])) {
    problems.push(
      "getEmployers()'s Supabase .select(...) must NOT include 'manage_token'. " +
      "Tokens are resolved server-side via /api/verify-employer-manager (see app-manager.js)."
    );
  }
  return problems;
}

// ============================================================
//  State-safe refresh pipeline invariants (2026-09-25)
// ============================================================
//  The cross-screen render contamination was not one bug but four missing
//  properties: no refresh epoch, no screen scoping, no transient-state reset,
//  and no startup-memo invalidation. Each is invisible in a diff and each can
//  be undone by an ordinary-looking refactor, so they are asserted here and the
//  build fails if any of them goes missing. See docs/REFRESH_STATE_TRACE.md.
const REFRESH_PIPELINE_FILE = 'scripts/app-refresh.js';
const REFRESH_BRIDGE_FILE = 'app-refresh-bundle.js';
// Transient containers that must only ever be painted while their own screen is
// visible. Kept in sync with TRANSIENT_CONTAINERS in scripts/app-refresh.js.
const OWNED_CONTAINER_CHECKS = [
  ['app-ui.js', 'allvacancies-list', /saShouldRenderContainer\('allvacancies-list'\)/],
  ['app-cards.js', 'poster-feed', /saShouldRenderContainer\('poster-feed'\)/],
  ['app-sheets.js', 'pool-list', /saShouldRenderContainer\('pool-list'\)/],
  ['app-cards.js', 'saved-list', /saShouldRenderContainer\('saved-list'\)/],
  ['app-cards.js', 'allemployers-list', /saShouldRenderContainer\('allemployers-list'\)/],
  ['app-ui.js', 'allagencies-list', /saShouldRenderContainer\('allagencies-list'\)/],
  ['app-ui.js', 'allbranches-list', /saShouldRenderContainer\('allbranches-list'\)/],
];
function verifyRefreshPipeline(rootDir, bundleCode) {
  const problems = [];
  const read = (rel) => {
    const p = path.join(rootDir, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };

  // 1. The pipeline module must exist, must NOT be bundled (bundling it would
  //    execute it twice and double-register every listener), and must actually
  //    be loaded by index.html.
  const pipeline = read(REFRESH_PIPELINE_FILE);
  if (!pipeline) {
    problems.push(
      `${REFRESH_PIPELINE_FILE} is missing. It is the single authority for when a ` +
      `data hydration may paint and which screen it may paint; without it the ` +
      `cross-screen render contamination returns.`
    );
  }
  const bridge = read(REFRESH_BRIDGE_FILE);
  if (!bridge) {
    problems.push(
      `${REFRESH_BRIDGE_FILE} is missing. The bundle's guarded call sites resolve ` +
      `the refresh-epoch primitives from it.`
    );
  }
  if (bundleCode && /\bpayloadDataAsOf\b/.test(bundleCode)) {
    problems.push(
      `${REFRESH_PIPELINE_FILE} appears to be bundled into app.bundle.min.js as well ` +
      `as loaded as its own script, which would execute the pipeline twice and ` +
      `register duplicate visibilitychange/pageshow/online listeners.`
    );
  }
  const html = read('index.html') || '';
  if (!/<script src="scripts\/app-refresh\.js"[^>]*defer[^>]*><\/script>/.test(html)) {
    problems.push(
      `index.html must load scripts/app-refresh.js as its own deferred script AFTER ` +
      `app.bundle.min.js (deferred scripts run in document order, and the pipeline ` +
      `needs the bundle's loadAll/render definitions to already exist).`
    );
  }
  if (pipeline) {
    const bundleTag = html.indexOf('app.bundle.min.js');
    const pipelineTag = html.indexOf('scripts/app-refresh.js');
    if (bundleTag !== -1 && pipelineTag !== -1 && pipelineTag < bundleTag) {
      problems.push(
        `index.html loads scripts/app-refresh.js BEFORE app.bundle.min.js. ` +
        `Document order is execution order for deferred scripts, so the pipeline ` +
        `would evaluate before the functions it drives exist.`
      );
    }
  }

  // 2. The service worker must precache the pipeline so a client saddled with a
  //    pre-fix bundle still receives it on the next shell install.
  const sw = read('sw.js') || '';
  if (!/['"]\.\/scripts\/app-refresh\.js['"]/.test(sw)) {
    problems.push(
      `sw.js must precache './scripts/app-refresh.js' in CORE_ASSETS. That is what ` +
      `delivers the refresh pipeline to a client whose cached bundle is still the ` +
      `pre-fix generation.`
    );
  }

  // 3. The pipeline must be unversioned: generate-pages.js appends ?v=<hash> to
  //    its STATIC_ASSETS list, and a versioned URL could not be precached by the
  //    service worker under the bare path above.
  const gen = read('generate-pages.js') || '';
  const staticAssets = gen.match(/const STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (staticAssets && /app-refresh/.test(staticAssets[1])) {
    problems.push(
      `generate-pages.js must NOT list app-refresh in STATIC_ASSETS: the ?v= rewrite ` +
      `would change the URL that sw.js precaches.`
    );
  }

  // 4. Hydration must be epoch-guarded and must repaint the live screen instead
  //    of the boot-time remembered one.
  const data = read('app-data.js') || '';
  if (!/async function loadAll\(refreshToken\)/.test(data)) {
    problems.push(
      `loadAll() must keep its refresh-epoch parameter; losing it removes the ` +
      `newest-generation-wins guard that keeps concurrent hydrations from ` +
      `committing into the same screen.`
    );
  }
  if (!/saIsCurrentRefresh\(refreshToken\)/.test(data)) {
    problems.push(
      `loadAll() must still use saIsCurrentRefresh(refreshToken) as its write gate.`
    );
  }
  const standaloneRestoredRepaint = new RegExp(
    '(?<!else )\\bif \\(typeof renderRestoredScreenContent === \'function\'\\) renderRestoredScreenContent\\(\\);'
  );
  if (standaloneRestoredRepaint.test(data)) {
    problems.push(
      `loadAll() must not repaint via renderRestoredScreenContent() alone: that ` +
      `renders the screen remembered at boot, not the visible one, which is the ` +
      `cross-screen repaint. Use saRenderActiveScreen().`
    );
  }
  if (!/saRenderActiveScreen/.test(data)) {
    problems.push(
      `app-data.js must call saRenderActiveScreen() at hydration time so renders ` +
      `follow the visible screen.`
    );
  }

  // 5. Transient containers must stay ownership-guarded.
  for (const [file, container, re] of OWNED_CONTAINER_CHECKS) {
    const src = read(file);
    if (src && !re.test(src)) {
      problems.push(
        `${file} must guard writes to "${container}" with saShouldRenderContainer(). ` +
        `Without it a hydration running while the user is on another screen can ` +
        `still paint that container.`
      );
    }
  }

  // 6. Refresh entry points must run through the pipeline rather than starting a
  //    bare, unguarded hydration.
  const ui = read('app-ui.js') || '';
  if (!/saRefreshAll\('home-button'\)/.test(ui)) {
    problems.push(`refreshHome() must refresh through saRefreshAll('home-button').`);
  }
  if (!/saShowScreen\('home'\)/.test(ui)) {
    problems.push(
      `refreshHome() must switch screens with saShowScreen('home'). Adding .active ` +
      `without clearing the current screen leaves two screens display:flex at ` +
      `once, which renders them on top of each other.`
    );
  }
  if (!/saRefreshAll\('retry-banner'\)/.test(ui)) {
    problems.push(`retryLoadAll() must refresh through saRefreshAll('retry-banner').`);
  }
  const bridgeSrc = read('app-manager-employer.js') || '';
  if (/initIdleResumeRefresh/.test(bridgeSrc)) {
    problems.push(
      `The idle-resume listeners must live in ${REFRESH_PIPELINE_FILE} only; a second ` +
      `copy in app-manager-employer.js can start a duplicate hydration for one ` +
      `wake-up.`
    );
  }
  if (/window\.addEventListener\('online'/.test(data)) {
    problems.push(
      `app-data.js must not also register an 'online' refresh listener: ` +
      `${REFRESH_PIPELINE_FILE} owns network recovery so it runs under the refresh epoch.`
    );
  }
  return problems;
}

function verifyCriticalGlobals(rootDir, bundleCode) {
  const problems = [];

  // 0. State-safe refresh pipeline invariants. These encode the fix for the
  //    cross-screen render contamination, because every one of them is a
  //    property that was silently absent before and would be silently absent
  //    again after an innocent-looking refactor. See
  //    docs/REFRESH_STATE_TRACE.md for the full trace.
  problems.push(...verifyRefreshPipeline(rootDir, bundleCode));

  // index.html also loads content.js and content-manager.js separately
  // (outside the 8-file bundle) — some onclick handlers call functions
  // declared there, not in the bundle. Include them in the "does this
  // name exist anywhere on the page" check so those aren't false
  // positives, while still catching a genuine break in either file.
  let extraScripts = '';
  for (const f of ['content.js', 'content-manager.js']) {
    const p = path.join(rootDir, f);
    if (fs.existsSync(p)) extraScripts += '\n' + fs.readFileSync(p, 'utf8');
  }
  const fullPageCode = bundleCode + extraScripts;

  // 1. Everything index.html's inline handlers call by name.
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const referencedNames = extractOnAttrCalledNames(indexHtml);
  for (const name of referencedNames) {
    if (!isDeclaredInBundle(name, fullPageCode)) {
      problems.push(
        `index.html calls "${name}(...)" from an inline event handler, but ` +
        `"${name}" is not declared anywhere in the built JS bundle or ` +
        `content.js/content-manager.js. That button will silently do nothing ` +
        `when clicked.`
      );
    }
  }

  // 2. Explicit manager-link business-critical functions (covers JS-to-JS
  //    calls that the HTML scan above wouldn't catch).
  for (const name of CRITICAL_MANAGER_FUNCTIONS) {
    if (!isDeclaredInBundle(name, fullPageCode)) {
      problems.push(
        `Manager-link critical function "${name}" is missing from the built ` +
        `bundle. This will break agency/employer manager links.`
      );
    }
  }

  // 3. The manage_token column itself (public reads) + the server-side
  //    verification helper (checked against the actual bundle output).
  problems.push(...verifyManageTokenSelected(rootDir));
  if (!isDeclaredInBundle('verifyManagerTokenServer', bundleCode)) {
    problems.push(
      "verifyManagerTokenServer() is missing from the built bundle. " +
      "Manager links resolve through it (Worker /api/verify-manager); without it " +
      "no manager link can open."
    );
  }

  if (problems.length) {
    throw new Error(
      '\n\n[verify-critical-globals] BUILD ABORTED — ' + problems.length +
      ' issue(s) would break live functionality if deployed:\n\n' +
      problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n') +
      '\n\nFix the underlying change, or if this check is wrong about a specific ' +
      'name, update scripts/verify-critical-globals.js. Do not remove this check ' +
      'to unblock a deploy — it exists because this exact failure mode has ' +
      'happened before.\n'
    );
  }
}

module.exports = { verifyCriticalGlobals, extractOnAttrCalledNames, CRITICAL_MANAGER_FUNCTIONS };

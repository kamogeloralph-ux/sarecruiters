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

function verifyCriticalGlobals(rootDir, bundleCode) {
  const problems = [];

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

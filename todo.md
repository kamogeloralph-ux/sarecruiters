# Fix: Token link redirects & offline fallback on idle/refresh

## Investigation
- [x] Examine project structure & key files (sw.js, app.js, index.html, offline.html, manifest.json)
- [x] Understand token link flow (?manage=TOKEN, ?manage_employer=TOKEN)
- [x] Understand idle/refresh -> offline.html fallback flow
- [x] Reproduce Issue 1 in browser: ?manage=TOKEN -> managerPendingToken set, but managerMode stays false, agenciesCache=0 (data load fails) -> home screen shown
- [x] Reproduce Issue 2 analysis: SW cache-first shell; offline.html served when shell missing (partial install) or on flaky network w/o shell

## Root cause analysis
### Issue 1: Token links redirect back to app instead of opening manager section
- Root cause: enterManagerMode/enterEmployerManagerMode give up after 3 retries when data fails to load
  (agenciesCache.length===0), and even when data loads, token won't match if Supabase manage_token
  is empty and localStorage mapping absent (different device). Result: home screen = "back to app".

### Issue 2: Idle / pull-to-refresh falls back to offline page
- Root cause: SW navigation is cache-first but ONLY when the core shell is actually cached. If the
  atomic cache.addAll install failed/partial, no shell exists, so reload -> network -> flaky ->
  offline.html. Also staleWhileRevalidate for same-origin assets has no offline fallback, and the
  shell key matching for '/index.html?query' can miss.

## Fixes
- [x] Fix 1: Make token links robustly enter manager mode — keep retrying until data loads (with
      longer/indefinite-but-bounded retries), and when data loads but token doesn't match, show a
      clear dedicated invalid-link screen instead of silently dumping to home.
- [x] Fix 2: Make SW bulletproof for reloads — network-first-with-cache-fallback for navigations so
      refresh gets fresh content when online and cached shell when offline; never serve offline.html
      when a shell is cached; resilient (non-atomic) precache; robust shell matching incl. query strings.
- [x] Bump SW version (v132 -> v133) & verify logic
- [x] Verify both fixes in browser:
      - Issue 1: ?manage=TOKEN -> manager status screen (loading) -> agency manager section (valid token) /
        invalid-link screen (bad token); ?manage_employer=TOKEN -> employer manager section. No more home-screen redirect.
      - Issue 2: true-offline reload (server stopped) -> full cached app shell with directory data, NOT offline.html.
      - No regression on normal home page; back-to-directory restores nav.

## Verification & delivery
- [x] Static review & syntax check (app.js, sw.js OK; new HTML elements present, no console errors)
- [ ] Package fixed project as zip for delivery

## Verification & delivery
- [ ] Static review of changes
- [ ] Package fixed project as zip for delivery

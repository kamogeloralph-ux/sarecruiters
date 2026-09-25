# Cross-screen render contamination: trace and root cause

**Status:** investigation complete, fix implemented in the same change set.
**Scope traced:** screen state, pull-to-refresh, idle wake-up, data hydration.

## 1. The four entry points

| Path | Entry point | What it does |
|---|---|---|
| Screen state | `restoreActiveScreenBeforeReveal()` (`app-ui.js:59`), `persistActiveScreen()` via a `MutationObserver` on `.screen` class changes (`app-ui.js:79`) | Remembers one screen name in `sessionStorage` and sets `window.__saRestoredScreen` exactly once, at script-eval time. |
| Pull-to-refresh | `refreshHome()` (`app-ui.js:183`), bound to the bottom-nav Home button (`index.html:735`) | Adds `active` to `#screen-home`, toasts, and calls `loadAll()` without resetting any screen or folder state. |
| Idle wake-up | `initIdleResumeRefresh()` (`app-manager-employer.js:260`) — `visibilitychange` after >2 min hidden, `pageshow` with `persisted`, plus `online` in `initConnectionStatus()` (`app-data.js:902`) | Calls `loadAll()` a further time, concurrently with any refresh already running. |
| Data hydration | `loadDataCache()` + `loadAll()` (`app-data.js:928`, `app-data.js:1004`) | Two independent writers of the same globals: the IndexedDB cache restore and the network hydration. |

## 2. What actually breaks

### 2.1 Hydration repaints a remembered screen, not the visible one

`loadAll()` ends with an unconditional:

```js
filterAndRenderCached();
if (typeof renderRestoredScreenContent === 'function') renderRestoredScreenContent();
```

`renderRestoredScreenContent()` reads `window.__saRestoredScreen`, which is set **once** at boot and never updated afterwards. Screen navigation inside the live page only toggles `.active` classes, so a user who booted into *All Vacancies*, opened the **Himalayas** folder, and then navigated to **Home** still has `__saRestoredScreen === 'allvacancies'`. Every later hydration therefore repaints the All Vacancies screen — using the still-set `allVacanciesFolder === 'himalayas'` — regardless of which screen the user is actually looking at.

### 2.2 The repaint writes into other screens' containers

`renderAllVacanciesList()` (`app-ui.js:1138`) does not return early when the expression is for the overview: with `allVacanciesFolder === 'himalayas'` it delegates to `loadDedicatedVacancies(false)`, whose renderer writes `document.getElementById('allvacancies-list').innerHTML` — a container inside `#screen-allvacancies` — while the user is on Home. The same applies to `renderPosterFeed()` (`#poster-feed`, inside `#screen-allposters`) and `loadPoolCandidates()` (`#pool-list`, inside `#screen-pool`).

### 2.3 The repaint changes data that other screens render

The leak is not only cosmetic. Both folder loaders mutate shared caches:

```js
visiblePage.forEach(function(v){
  if (v.agency_id && v.agency_id !== 'general' && !vacanciesCache.some(function(x){ return x.id === v.id; })) vacanciesCache.push(v);
});
```

`vacanciesCache` is read by `renderSaved()`, the search screen, agency and employer hub cards, and the vacancy total in `updateStats()`. `loadPoolCandidates()` additionally calls `updateStats()`, which rewrites the Home stat cards. So a hidden-screen hydration silently changes the numbers and lists shown on the visible screen — the reported cross-contamination.

### 2.4 Concurrency: no epoch, no ownership

`loadAll()` has no generation token, no `AbortController`, and no single-flight guard, while four independent triggers can start it (boot, idle resume, `pageshow`, `online`, plus the retry banner and the Home button). Two overlapping runs interleave at every `await` boundary and mutate the same globals:

```js
agenciesCache = results[0];
branchesCache = results[1];
vacanciesCache = sortVacancies(results[2].filter(...));
generalVacancyCount = results[4];
...
updateStats();
filterAndRenderCached();
```

The tail is a sequence of separate DOM writes with no atomic boundary, so generation *N*'s stats can be committed next to generation *N+1*'s cards. Because `matchVacanciesToAgencies(results[2], agenciesCache)` mutates row objects **before** the array is copied by `sortVacancies`, a concurrently-running generation can also mutate rows that are already reachable from another screen's list.

### 2.5 The persisted cache can capture a mixed generation

`saveDataCache()` is called at the tail of one generation while a second generation may be mid-flight, so the snapshot written to IndexedDB can hold some tables from *N* and others from *N+1*. The next boot restores that mixed snapshot as its instant-paint source.

### 2.6 Refresh serves a stale payload and mislabels its age

`getStartupData()` memoises `startupDataPromise` and resets it **only on failure**:

```js
startupDataPromise.then(function(payload){
  if (!payload) startupDataPromise = null;
}, function(){ startupDataPromise = null; });
```

A successful payload therefore lives for the whole page lifetime, so every later refresh re-uses the boot payload. `lastDataRefreshAt = Date.now()` then labels that stale payload as freshly refreshed, and the Worker's authoritative `generated_at` is never read.

### 2.7 Refresh does not reset transient screen state

`refreshHome()` sets `#screen-home` active but leaves `allVacanciesFolder`, `vacancyFolderDisplayLimit`, `vacancyFolderDisplayKey`, `generalVacancyRows/Page/HasMore`, `dedicatedVacancyRows/Page/HasMore` and `window.__saRestoredScreen` untouched. A refresh is presented as a clean reload while silently continuing the previous screen's session.

## 3. Root cause

> One `loadAll()` generation is treated as if it owns the whole application, but nothing tells it **which screen is visible**, **which generation is allowed to write**, or **which state is transient per screen**. Every hydration unconditionally repaints a remembered screen against shared mutable caches, with no epoch guard against concurrent generations, so renders and data cross between screens.

Four defects, one failure mode:

1. **No refresh epoch** — concurrent hydrations interleave and their writes mix.
2. **No screen scoping** — hydration paints containers of non-visible screens.
3. **No transient-state reset** — folder/pagination/restore markers survive a refresh and drive the wrong render.
4. **No memo invalidation** — an explicit refresh re-serves the boot payload and mislabels its age.

## 4. Fix

A single owner, `app-refresh.js`, becomes the only authority for *when* a refresh may paint and *what* it may paint:

| Guard | Mechanism |
|---|---|
| Newest generation wins | Monotonic `__saRefreshEpoch`; `saIsCurrentRefresh(token)` is checked at every `await` boundary and before every DOM write. Superseded generations return without touching globals or the DOM. |
| Screen scoping | `SA_SCREEN_RENDERERS` maps each screen to its renderers; `saRenderActiveScreen()` paints the screen that is *currently* `.active`, never a remembered name. |
| Container ownership | Transient-state containers (`allvacancies-list`, `poster-feed`, `pool-list`, `saved-list`, `search-results`, `candidate-spotlight-deck`) may only be written while their own screen is visible; durable directory surfaces stay epoch-scoped. |
| Clean refresh | `saResetTransientScreenState()` clears folder, pagination and restore markers so a refresh cannot continue the previous screen's list. |
| Fresh data | `saInvalidateStartupData()` drops the memo; the true `generated_at` becomes the displayed data age. |
| Atomic cache | `saveDataCache()` refuses to persist from a superseded generation. |

## 5. Where it lives

| File | Role |
|---|---|
| `scripts/app-refresh.js` | The pipeline itself: epoch primitives in use, screen resolution, container ownership, transient-state reset, the refresh lifecycle listeners, and the hydration entry point `saRefreshAll()`. Loaded as the **last** deferred script. |
| `app-refresh-bundle.js` | The epoch primitives only, so the bundle's guarded call sites resolve `saIsCurrentRefresh()` even if the pipeline module has not loaded. Bundled; the pipeline module is not. |
| `scripts/refresh-pipeline.test.mjs` | 25 regression tests that evaluate the real sources in jsdom. |
| `scripts/prove-regression-caught.mjs` | Defect-injection harness: reverts each original bug in a scratch copy and asserts a specific test fails. |
| `scripts/verify-critical-globals.js` | Build gate. Throws — failing the whole build — if any pipeline invariant goes missing. |

### 5.1 Why the pipeline is not bundled

The pipeline is deliberately split across two files and only the primitive half is bundled. Three constraints force this:

1. **It must run last.** The bundle defines `loadAll()` and every renderer, so the pipeline needs those definitions to exist before it evaluates. Deferred scripts execute in document order, so `scripts/app-refresh.js` is referenced after `app.bundle.min.js`.
2. **It must not run twice.** Including the module in `FILES` while also loading it as its own script would evaluate it twice and register duplicate `visibilitychange`/`pageshow`/`online` listeners — reintroducing exactly the multiple-hydrations-per-wake-up problem it exists to remove. The build gate now fails the build if the module's body is ever detected inside the bundle.
3. **It must be able to reach stale clients.** An older service worker's navigation fallback serves `app.bundle.min.js` with an older `?v=` hash, so a fix shipped only inside the bundle stays invisible until the client re-downloads it. `scripts/app-refresh.js` is an unversioned, precached shell asset, so it arrives on the next shell install. It is intentionally absent from `generate-pages.js`'s `STATIC_ASSETS`, because the `?v=` rewrite would change the URL the service worker precaches.

If `index.html` is ever newer than the bundle it references, `loadAll()` would still be the legacy unguarded version; the pipeline covers that by re-registering a guarded wrapper around `loadAll()` at load time, marked with `__saEpochWrapped` so a second evaluation cannot wrap it twice.

### 5.2 A seventh leak found during implementation

The trace above lists six defects; implementing the container-ownership guard surfaced a seventh. `renderAllVacanciesList()` has three branches, and only the two *folder* branches delegate to the guarded folder renderers. The **overview** (folder-picker) branch writes `#allvacancies-list` directly, so it carried its own copy of the same background-write leak. It is now guarded in the same way, with its own regression test.

## 6. Verification

| Check | Result |
|---|---|
| `npm test` (77 pre-existing + 25 new) | 102 passing, 0 failing |
| `npm run verify:refresh` (defect injection) | Every one of the 5 injected defects fails a specific regression test |
| `node generate-pages.js` | Builds; all pipeline invariants in the build gate pass |
| Live browser run | `PASS: true` across every guard — hidden container not written, refresh clears folder/restore markers/count flags and advances the epoch, exactly one screen ever active, stale epoch tokens rejected |
| Live regression of normal browsing | Agencies, branches, vacancies and posters screens each still render their real data; Home directory intact |

The defect-injection harness matters more than the pass count. A green suite on fixed code only shows the tests agree with the fix; reverting each original bug and requiring a specific failure is what proves the tests cannot silently become no-ops.

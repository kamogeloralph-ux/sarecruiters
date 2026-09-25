/*
 * SA Recruiters -- app.js split 10/10: app-refresh-bundle.js
 * Bridge for the state-safe refresh pipeline.
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 *
 * The pipeline itself is defined in app-refresh.js, which is loaded as its own
 * <script> AFTER this bundle. That split is deliberate:
 *
 *   - Logic must run LAST. This bundle defines loadAll() and every renderer
 *     (app-data.js, app-ui.js), and the pipeline wraps those call sites, so the
 *     definitions have to exist before the pipeline module is evaluated.
 *   - The module must be reachable by clients whose cached
 *     app.bundle.min.js is still the pre-fix generation. An older worker's
 *     navigation fallback serves that stale bundle with an OLD hash, so any
 *     fix shipped only inside the bundle would stay invisible until the client
 *     happened to re-download it. app-refresh.js is therefore a separate,
 *     unversioned shell asset this bundle does NOT include — it is bundled
 *     nowhere, so it can never execute twice.
 *
 * This bridge only holds the epoch primitives, so even in the degraded case
 * where index.html is newer than both scripts, the bundle's own replaced
 * call sites still find the guards they reference.
 */

// ===== Refresh epoch primitives =====
// __saRefreshEpoch counts hydrations that have STARTED. __saRefreshCommitted
// records the epoch of the newest hydration that COMMITTED its results.
var __saRefreshEpoch = 0;
var __saRefreshCommitted = 0;

function saBeginRefresh(reason) {
  __saRefreshEpoch += 1;
  return __saRefreshEpoch;
}
function saCurrentRefreshToken() {
  return __saRefreshEpoch;
}
function saRefreshCommittedEpoch() {
  return __saRefreshCommitted;
}
function saCommitRefresh(token) {
  if (typeof token === 'number' && token > __saRefreshCommitted) __saRefreshCommitted = token;
  return token;
}

// The guard every async hydration must pass after each await, and before every
// write to shared state or the DOM. A false return means a newer hydration has
// taken over: return immediately, change nothing.
//
// When app-refresh.js has not loaded (a client running an older/newer
// index.html that still loads this bundle), the guard is undeclared and
// saIsCurrentRefresh is undefined, which every call site treats as "no epoch
// information — proceed". That keeps the bundle self-consistent rather than
// letting an undefined primitive silently drop every hydration.
function saIsCurrentRefresh(token) {
  return typeof token === 'number' && token === __saRefreshEpoch;
}

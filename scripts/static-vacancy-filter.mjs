// ============================================================
//  SA RECRUITERS — scripts/static-vacancy-filter.mjs
// ============================================================
//  Makes the committed snapshot (data/startup.json) match what the app
//  actually keeps live. The snapshot is exported right after the scrapers
//  run, but the daily enforce-vacancy-caps job later trims every poster /
//  unlinked company (Simplify, Adzuna, careers-page...) to its newest 50.
//  Without applying the same rules here, the home "Available Vacancies"
//  tile counted rows that the caps job deletes (e.g. one company had 4,700+
//  rows), inflating the total ~2.6x.
// ============================================================
// Kept dependency-free on purpose (mirrors enforce-vacancy-caps.mjs) so it can run and be
// tested without installing @supabase/supabase-js.
function normalizeCompanyName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function collectOverflow(rows, keyFn, cap) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const overflow = new Map();
  for (const [key, group] of groups) if (group.length > cap) overflow.set(key, group.slice(cap));
  return overflow;
}

const AGENCY_SENTINELS = new Set(['general', 'employer']);

// Same parsing rules as parseVacancyClosingDate() in app-data.js.
export function parseClosingDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[m[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) return Date.UTC(+m[3], month, +m[1]);
  }
  return null;
}

export function dropExpired(rows, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return rows.filter((row) => {
    const closing = parseClosingDate(row.closing_date);
    return closing === null || closing >= today;
  });
}

// Keeps the newest `cap` rows per real agency, per employer, and per
// normalized unlinked company — identical grouping to enforce-vacancy-caps.mjs.
export function applyPosterCaps(rows, cap = 50, companyCap = cap) {
  const sorted = [...rows].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const drop = new Set();
  const collect = (keyFn, limit) => {
    for (const overflow of collectOverflow(sorted, keyFn, limit).values()) for (const row of overflow) drop.add(row.id);
  };
  collect((r) => (r.agency_id && !AGENCY_SENTINELS.has(r.agency_id) ? r.agency_id : null), cap);
  collect((r) => r.employer_id || null, cap);
  collect((r) => {
    if (r.agency_id && !AGENCY_SENTINELS.has(r.agency_id)) return null;
    if (r.employer_id) return null;
    return normalizeCompanyName(r.company) || null;
  }, companyCap);
  return rows.filter((row) => !drop.has(row.id));
}

export function filterLiveVacancies(rows, opts = {}) {
  const cap = Math.max(1, Number.parseInt(opts.cap ?? process.env.MAX_PER_POSTER ?? '50', 10));
  const companyCap = Math.max(1, Number.parseInt(opts.companyCap ?? process.env.MAX_PER_COMPANY ?? String(cap), 10));
  return applyPosterCaps(dropExpired(rows, opts.now), cap, companyCap);
}

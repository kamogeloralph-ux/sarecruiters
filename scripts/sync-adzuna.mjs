import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { isStaleVacancy } from './vacancy-freshness.mjs';
import { envInt, envList, sleep } from './scrape-limits.mjs';

// ---------------------------------------------------------------------------
//  What changed (see docs/vacancy-supply-audit-2026-11-26.md)
//
//  The old sync made ONE unfiltered query and read 3 pages x 50 = 150 vacancies
//  per run, then the source-stale reconcile removed anything not seen for 72h.
//  Adzuna South Africa carries thousands of live listings, so the app only ever
//  held ~150-250 of them. The sync now walks Adzuna's job categories, newest
//  first, spending a fixed call budget round-robin so every category is
//  represented. The budget is deliberately below the free-tier daily quota
//  because the live /find-jobs search (Cloudflare-worker/adzuna.js) shares it.
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
const ADZUNA_COUNTRY = (process.env.ADZUNA_COUNTRY || 'za').toLowerCase().replace(/[^a-z]/g, '') || 'za';
const REQUEST_TIMEOUT_MS = envInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000, { min: 1_000, max: 120_000 });
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersAdzunaSync/1.0 (+https://sa-recruiters.co.za)';
// Free tier: 25 calls/min, ~250/day. The refresh runs twice a day, so 70 calls
// per run is ~140/day and leaves ~110/day for /find-jobs and manual re-runs.
// Raise ADZUNA_MAX_CALLS only if your Adzuna plan allows it.
const MAX_CALLS = envInt(process.env.ADZUNA_MAX_CALLS, 70, { min: 1, max: 1_000 });
const MAX_VACANCIES = envInt(process.env.ADZUNA_MAX_VACANCIES, 4_000, { min: 1, max: 20_000 });
const RESULTS_PER_PAGE = envInt(process.env.ADZUNA_RESULTS_PER_PAGE, 50, { min: 1, max: 50 });
// Pages read per category per run. Round-robin means a low budget still reaches
// every category's first page before any category's second page.
const PAGES_PER_CATEGORY = envInt(process.env.ADZUNA_PAGES_PER_CATEGORY, 6, { min: 1, max: 20 });
// Must stay at or below the 45-day freshness ceiling in vacancy-freshness.mjs.
const MAX_DAYS_OLD = envInt(process.env.ADZUNA_MAX_DAYS_OLD, 30, { min: 1, max: 45 });
const REQUEST_DELAY_MS = envInt(process.env.ADZUNA_REQUEST_DELAY_MS, 3_000, { min: 0, max: 60_000 });
const UPSERT_CHUNK = 200;

// Adzuna's category tags are shared across countries. They are discovered live
// from /categories each run (1 call); this list is only the fallback if that
// call fails, and ADZUNA_CATEGORIES="tag1,tag2" pins an explicit list.
export const ADZUNA_FALLBACK_CATEGORIES = [
  'accounting-finance-jobs', 'admin-jobs', 'charity-voluntary-jobs', 'consultancy-jobs',
  'creative-design-jobs', 'customer-services-jobs', 'domestic-help-cleaning-jobs',
  'energy-oil-gas-jobs', 'engineering-jobs', 'graduate-jobs', 'healthcare-nursing-jobs',
  'hospitality-catering-jobs', 'hr-jobs', 'it-jobs', 'legal-jobs', 'logistics-warehouse-jobs',
  'maintenance-jobs', 'manufacturing-jobs', 'other-general-jobs', 'part-time-jobs',
  'pr-advertising-marketing-jobs', 'property-jobs', 'retail-jobs', 'sales-jobs',
  'scientific-qa-jobs', 'social-work-jobs', 'teaching-jobs', 'trade-construction-jobs',
  'travel-tourism-jobs', 'unknown',
];

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function formatSalary(min, max, isPredicted) {
  if (!min && !max) return '';
  const format = (value) => `R${Math.round(value).toLocaleString('en-US')}`;
  const text = min && max && min !== max
    ? `${format(min)} - ${format(max)}`
    : format(min || max);
  const predicted = isPredicted === '1' || isPredicted === 1 || isPredicted === true;
  return predicted ? `${text} (estimated)` : text;
}

// Maps a raw Adzuna /search response into the shared vacancy shape used by
// the other active vacancy sources.
export function mapAdzunaResults(payload, now = new Date()) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const nowIso = now.toISOString();

  return results
    .map((item) => {
      const id = item?.id != null ? String(item.id) : null;
      const link = item?.redirect_url || null;
      const title = clean(item?.title);
      if (!id || !link || !title) return null;

      const company = clean(item?.company?.display_name);
      const location = clean(item?.location?.display_name);
      const salary = formatSalary(item?.salary_min, item?.salary_max, item?.salary_is_predicted);
      const contract = clean([item?.contract_time, item?.contract_type].filter(Boolean).join(' '));
      // Adzuna's own `created` field -- already fetched for the "Posted"
      // text in notes below, now also used as a structured signal so a
      // listing Adzuna's own index never refreshes can be skipped. Adzuna
      // has no closing-date field, so posting age is the only signal here.
      const postedText = item?.created ? String(item.created).slice(0, 10) : '';
      const posted = postedText ? `Posted ${postedText}` : '';
      const description = clean(item?.description).slice(0, 500);
      const notes = clean([salary, contract, posted, description].filter(Boolean).join(' · ')).slice(0, 20_000);

      const stale = isStaleVacancy({ closing_date: '', postedText, source_type: 'adzuna' }, now);
      if (stale.stale) {
        console.log(`[adzuna] skipping ${link}: ${stale.reason}`);
        return null;
      }

      return {
        id: `adzuna-${id}`,
        title,
        company,
        location,
        notes,
        link,
        source_type: 'adzuna',
        source_checked_at: nowIso,
        last_verified_at: nowIso,
        // postedText deliberately omitted -- 'vacancies' has no such
        // column; PostgREST rejects the whole upsert batch (PGRST204) if
        // an unrecognized key is present in the payload.
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
//  Request building (pure; the app key is only ever placed in a URL, never logged)
// ---------------------------------------------------------------------------
export function adzunaSearchUrl({ country = 'za', appId, appKey, page = 1, perPage = 50, category = '', maxDaysOld = 30, sortBy = 'date' }) {
  const params = new URLSearchParams({
    app_id: String(appId ?? ''),
    app_key: String(appKey ?? ''),
    results_per_page: String(perPage),
    sort_by: sortBy,
    'content-type': 'application/json',
  });
  if (maxDaysOld) params.set('max_days_old', String(maxDaysOld));
  if (category) params.set('category', category);
  return `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params.toString()}`;
}

export function adzunaCategoriesUrl({ country = 'za', appId, appKey }) {
  const params = new URLSearchParams({ app_id: String(appId ?? ''), app_key: String(appKey ?? ''), 'content-type': 'application/json' });
  return `https://api.adzuna.com/v1/api/jobs/${country}/categories?${params.toString()}`;
}

export function parseAdzunaCategories(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const tags = results.map((item) => clean(item?.tag)).filter((tag) => /^[a-z0-9-]{2,60}$/.test(tag));
  return [...new Set(tags)];
}

// ---------------------------------------------------------------------------
//  Collection engine (pure apart from the injected fetch/sleep, so it is unit
//  tested without the network). Spends `maxCalls` round-robin across categories:
//  round 1 reads page 1 of every category, round 2 reads page 2 of every
//  category that still has results, and so on.
// ---------------------------------------------------------------------------
export async function collectAdzunaJobs({
  categories,
  fetchSearch,
  maxCalls = MAX_CALLS,
  maxVacancies = MAX_VACANCIES,
  perPage = RESULTS_PER_PAGE,
  pagesPerCategory = PAGES_PER_CATEGORY,
  delayMs = REQUEST_DELAY_MS,
  sleepFn = sleep,
  now = new Date(),
  log = () => {},
} = {}) {
  const state = categories.map((tag) => ({ tag, done: false, total: null, fetched: 0, calls: 0, failed: false }));
  const jobs = new Map();
  let calls = 0;
  let failures = 0;
  let rateLimited = false;
  let fatal = false;
  let stopReason = 'completed';

  outer:
  for (let round = 1; round <= pagesPerCategory; round += 1) {
    let activeThisRound = 0;
    for (const category of state) {
      if (category.done) continue;
      if (calls >= maxCalls) { stopReason = 'call budget reached'; break outer; }
      if (jobs.size >= maxVacancies) { stopReason = 'vacancy cap reached'; break outer; }
      activeThisRound += 1;
      if (calls > 0 && delayMs > 0) await sleepFn(delayMs);
      calls += 1;
      category.calls += 1;
      try {
        const payload = await fetchSearch({ category: category.tag, page: round });
        const rawCount = Array.isArray(payload?.results) ? payload.results.length : 0;
        const total = Number(payload?.count);
        if (Number.isFinite(total)) category.total = total;
        const mapped = mapAdzunaResults(payload, now);
        for (const job of mapped) if (!jobs.has(job.id)) jobs.set(job.id, job);
        category.fetched += mapped.length;
        log(`[adzuna] ${category.tag} page ${round}: ${rawCount} returned, ${mapped.length} kept${category.total != null ? ` (category total ${category.total})` : ''}`);
        if (rawCount < perPage || (category.total != null && round * perPage >= category.total)) category.done = true;
      } catch (error) {
        failures += 1;
        category.failed = true;
        category.done = true; // do not spend more calls on a category that errored this run
        const status = Number(error?.status) || 0;
        log(`[adzuna] ${category.tag} page ${round}: ${error instanceof Error ? error.message : String(error)}`);
        if (status === 429) { rateLimited = true; stopReason = 'rate limited (HTTP 429)'; break outer; }
        if (status === 401 || status === 403) { fatal = true; stopReason = `credentials rejected (HTTP ${status})`; break outer; }
      }
    }
    if (!activeThisRound) break;
  }

  return {
    jobs: [...jobs.values()].slice(0, maxVacancies),
    calls,
    failures,
    rateLimited,
    fatal,
    stopReason,
    categories: state.map(({ tag, total, fetched, calls: used, failed }) => ({ tag, total, fetched, calls: used, failed })),
  };
}

// ---------------------------------------------------------------------------
//  Network + database (only used when this file is run as a script)
// ---------------------------------------------------------------------------
async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      // Never echo the URL: it carries the app key.
      const error = new Error(`Adzuna returned HTTP ${response.status}${body?.exception ? ` (${String(body.exception).slice(0, 80)})` : ''}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Adzuna request timed out');
      timeoutError.status = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveCategories() {
  const configured = envList(process.env.ADZUNA_CATEGORIES, ['auto']);
  if (!(configured.length === 1 && configured[0].toLowerCase() === 'auto')) {
    return { tags: configured, source: 'ADZUNA_CATEGORIES', spent: 0 };
  }
  try {
    const tags = parseAdzunaCategories(await fetchJson(adzunaCategoriesUrl({ country: ADZUNA_COUNTRY, appId: ADZUNA_APP_ID, appKey: ADZUNA_APP_KEY })));
    if (tags.length) return { tags, source: 'discovered from Adzuna', spent: 1 };
  } catch (error) {
    console.warn(`[adzuna] category discovery failed (${error instanceof Error ? error.message : 'error'}); using the built-in list`);
  }
  return { tags: ADZUNA_FALLBACK_CATEGORIES, source: 'built-in fallback list', spent: 1 };
}

// Adzuna's `id` is stable, so rows are upserted by id. (The old link-based
// lookup was dropped: Adzuna's redirect_url carries a per-request token, so it
// never matched, and 50 long URLs in one in.() filter risked an oversized request.)
async function upsertJobs(jobs) {
  let written = 0;
  for (let index = 0; index < jobs.length; index += UPSERT_CHUNK) {
    const chunk = jobs.slice(index, index + UPSERT_CHUNK).map((job) => ({ ...job, agency_id: 'general' }));
    const { error } = await supabase.from('vacancies').upsert(chunk, { onConflict: 'id' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

async function main() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) throw new Error('ADZUNA_APP_ID and ADZUNA_APP_KEY are required');

  const { tags, source, spent } = await resolveCategories();
  console.log(`[adzuna] ${tags.length} categories (${source}); budget ${MAX_CALLS} calls, ${spent} already used; up to ${MAX_VACANCIES} vacancies; last ${MAX_DAYS_OLD} days, newest first`);

  const result = await collectAdzunaJobs({
    categories: tags,
    maxCalls: Math.max(0, MAX_CALLS - spent),
    fetchSearch: ({ category, page }) => fetchJson(adzunaSearchUrl({
      country: ADZUNA_COUNTRY, appId: ADZUNA_APP_ID, appKey: ADZUNA_APP_KEY,
      page, perPage: RESULTS_PER_PAGE, category, maxDaysOld: MAX_DAYS_OLD,
    })),
    log: (line) => console.log(line),
  });

  const written = await upsertJobs(result.jobs);
  const failedCategories = result.categories.filter((category) => category.failed).map((category) => category.tag);
  console.log(`[adzuna] RESULT upserted=${written} calls=${result.calls + spent}/${MAX_CALLS} failures=${result.failures} stop="${result.stopReason}" categories_with_jobs=${result.categories.filter((c) => c.fetched > 0).length}/${tags.length}`);
  if (failedCategories.length) console.warn(`::warning title=Adzuna categories failed::${failedCategories.join(', ')}`);
  if (result.rateLimited) console.warn('::warning title=Adzuna rate limited::Stopped early on HTTP 429. Lower ADZUNA_MAX_CALLS or check /find-jobs usage of the same key.');

  // A run is unhealthy only when it produced nothing, was rejected outright, or
  // most of its calls failed. A partial run still refreshes what it fetched, and
  // the 72h source-stale window in reconcile-vacancy-freshness.mjs tolerates it.
  if (result.fatal || written === 0 || result.failures > result.calls / 2) {
    if (!written && !result.failures) console.error('[adzuna] run returned no vacancies; refusing to mark the source healthy');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[adzuna] sync failed: ${error instanceof Error ? error.message : 'error'}`);
    process.exitCode = 1;
  });
}

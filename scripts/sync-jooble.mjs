// Jooble job sync (https://jooble.org/api/about).
//
// Needs JOOBLE_API_KEY (GitHub Actions secret), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Jooble's free key allows 100 requests PER DAY. The refresh workflow runs twice a day,
// so each run is hard-capped (JOOBLE_MAX_REQUESTS, default 30 => ~60/day) which leaves
// plenty of room for manual runs. Each query/page pair costs one request.
import { pathToFileURL } from 'node:url';
import { envInt, envList } from './scrape-limits.mjs';

const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY;
const JOOBLE_LOCATION = process.env.JOOBLE_LOCATION || 'South Africa';
// Jooble issues one API key PER COUNTRY DOMAIN. A key made on jooble.org answers HTTP 200 with
// zero South African jobs when it is used against the wrong domain, which looks exactly like a
// healthy-but-empty source. When JOOBLE_API_ORIGIN is not set the sync therefore probes
// jooble.org first and then za.jooble.org, and keeps whichever returns jobs.
const CONFIGURED_ORIGIN = String(process.env.JOOBLE_API_ORIGIN || '').trim().replace(/\/+$/, '');
const ORIGIN_CANDIDATES = CONFIGURED_ORIGIN ? [CONFIGURED_ORIGIN] : ['https://jooble.org', 'https://za.jooble.org'];
const JOOBLE_API_ORIGIN = ORIGIN_CANDIDATES[0];
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.JOOBLE_REQUEST_DELAY_MS, 1_500);
const MAX_VACANCIES = envInt(process.env.JOOBLE_MAX_VACANCIES, 1_500, { min: 1, max: 10_000 });
const MAX_AGE_DAYS = 45; // same tier as the other external job boards
const PAGES = envInt(process.env.JOOBLE_PAGES, 1, { min: 1, max: 5 });
// Free key = 100 requests/day. Two scheduled runs x 30 = 60/day, leaving room for manual runs.
const MAX_REQUESTS = envInt(process.env.JOOBLE_MAX_REQUESTS, 30, { min: 1, max: 45 });
// Jooble's API is multi-country and treats `location` as a fuzzy text hint, so non-SA jobs leak in.
// Every result is therefore checked against South African provinces/places before it is stored.
// Add extra towns without a code change via JOOBLE_EXTRA_PLACES="Dwarsloop,Kuruman".
const SA_PLACES = ['south africa', 'republic of south africa', 'rsa', 'gauteng', 'western cape', 'kwazulu', 'kwa-zulu', 'eastern cape',
  'free state', 'limpopo', 'mpumalanga', 'north west', 'northern cape', 'johannesburg', 'cape town', 'durban', 'pretoria', 'tshwane',
  'ekurhuleni', 'centurion', 'sandton', 'midrand', 'randburg', 'roodepoort', 'krugersdorp', 'benoni', 'boksburg', 'germiston', 'kempton park',
  'alberton', 'springs', 'soweto', 'tembisa', 'vereeniging', 'vanderbijlpark', 'brakpan', 'edenvale', 'bedfordview', 'fourways', 'rosebank',
  'bloemfontein', 'welkom', 'polokwane', 'tzaneen', 'mokopane', 'nelspruit', 'mbombela', 'witbank', 'emalahleni', 'secunda', 'middelburg',
  'rustenburg', 'klerksdorp', 'potchefstroom', 'mahikeng', 'brits', 'pietermaritzburg', 'richards bay', 'newcastle', 'ladysmith', 'umhlanga',
  'pinetown', 'port elizabeth', 'gqeberha', 'east london', 'mthatha', 'queenstown', 'kimberley', 'upington', 'kuruman', 'stellenbosch', 'paarl',
  'bellville', 'george', 'mossel bay', 'worcester', 'somerset west', 'sasolburg', 'kroonstad']
  .concat(String(process.env.JOOBLE_EXTRA_PLACES || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
const SA_PLACE_RE = new RegExp(`(^|[^a-z])(${SA_PLACES.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^a-z]|$)`, 'i');
const FOREIGN_RE = /\b(united states|usa|u\.s\.|united kingdom|\buk\b|england|scotland|canada|australia|india|nigeria|kenya|ghana|uganda|zimbabwe|zambia|botswana|namibia|mozambique|uae|dubai|saudi|qatar|germany|france|ireland|netherlands|new zealand|philippines|pakistan)\b/i;
export function isSouthAfricanLocation(location, { trustDomain = false } = {}) {
  const text = clean(location);
  if (FOREIGN_RE.test(text)) return false;
  // za.jooble.org only serves South African inventory, so the whitelist of ~90 towns (which
  // rejects every other real town and village) is replaced by "not obviously foreign".
  if (trustDomain) return true;
  if (!text) return false;
  return SA_PLACE_RE.test(text);
}

const QUERIES = envList(process.env.JOOBLE_QUERIES, [
  'general worker', 'driver', 'admin clerk', 'sales', 'security', 'cashier', 'warehouse', 'receptionist',
  'accountant', 'bookkeeper', 'engineer', 'technician', 'electrician', 'nurse', 'teacher', 'call centre',
  'customer service', 'manager', 'cleaner', 'chef', 'waiter', 'merchandiser', 'learnership', 'internship',
  'graduate', 'developer', 'marketing', 'mechanic', 'artisan', 'operator',
]);

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
// Jooble snippets contain <b>highlight</b> tags and HTML entities.
export function clean(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|quot|#39|lt|gt);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Maps a raw Jooble response into the shared vacancy shape used by the other sources.
export function mapJoobleResults(payload, now = new Date(), { trustDomain = false, stats = null } = {}) {
  const results = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const nowIso = now.toISOString();
  const seen = new Set();
  return results.map((item) => {
    const id = item?.id != null ? String(item.id) : null;
    const link = item?.link || null;
    const title = clean(item?.title);
    if (!id || !link || !title || seen.has(id)) return null;
    seen.add(id);

    if (!isSouthAfricanLocation(item?.location, { trustDomain })) {
      if (stats) {
        stats.rejectedLocation = (stats.rejectedLocation || 0) + 1;
        const label = clean(item?.location).slice(0, 40) || '(blank)';
        stats.rejectedLocations = stats.rejectedLocations || new Map();
        stats.rejectedLocations.set(label, (stats.rejectedLocations.get(label) || 0) + 1);
      }
      return null;
    }

    const updatedMs = item?.updated ? Date.parse(item.updated) : NaN;
    if (Number.isFinite(updatedMs) && now.getTime() - updatedMs > MAX_AGE_DAYS * 86_400_000) {
      if (stats) stats.rejectedStale = (stats.rejectedStale || 0) + 1;
      return null;
    }

    const posted = Number.isFinite(updatedMs) ? `Posted ${new Date(updatedMs).toISOString().slice(0, 10)}` : '';
    const notes = clean([clean(item?.salary), clean(item?.type), posted, clean(item?.snippet).slice(0, 500)]
      .filter(Boolean).join(' · ')).slice(0, 20_000);

    return {
      id: `jooble-${id}`,
      title,
      company: clean(item?.company),
      location: clean(item?.location),
      notes,
      link,
      source_type: 'jooble',
      source_checked_at: nowIso,
      last_verified_at: nowIso,
    };
  }).filter(Boolean);
}

export function joobleApiUrl(apiKey, origin = JOOBLE_API_ORIGIN) {
  return `${String(origin).replace(/\/+$/, '')}/api/${encodeURIComponent(apiKey)}`;
}

async function fetchPage(keywords, page, origin = JOOBLE_API_ORIGIN) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // The key is part of the URL path, so never print the URL or the raw fetch error.
    const response = await fetch(joobleApiUrl(JOOBLE_API_KEY, origin), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ keywords, location: JOOBLE_LOCATION, page: String(page) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(`Jooble returned HTTP ${response.status}${response.status === 403 ? ' (check JOOBLE_API_KEY and that it was issued for this Jooble domain)' : ''}`); error.status = response.status; throw error; }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Jooble request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertJobs(supabase, mappedJobs) {
  const links = mappedJobs.map((job) => job.link);
  const { data: existing, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existing || []).map((job) => [job.link, job.id]));
  const jobs = mappedJobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id, agency_id: 'general' }));
  if (jobs.length) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!JOOBLE_API_KEY) throw new Error('JOOBLE_API_KEY is required');
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const plan = [];
  for (let page = 1; page <= PAGES; page += 1) for (const q of QUERIES) plan.push({ q, page });
  const requests = plan.slice(0, MAX_REQUESTS);
  console.log(`[jooble] ${requests.length} request(s) planned of ${plan.length} (daily limit is 100); origin ${CONFIGURED_ORIGIN ? 'configured' : 'auto-detect'}: ${ORIGIN_CANDIDATES.map((o) => new URL(o).hostname).join(' -> ')}`);

  let origin = ORIGIN_CANDIDATES[0];
  let originConfirmed = ORIGIN_CANDIDATES.length === 1;
  const stats = {};
  let failures = 0, processed = 0, rawTotal = 0, requestsMade = 0;
  for (let i = 0; i < requests.length && processed < MAX_VACANCIES; i += 1) {
    const { q, page } = requests[i];
    try {
      let payload = await fetchPage(q, page, origin);
      requestsMade += 1;
      // First answer on an unconfirmed origin with zero jobs: try the other regional domain.
      if (!originConfirmed) {
        let rawCount = Array.isArray(payload?.jobs) ? payload.jobs.length : 0;
        if (rawCount === 0) {
          for (const candidate of ORIGIN_CANDIDATES.filter((o) => o !== origin)) {
            try {
              const alt = await fetchPage(q, page, candidate);
              requestsMade += 1;
              if (Array.isArray(alt?.jobs) && alt.jobs.length) { origin = candidate; payload = alt; rawCount = alt.jobs.length; break; }
            } catch (error) { requestsMade += 1; /* the other domain rejecting this key is expected */ }
          }
        }
        if (rawCount > 0) { originConfirmed = true; console.log(`[jooble] using ${new URL(origin).hostname}`); }
      }
      const rawCount = Array.isArray(payload?.jobs) ? payload.jobs.length : 0;
      rawTotal += rawCount;
      const trustDomain = new URL(origin).hostname.startsWith('za.');
      const mapped = mapJoobleResults(payload, new Date(), { trustDomain, stats }).slice(0, MAX_VACANCIES - processed);
      const jobs = await upsertJobs(supabase, mapped);
      processed += jobs.length;
      console.log(`[jooble] "${q}" page ${page}: response ${rawCount}/${Number(payload?.totalCount || 0)} jobs, parsed ${mapped.length}, upserted ${jobs.length}`);
    } catch (error) {
      failures += 1;
      console.error(`[jooble] "${q}" page ${page}: ${error instanceof Error ? error.message : 'failed'}`);
      // bad key, or over the daily limit (429): stop spending requests
      if (/HTTP 4(0[13]|29)/.test(String(error?.message))) break;
    }
    if (i < requests.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  // Diagnostics requested in docs/scraper-investigation-2026-11-23.md: counts only, no payloads, no key.
  const topRejected = [...(stats.rejectedLocations || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} x${v}`).join('; ');
  console.log(`[jooble] RESULT upserted=${processed} raw=${rawTotal} requests=${requestsMade} failures=${failures} rejected_location=${stats.rejectedLocation || 0} rejected_stale=${stats.rejectedStale || 0}${topRejected ? ` top_rejected_locations="${topRejected}"` : ''}`);
  if (rawTotal === 0 && !failures) console.error('::warning title=Jooble returned zero jobs::Every response was empty. Create a key on za.jooble.org and set repository variable JOOBLE_API_ORIGIN=https://za.jooble.org');
  if (!processed && !failures) { console.error('[jooble] run returned no vacancies; refusing to mark the source healthy'); process.exitCode = 1; }
  if (failures > 0 && !processed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'Jooble sync failed'); process.exit(1); });
}

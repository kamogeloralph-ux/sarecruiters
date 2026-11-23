// Jooble job sync (https://jooble.org/api/about).
//
// Needs JOOBLE_API_KEY (GitHub Actions secret), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Jooble's free key allows 100 requests PER DAY. The refresh workflow runs twice a day,
// so each run is hard-capped (JOOBLE_MAX_REQUESTS, default 12 => ~24/day) which leaves
// plenty of room for manual runs. Each query/page pair costs one request.
import { pathToFileURL } from 'node:url';

const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY;
const JOOBLE_LOCATION = process.env.JOOBLE_LOCATION || 'South Africa';
const JOOBLE_API_ORIGIN = (process.env.JOOBLE_API_ORIGIN || 'https://jooble.org').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.JOOBLE_REQUEST_DELAY_MS, 1_500);
const MAX_VACANCIES = 60;
const MAX_AGE_DAYS = 45; // same tier as the other external job boards
const PAGES = Math.min(parsePositiveInt(process.env.JOOBLE_PAGES, 1), 3);
const MAX_REQUESTS = Math.min(parsePositiveInt(process.env.JOOBLE_MAX_REQUESTS, 12), 40);
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
export function isSouthAfricanLocation(location) {
  const text = clean(location);
  if (!text || FOREIGN_RE.test(text)) return false;
  return SA_PLACE_RE.test(text);
}

const QUERIES = String(process.env.JOOBLE_QUERIES || 'general worker,driver,admin clerk,sales,security,cashier')
  .split(',').map((q) => q.trim()).filter(Boolean);

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
export function mapJoobleResults(payload, now = new Date()) {
  const results = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const nowIso = now.toISOString();
  const seen = new Set();
  return results.map((item) => {
    const id = item?.id != null ? String(item.id) : null;
    const link = item?.link || null;
    const title = clean(item?.title);
    if (!id || !link || !title || seen.has(id)) return null;
    seen.add(id);

    if (!isSouthAfricanLocation(item?.location)) return null;

    const updatedMs = item?.updated ? Date.parse(item.updated) : NaN;
    if (Number.isFinite(updatedMs) && now.getTime() - updatedMs > MAX_AGE_DAYS * 86_400_000) return null;

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

async function fetchPage(keywords, page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // The key is part of the URL path, so never print the URL or the raw fetch error.
    const response = await fetch(joobleApiUrl(JOOBLE_API_KEY), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ keywords, location: JOOBLE_LOCATION, page: String(page) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Jooble returned HTTP ${response.status}${response.status === 403 ? ' (check JOOBLE_API_KEY)' : ''}`);
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
  console.log(`[jooble] ${requests.length} request(s) planned (daily limit is 100)`);

  let failures = 0, processed = 0;
  for (let i = 0; i < requests.length && processed < MAX_VACANCIES; i += 1) {
    const { q, page } = requests[i];
    try {
      const payload = await fetchPage(q, page);
      const rawCount = Array.isArray(payload?.jobs) ? payload.jobs.length : 0;
      const mapped = mapJoobleResults(payload).slice(0, MAX_VACANCIES - processed);
      const jobs = await upsertJobs(supabase, mapped);
      processed += jobs.length;
      console.log(`[jooble] "${q}" page ${page}: response ${rawCount}/${Number(payload?.totalCount || 0)} jobs, parsed ${mapped.length}, upserted ${jobs.length}`);
    } catch (error) {
      failures += 1;
      console.error(`[jooble] "${q}" page ${page}: ${error instanceof Error ? error.message : 'failed'}`);
      if (/HTTP 40[13]/.test(String(error?.message))) break; // bad key / over limit: stop spending requests
    }
    if (i < requests.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  if (!processed && !failures) { console.error('[jooble] run returned no vacancies; refusing to mark the source healthy'); process.exitCode = 1; }
  if (failures > 0 && !processed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'Jooble sync failed'); process.exit(1); });
}

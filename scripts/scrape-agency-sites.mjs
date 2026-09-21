import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

// Scrapes vacancies directly off individual recruitment agencies' own
// websites, for agencies that don't (yet) have a Pnet company page
// (scrape-pnet.mjs already covers agencies that do -- that's the preferred
// path since Pnet gives clean structured JobPosting data; this script is
// for the rest).
//
// This version is DB-driven rather than a hand-maintained URL list: it
// reads every agency's `website` column, tries a short list of common
// vacancy-page paths under it (plus the homepage itself), and picks
// whichever candidate is (a) allowed by robots.txt, (b) actually fetchable,
// and (c) yields parseable jobs. Whatever wins is cached to
// agencies.site_vacancy_url so future runs skip straight to it instead of
// re-discovering. Sites that fail every candidate are marked with a
// site_scrape_status (skipped_robots / skipped_unreachable /
// skipped_no_jobs) and reason instead of erroring the run -- see
// classifySite() for exactly what each status means.
//
// With ~140 agencies in the directory, one run does not attempt all of
// them: agencies are processed oldest-site_scraped_at-first (same rotation
// pattern scrape-pnet.mjs uses for last_scraped_at), capped at
// AGENCY_SITES_BATCH_SIZE per run, so a 6-hourly cron cycles through the
// whole directory over a day or two rather than hammering 140 sites at once.
//
// NOTE ON SELECTOR STRATEGY: a spot-check of 6 of the original 14 target
// sites (fetched directly, not guessed) found a generic CSS-selector guess
// does NOT reliably work across agency websites -- every site checked
// needed something different:
//   - izweplacements.co.za/vacancies/ and affirmativeportfolios.co.za/vacancies/
//     -- both 404, the URLs are dead
//   - jcmconsultants.co.za/jobs/ and assegai.co.za/vacancies/
//     -- disallow automated fetches via robots.txt
//   - headhunters.co.za/vacancies/ -- vacancy list is injected by
//     client-side JS, nothing to scrape in the static HTML
//   - annswann.co.za/vacancies/ -- doesn't host vacancies itself, embeds a
//     third-party widget (webapp.placementpartner.com)
//   - abantustaffingsolutions.co.za/jobs/ -- works well, but it's really
//     Dittojobs (another shared ATS) rendering each field (title,
//     "Reference No: 1976879110", location, description, "Salary: ...")
//     as plain text. Confirmed the field pattern and ordering live; the
//     exact DOM tags weren't visible through the tool used to check it
//     (only rendered text), so tierB's block-element assumption below is
//     inferred, not directly confirmed -- dry-run this one specifically
//     before trusting it.
// So this script tries two independent parsing strategies per candidate URL
// -- tierA (CSS card selectors, then a raw anchor-scan fallback) and tierB
// (the Dittojobs-style "Reference No: ... / Salary: ..." text-block
// pattern) -- and a candidate only counts as a hit if either finds
// something. The robots.txt check and the unreachable/404 handling above
// generalize the jcmconsultants/assegai/izweplacements/affirmativeportfolios
// cases automatically; a site that comes back with 0 jobs from every
// candidate (headhunters, annswann) is not necessarily broken code -- it
// may need bespoke handling the way jobmail/careerjunction/retail/pnet each
// got. Do a real dry run (node scripts/scrape-agency-sites.mjs) and check
// the log output / site_scrape_reason before assuming a site is a lost
// cause -- see scrape-agency-sites.test.mjs for the fixtures this was built
// and tested against.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.AGENCY_SITES_REQUEST_TIMEOUT_MS, 15_000);
const FETCH_ATTEMPTS = parsePositiveInt(process.env.AGENCY_SITES_FETCH_ATTEMPTS, 2);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.AGENCY_SITES_REQUEST_DELAY_MS, 1_500);
const CONCURRENCY = parsePositiveInt(process.env.AGENCY_SITES_CONCURRENCY, 3);
const BATCH_SIZE = parsePositiveInt(process.env.AGENCY_SITES_BATCH_SIZE, 40);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersAgencySiteScraper/1.0 (+https://sa-recruiters.co.za)';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

// Common vacancy-page paths across agency sites, tried in this order after
// the cached/known URL. Kept short and generic on purpose -- an aggressive
// list of guesses just means more requests to sites that will 404 on all of
// them anyway; the robots + unreachable + no-jobs classification handles
// whatever's left.
export const CANDIDATE_PATHS = [
  '', // the homepage itself -- some sites list vacancies right there
  '/vacancies/', '/vacancies', '/jobs/', '/jobs', '/careers/', '/careers',
  '/career/', '/current-vacancies/', '/job-vacancies/', '/vacancy/',
];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function absoluteUrl(href, baseUrl) {
  if (href == null) return null; // note: '' is a valid href (resolves to baseUrl itself)
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeWebsite(website) {
  if (!website) return null;
  const withScheme = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try { return new URL(withScheme).toString(); } catch { return null; }
}

// Tags an error as either 'http' (the host responded, just not with 2xx --
// worth trying a different path on the same host) or 'network' (DNS
// failure, connection refused, timeout -- the host itself is unreachable,
// so trying more paths on it is pointless and just burns time). Discovery
// uses this to stop probing a dead host after one failure instead of
// waiting out the same timeout on every remaining candidate path.
function taggedFetchError(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

async function fetchText(url, { timeoutMs = REQUEST_TIMEOUT_MS, attempts = FETCH_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
        });
      } catch (networkError) {
        throw taggedFetchError('network', networkError instanceof Error ? networkError.message : String(networkError));
      }
      if (!response.ok) throw taggedFetchError('http', `HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/html/i.test(contentType)) throw taggedFetchError('http', `unsupported content-type: ${contentType}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1_500 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

// Minimal robots.txt parser: honours Disallow rules under a matching
// User-agent group (our own UA if a group targets it, else the wildcard
// group), using simple prefix matching. Good enough to respect an explicit
// "don't scrape me"; on any fetch/parse failure we treat robots.txt as
// absent, which per convention means "no restrictions".
function parseRobots(robotsTxt, userAgent) {
  const groups = []; // { agents: string[], disallow: string[], finished: boolean }
  let current = null;
  for (const rawLine of robotsTxt.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [rawField, ...rest] = line.split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (field === 'user-agent') {
      if (!current || current.finished) {
        current = { agents: [], disallow: [], finished: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current.finished = true;
      if (value) current.disallow.push(value);
    }
  }
  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  return (specific || wildcard)?.disallow || [];
}

const robotsCache = new Map(); // origin -> Promise<string[] disallow rules>
async function robotsAllows(url, userAgent = USER_AGENT) {
  const target = new URL(url);
  const origin = target.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const text = await fetchText(`${origin}/robots.txt`, { timeoutMs: 8_000, attempts: 1 });
        return parseRobots(text, userAgent);
      } catch {
        return []; // missing/unreadable robots.txt -- treat as unrestricted
      }
    })());
  }
  const disallow = await robotsCache.get(origin);
  return !disallow.some((rule) => target.pathname.startsWith(rule));
}

function jobId(siteName, link) {
  return `agency-${crypto.createHash('sha1').update(`${siteName}-${link}`).digest('hex').slice(0, 20)}`;
}

// Tier A -- structural card scan: try known vacancy-card container
// selectors first; if none match, fall back to a raw anchor scan for links
// that look like individual job pages.
function parseTierA(html, site) {
  const $ = cheerio.load(html);
  const jobs = [];
  const seen = new Set();
  function push({ title, location, href }) {
    title = clean(title);
    const link = absoluteUrl(href, site.url) || site.url;
    if (!title || title.length < 4 || seen.has(link)) return;
    seen.add(link);
    jobs.push({ title, location: clean(location), link });
  }
  $('.job, .vacancy, .job-item, .job-listing, tr.job_listing, .career-item, article').each((_, el) => {
    const card = $(el);
    push({
      title: card.find('h1, h2, h3, h4, a.job-title, .title, td.job-title').first().text(),
      location: card.find('.location, .job-location, .region, .address').first().text(),
      href: card.find('a[href*="job"], a[href*="vacan"], a').first().attr('href'),
    });
  });
  if (!jobs.length) {
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!/\/(job|vacan|position|career)/i.test(href)) return;
      const text = clean($(el).text());
      if (text.length >= 6) push({ title: text, location: '', href });
    });
  }
  return jobs;
}

// Tier B -- Dittojobs-style plain text block pattern: title line, then
// "Reference No: <digits>", then a location line ("<City>, South Africa").
// Confirmed live against abantustaffingsolutions.co.za/jobs/. Deliberately
// walks the DOM in document order collecting one text chunk per leaf
// block element, rather than regexing $('body').text() as one flattened
// string -- once flattened, adjacent entries run together with no
// reliable boundary (an earlier version of this function mismatched
// titles for exactly that reason), whereas each field reliably renders as
// its own block element in the source markup.
function parseTierB(html, site) {
  const $ = cheerio.load(html);
  const blocks = [];
  $('body')
    .find('*')
    .filter((_, el) => $(el).children().length === 0)
    .each((_, el) => {
      const text = clean($(el).text());
      if (text) blocks.push(text);
    });
  const jobs = [];
  for (let i = 1; i < blocks.length - 1; i += 1) {
    const refMatch = blocks[i].match(/^Reference No:\s*(\d+)/);
    if (!refMatch) continue;
    const title = blocks[i - 1];
    const location = blocks[i + 1];
    if (!title || !/, South Africa$/.test(location)) continue;
    const link = `${site.url.replace(/\/$/, '')}#ref-${refMatch[1]}`;
    jobs.push({ title, location, link });
  }
  return jobs;
}

export function parseAgencySiteJobs(html, site) {
  const tierA = parseTierA(html, site);
  if (tierA.length) return tierA;
  return parseTierB(html, site);
}

export function buildCandidateUrls(agency) {
  const base = normalizeWebsite(agency.website);
  if (!base) return [];
  const candidates = [];
  const seen = new Set();
  function add(url) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(url);
  }
  if (agency.site_vacancy_url) add(agency.site_vacancy_url); // cached winner first
  for (const path of CANDIDATE_PATHS) add(absoluteUrl(path, base));
  return candidates;
}

// Discovery probes use a short timeout and a single attempt -- across up to
// 12 candidate paths per agency, waiting out the full REQUEST_TIMEOUT_MS /
// FETCH_ATTEMPTS budget on every one of them would make a single dead site
// eat minutes. A candidate that times out here just gets picked up again
// on a later scheduled run (rotation), so there's little lost by probing
// fast and moving on.
const DISCOVERY_TIMEOUT_MS = parsePositiveInt(process.env.AGENCY_SITES_DISCOVERY_TIMEOUT_MS, 8_000);

// Tries each candidate URL in order and returns the first one that's
// robots-allowed, fetchable, and parses to at least one job. Every
// candidate is recorded in `attempts` (with why it didn't work) so a total
// failure can be classified and explained rather than just logged as "0
// jobs". Stops early on a 'network' error (DNS/connection/timeout) since
// that means the host itself is down -- the remaining paths on the same
// host would all fail the same way, so there's no point burning the time
// to prove it 11 more times.
async function discoverVacancyPage(agency) {
  const attempts = [];
  for (const url of buildCandidateUrls(agency)) {
    const site = { name: agency.name, url };
    if (!(await robotsAllows(url))) { attempts.push({ url, reason: 'blocked by robots.txt' }); continue; }
    let html;
    try {
      html = await fetchText(url, { timeoutMs: DISCOVERY_TIMEOUT_MS, attempts: 1 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ url, reason: `unreachable (${message})` });
      if (error?.kind === 'network') break; // host itself is down -- stop probing it
      continue;
    }
    const jobs = parseAgencySiteJobs(html, site);
    if (jobs.length) return { url, jobs, attempts };
    attempts.push({ url, reason: 'fetched OK but no parseable jobs' });
  }
  return { url: null, jobs: [], attempts };
}

// Classifies a fully-failed site (no candidate produced jobs) from its
// attempt log, for the site_scrape_status column.
export function classifySite(attempts) {
  if (!attempts.length) return { status: 'skipped_unreachable', reason: 'agency has no usable website URL' };
  if (attempts.every((a) => a.reason.includes('robots.txt'))) {
    return { status: 'skipped_robots', reason: 'every candidate page is disallowed by robots.txt' };
  }
  if (attempts.every((a) => a.reason.startsWith('unreachable'))) {
    return { status: 'skipped_unreachable', reason: `all candidates unreachable: ${attempts.map((a) => `${a.url} (${a.reason})`).join('; ')}` };
  }
  return { status: 'skipped_no_jobs', reason: `no candidate yielded parseable jobs: ${attempts.map((a) => `${a.url} (${a.reason})`).join('; ')}` };
}

async function upsertJobs(jobs) {
  if (!jobs.length) return 0;
  const links = jobs.map((j) => j.link);
  const { data: existingJobs, error: existingError } = await supabase.from('vacancies').select('id,link').in('link', links).limit(500);
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((j) => [j.link, j.id]));
  const rows = jobs.map((j) => ({ ...j, id: existingByLink.get(j.link) || j.id }));
  const { error } = await supabase.from('vacancies').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows.length;
}

async function markStatus(agencyId, fields) {
  const { error } = await supabase.from('agencies').update({ ...fields, site_scraped_at: new Date().toISOString() }).eq('id', agencyId);
  if (error) console.error(`[agency-sites] failed to save status for agency ${agencyId}: ${error.message}`);
}

async function scrapeSite(agency) {
  const { url, jobs: parsed, attempts } = await discoverVacancyPage(agency);
  if (!url) {
    const { status, reason } = classifySite(attempts);
    console.log(`[agency-sites] ${agency.name}: ${status} -- ${reason}`);
    await markStatus(agency.id, { site_scrape_status: status, site_scrape_reason: reason, site_vacancy_url: null });
    return 0;
  }
  const jobs = parsed.map((job) => ({
    ...job,
    id: jobId(agency.name, job.link),
    employer_id: null,
    email: '', phone: '', remote: null, experience_level: '', employment_type: '',
    contract_type: '', work_schedule: '', hours: '', salary: '', start_date: '', notes: '', closing_date: '',
    source_type: 'agency',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    agency_id: agency.id,
    company: agency.name,
    company_photo: agency.photo || null,
  }));
  const count = await upsertJobs(jobs);
  console.log(`[agency-sites] ${agency.name}: parsed ${jobs.length}, upserted ${count} (${url})`);
  await markStatus(agency.id, { site_scrape_status: 'ok', site_scrape_reason: null, site_vacancy_url: url });
  return count;
}

export async function runAgencySiteScraper() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  // Agencies without a Pnet page are ours to cover, oldest-checked first so
  // a single run rotates through the whole ~140-agency directory over
  // several scheduled runs instead of hammering every site every time.
  const { data: agencies, error } = await supabase
    .from('agencies')
    .select('id,name,photo,website,site_vacancy_url,site_scraped_at')
    .not('website', 'is', null)
    .neq('website', '')
    .is('pnet_url', null)
    .order('site_scraped_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) throw error;

  const sites = agencies || [];
  let cursor = 0;
  let total = 0;
  let failures = 0;
  async function worker() {
    while (cursor < sites.length) {
      const agency = sites[cursor++];
      try {
        total += await scrapeSite(agency);
      } catch (err) {
        failures += 1;
        console.error(`[agency-sites] ${agency.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        await markStatus(agency.id, { site_scrape_status: 'error', site_scrape_reason: err instanceof Error ? err.message : String(err) });
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));

  return { sitesAttempted: sites.length, vacanciesUpserted: total, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runAgencySiteScraper();
  console.log(`[agency-sites] completed: ${JSON.stringify(results)}`);
  if (results.failures) process.exitCode = 1;
}

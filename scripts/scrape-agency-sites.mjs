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
// So this script tries two independent parsing strategies per site --
// tierA (CSS card selectors, then a raw anchor-scan fallback -- both from
// the original script this was built from) and tierB (the Dittojobs-style
// "Reference No: ... / Salary: ..." text-block pattern) -- and logs
// whichever, if either, found anything. A site returning 0 from both is
// not necessarily broken code; it may need bespoke handling the way
// jobmail/careerjunction/retail/pnet each got. Do a real dry run
// (node scripts/scrape-agency-sites.mjs) and check the log output before
// trusting a newly-added site in production -- see scrape-agency-sites.test.mjs
// for the fixtures this was built and tested against.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.AGENCY_SITES_REQUEST_TIMEOUT_MS, 15_000);
const FETCH_ATTEMPTS = parsePositiveInt(process.env.AGENCY_SITES_FETCH_ATTEMPTS, 2);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.AGENCY_SITES_REQUEST_DELAY_MS, 1_500);
const CONCURRENCY = parsePositiveInt(process.env.AGENCY_SITES_CONCURRENCY, 3);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersAgencySiteScraper/1.0 (+https://sa-recruiters.co.za)';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

// Directory of target agency vacancy pages. Confirmed-dead URLs from the
// original list are commented out rather than silently shipped -- fix the
// URL and uncomment once you have a working one.
export const AGENCY_SITES = [
  // { name: 'Izwe Placements', url: 'https://izweplacements.co.za/vacancies/' }, // 404 -- needs a real URL
  { name: 'JCM Consultants', url: 'https://jcmconsultants.co.za/jobs/' }, // robots.txt disallows automated fetches -- confirm you're OK scraping this before enabling
  // { name: 'Affirmative Portfolios', url: 'https://affirmativeportfolios.co.za/vacancies/' }, // 404 -- needs a real URL
  { name: 'Abantu Staffing Solutions', url: 'https://www.abantustaffingsolutions.co.za/jobs/' },
  { name: 'Assegai Recruitment', url: 'https://assegai.co.za/vacancies/' }, // robots.txt disallows automated fetches -- confirm you're OK scraping this before enabling
  // { name: 'Ann Swann Personnel', url: 'https://annswann.co.za/vacancies/' }, // no jobs on-site -- listings live at webapp.placementpartner.com, needs its own parser
  { name: 'Assign Services', url: 'https://assign.co.za/vacancies/' },
  { name: 'ASI Personnel', url: 'https://asipersonnel.co.za/vacancies/' },
  { name: 'E-Merge IT Recruitment', url: 'https://e-merge.co.za/vacancies/' },
  { name: 'CA Financial Appointments', url: 'https://ca.co.za/vacancies/' },
  { name: 'Status Staffing', url: 'https://statusstaffing.com/jobs/' },
  // { name: 'Headhunters Recruitment', url: 'https://headhunters.co.za/vacancies/' }, // JS-rendered, nothing in the static HTML
  { name: 'Brites Recruitment', url: 'https://brites.co.za/vacancies/' },
  { name: 'Hospitality Placements', url: 'https://hospitalityplacements.co.za/jobs/' },
];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Same conservative match rule used by scrape-pnet.mjs when tying scraped
// company text back to a real agency: exact match, or one name being a
// clean prefix of the other. Deliberately conservative -- a false match
// here would attribute another company's live jobs to the wrong agency.
function normalizeMatchText(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function isCleanMatch(a, b) {
  if (!a || !b) return false;
  return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(1_500 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

function jobId(siteName, link) {
  return `agency-${crypto.createHash('sha1').update(`${siteName}-${link}`).digest('hex').slice(0, 20)}`;
}

// Tier A -- structural card scan (from the original script): try known
// vacancy-card container selectors first; if none match, fall back to a
// raw anchor scan for links that look like individual job pages.
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

const agencyCache = new Map();
// Resolve the real agencies.id for a site by name, creating a new
// (unverified) agencies row if nothing matches -- these are agencies that
// belong in the directory regardless, so their jobs are attributed
// directly rather than filed as unaffiliated/general.
async function resolveOrCreateAgency(site) {
  if (agencyCache.has(site.name)) return agencyCache.get(site.name);
  const target = normalizeMatchText(site.name);
  const { data: existing, error } = await supabase.from('agencies').select('id,name,photo').limit(5000);
  if (error) throw error;
  const match = (existing || []).find((a) => isCleanMatch(normalizeMatchText(a.name), target));
  if (match) {
    agencyCache.set(site.name, match);
    return match;
  }
  const created = { id: crypto.randomUUID(), name: site.name, website: new URL(site.url).origin, verified: false };
  const { error: insertError } = await supabase.from('agencies').insert(created);
  if (insertError) throw insertError;
  console.log(`[agency-sites] created new agencies row for "${site.name}" (${created.id})`);
  const result = { id: created.id, name: site.name, photo: null };
  agencyCache.set(site.name, result);
  return result;
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

async function scrapeSite(site) {
  let html;
  try {
    html = await fetchHtml(site.url);
  } catch (error) {
    console.error(`[agency-sites] ${site.name} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  const parsed = parseAgencySiteJobs(html, site).map((job) => ({
    ...job,
    id: jobId(site.name, job.link),
    employer_id: null,
    email: '', phone: '', remote: null, experience_level: '', employment_type: '',
    contract_type: '', work_schedule: '', hours: '', salary: '', start_date: '', notes: '', closing_date: '',
    source_type: 'agency',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  }));
  if (!parsed.length) { console.log(`[agency-sites] ${site.name}: 0 jobs found (see selector-strategy note if this persists)`); return 0; }
  const agency = await resolveOrCreateAgency(site);
  const jobs = parsed.map((job) => ({ ...job, agency_id: agency.id, company: agency.name, company_photo: agency.photo || null }));
  const count = await upsertJobs(jobs);
  console.log(`[agency-sites] ${site.name}: parsed ${parsed.length}, upserted ${count}`);
  return count;
}

export async function runAgencySiteScraper(sites = AGENCY_SITES) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let cursor = 0;
  let total = 0;
  let failures = 0;
  async function worker() {
    while (cursor < sites.length) {
      const site = sites[cursor++];
      try { total += await scrapeSite(site); }
      catch (error) {
        failures += 1;
        console.error(`[agency-sites] ${site.name} failed: ${error instanceof Error ? error.message : String(error)}`);
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

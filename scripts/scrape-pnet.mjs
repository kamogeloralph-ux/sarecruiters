import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// Replaces the old fixed-URL Pnet scraper (3 hardcoded agencies) and the
// retired Job Mail scraper. Pnet is South Africa's largest job board and
// almost every agency in our directory maintains a company page there
// listing their own live vacancies in one consistent, scrapable format --
// so instead of a bespoke scraper per agency website, this script:
//   1. For agencies without a known Pnet company page (agencies.pnet_url),
//      discovers one by searching Pnet for the agency name and matching the
//      resulting company links against the agency's name.
//   2. For agencies with a known page, scrapes every vacancy on it and
//      upserts it with that agency's real agency_id (never "general").
// Discovered URLs are written back to agencies.pnet_url so future runs skip
// straight to scraping. Agencies are rotated using last_scraped_at (oldest
// first) so a single run never has to hit all of them at once.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_AGENT = 'SARecruitersPnetScraper/1.0 (+https://sa-recruiters.co.za)';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.PNET_REQUEST_TIMEOUT_MS || '30000', 10);
const FETCH_ATTEMPTS = Number.parseInt(process.env.PNET_FETCH_ATTEMPTS || '2', 10);
const MAX_PAGES_PER_AGENCY = Number.parseInt(process.env.PNET_MAX_PAGES || '5', 10);
const DISCOVERY_BATCH_SIZE = Number.parseInt(process.env.PNET_DISCOVERY_BATCH || '15', 10);
const SCRAPE_BATCH_SIZE = Number.parseInt(process.env.PNET_SCRAPE_BATCH || '25', 10);
const REQUEST_DELAY_MS = Number.parseInt(process.env.PNET_REQUEST_DELAY_MS || '1200', 10);

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
function htmlToText(value) {
  return clean(cheerio.load(`<div>${value || ''}</div>`).text());
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function slugifyForSearch(name) {
  return clean(name)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bpty\s*ltd\b|\bcc\b|\bltd\b|\blimited\b|\bsa\b|\binc\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
// Same loose-match rule used elsewhere in this project when tying a company
// name back to an agency: exact match, or one name being a clean prefix of
// the other. Deliberately conservative -- a false match here would attribute
// another company's live jobs to the wrong agency.
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
        headers: { accept: 'text/html', 'user-agent': USER_AGENT },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(1500 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

// Search Pnet's own keyword search for the agency name and look for a
// /cmp/en/{slug}-{id}/ company link whose visible name matches closely.
export async function discoverPnetUrl(agencyName) {
  const query = slugifyForSearch(agencyName);
  if (!query) return null;
  const target = normalizeMatchText(agencyName);
  let html;
  try {
    html = await fetchHtml(`https://www.pnet.co.za/jobs/${query}`);
  } catch (error) {
    console.error(`[pnet:discover] search failed for "${agencyName}": ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const $ = cheerio.load(html);
  const candidates = new Map();
  $('a[href*="/cmp/en/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/cmp\/en\/([a-z0-9-]+)-(\d+)(?:[/?]|$)/i);
    if (!match) return;
    const [, slug, id] = match;
    const key = `${slug.toLowerCase()}-${id}`;
    if (candidates.has(key)) return;
    const label = clean($(el).text()) || slug.replace(/-/g, ' ');
    candidates.set(key, { slug, id, name: normalizeMatchText(label) });
  });
  const best = Array.from(candidates.values()).find((c) => isCleanMatch(c.name, target));
  if (!best) return null;
  return `https://www.pnet.co.za/cmp/en/${best.slug}-${best.id}/jobs`;
}

function extractJobLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Map();
  $('a[href*="/jobs--"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/-{2}(\d+)-inline\.html/);
    if (!match) return;
    const absolute = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    links.set(match[1], absolute);
  });
  return Array.from(links.entries()).map(([id, link]) => ({ id, link }));
}

function hasNextPage(html) {
  const $ = cheerio.load(html);
  return $('a[href*="page="]').toArray().some((el) => /next/i.test($(el).text() || '') || /next/i.test($(el).attr('aria-label') || ''));
}

// Pnet, like most SEO-driven job boards, embeds a schema.org JobPosting
// block on every listing page for Google for Jobs -- read that first since
// it gives clean structured fields. Fall back to basic tag scraping for any
// listing that omits it rather than failing the whole job.
function parseJobPostingJsonLd(html) {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data;
    try { data = JSON.parse($(el).contents().text()); } catch (e) { continue; }
    const items = Array.isArray(data) ? data : [data];
    const posting = items.find((item) => item && (item['@type'] === 'JobPosting' || (Array.isArray(item['@type']) && item['@type'].includes('JobPosting'))));
    if (posting) return posting;
  }
  return null;
}
function mapEmploymentType(value) {
  const v = clean(value).toUpperCase();
  if (!v) return '';
  if (v.includes('PART')) return 'Part time';
  if (v.includes('TEMP') || v.includes('CONTRACT')) return 'Contract';
  if (v.includes('INTERN')) return 'Internship';
  if (v.includes('FULL')) return 'Full time';
  return '';
}
function fallbackTitle($) {
  return clean($('h1').first().text());
}
function fallbackLocation($) {
  return clean($('[class*="location" i]').first().text());
}

export function parsePnetJobDetail(html, { id, link, agency }) {
  const $ = cheerio.load(html);
  const posting = parseJobPostingJsonLd(html);
  const title = clean(posting?.title) || fallbackTitle($);
  if (!title) return null;
  const location = clean(
    posting?.jobLocation?.address?.addressLocality
    || posting?.jobLocation?.address?.addressRegion
    || (Array.isArray(posting?.jobLocation) ? posting.jobLocation[0]?.address?.addressLocality : '')
  ) || fallbackLocation($);
  const description = posting?.description ? htmlToText(posting.description).slice(0, 20_000) : '';
  return {
    id: `pnet-${id}`,
    agency_id: agency.id,
    employer_id: null,
    title,
    company: agency.name,
    company_photo: agency.photo || null,
    location,
    closing_date: clean(posting?.validThrough || '').slice(0, 10),
    notes: description,
    link,
    email: '',
    phone: '',
    remote: null,
    experience_level: '',
    employment_type: mapEmploymentType(posting?.employmentType || (Array.isArray(posting?.employmentType) ? posting.employmentType[0] : '')),
    contract_type: '',
    work_schedule: '',
    hours: '',
    salary: '',
    start_date: '',
    source_type: 'pnet',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  };
}

async function scrapeAgencyJobs(pnetUrl, agency) {
  const jobs = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES_PER_AGENCY; page += 1) {
    const pageUrl = page === 1 ? pnetUrl : `${pnetUrl}?page=${page}&cmpId=${encodeURIComponent(agency.id)}`;
    let html;
    try {
      html = await fetchHtml(pageUrl);
    } catch (error) {
      console.error(`[pnet:${agency.name}] page ${page} failed: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    const links = extractJobLinks(html, pageUrl).filter((j) => !seen.has(j.id));
    if (!links.length) break;
    links.forEach((j) => seen.add(j.id));
    for (const { id, link } of links) {
      await sleep(REQUEST_DELAY_MS);
      try {
        const detailHtml = await fetchHtml(link);
        const job = parsePnetJobDetail(detailHtml, { id, link, agency });
        if (job) jobs.push(job);
      } catch (error) {
        console.error(`[pnet:${agency.name}] detail failed for ${link}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!hasNextPage(html)) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return jobs;
}

async function upsertJobs(jobs) {
  if (!jobs.length) return 0;
  const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
  if (error) throw error;
  return jobs.length;
}

export async function runPnetScraper() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const results = { discovered: 0, discoveryFailed: 0, agenciesScraped: 0, vacanciesUpserted: 0 };

  // Phase 1: find Pnet pages for agencies we don't have one for yet.
  const { data: undiscovered, error: undiscoveredError } = await supabase
    .from('agencies')
    .select('id,name')
    .is('pnet_url', null)
    .order('name', { ascending: true })
    .limit(DISCOVERY_BATCH_SIZE);
  if (undiscoveredError) throw undiscoveredError;
  for (const agency of undiscovered || []) {
    await sleep(REQUEST_DELAY_MS);
    const found = await discoverPnetUrl(agency.name);
    if (found) {
      results.discovered += 1;
      const { error } = await supabase.from('agencies').update({ pnet_url: found }).eq('id', agency.id);
      if (error) console.error(`[pnet:discover] failed to save url for ${agency.name}: ${error.message}`);
      else console.log(`[pnet:discover] ${agency.name} -> ${found}`);
    } else {
      results.discoveryFailed += 1;
    }
  }

  // Phase 2: scrape agencies with a known page, oldest-scraped first, so a
  // single scheduled run rotates through the whole directory over time
  // instead of hammering Pnet with 100+ requests every run.
  const { data: dueAgencies, error: dueError } = await supabase
    .from('agencies')
    .select('id,name,photo,pnet_url,last_scraped_at')
    .not('pnet_url', 'is', null)
    .order('last_scraped_at', { ascending: true, nullsFirst: true })
    .limit(SCRAPE_BATCH_SIZE);
  if (dueError) throw dueError;
  for (const agency of dueAgencies || []) {
    const jobs = await scrapeAgencyJobs(agency.pnet_url, agency);
    console.log(`[pnet:${agency.name}] found ${jobs.length} vacancies`);
    try {
      results.vacanciesUpserted += await upsertJobs(jobs);
      results.agenciesScraped += 1;
    } catch (error) {
      console.error(`[pnet:${agency.name}] upsert failed: ${error.message}`);
    }
    await supabase.from('agencies').update({ last_scraped_at: new Date().toISOString() }).eq('id', agency.id);
    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPnetScraper();
  console.log(`[pnet] completed: ${JSON.stringify(results)}`);
}

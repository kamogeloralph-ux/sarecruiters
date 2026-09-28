import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

// Public Careers Page portals used by Crew Life at Sea, Gourmet Recruitment
// International, and Waitre d' Recruitment. The portals render stable /job/{id}
// links and JobPosting JSON-LD on each detail page, so this scraper uses
// ordinary GET requests only. Waitred's public site is the listing page, while
// its detail pages are hosted on its Careers-Page portal.
// It never submits /apply or /refer forms and stops rather than deleting records
// when the listing page or detail pages look unexpectedly empty.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = positiveInt(process.env.CAREERS_PAGE_TIMEOUT_MS, 15_000);
const FETCH_ATTEMPTS = positiveInt(process.env.CAREERS_PAGE_FETCH_ATTEMPTS, 2);
const REQUEST_DELAY_MS = positiveInt(process.env.CAREERS_PAGE_DELAY_MS, 350);
const CONCURRENCY = positiveInt(process.env.CAREERS_PAGE_CONCURRENCY, 3);
const MAX_JOBS = positiveInt(process.env.CAREERS_PAGE_MAX_JOBS, 1_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersCareersPageScraper/1.0 (+https://sa-recruiters.co.za)';

export const SOURCES = {
  crew: {
    key: 'crew-life-at-sea',
    label: 'Crew Life at Sea',
    url: 'https://careers-page.com/crew-life-at-sea',
    company: 'Crew Life at Sea',
  },
  gourmet: {
    key: 'gourmet-recruitment-international',
    label: 'Gourmet Recruitment International',
    url: 'https://careers-page.com/gourmet-recruitment-international',
    company: 'Gourmet Recruitment International',
  },
  waitred: {
    key: 'waitred-recruitment',
    label: "Waitre d' Recruitment",
    url: 'https://waitred.co.za/current-positions-available/',
    jobOrigin: 'https://www.careers-page.com',
    jobPath: '/waitred-recruitment',
    company: "Waitre d' Recruitment",
    defaultLocation: 'Cape Town, South Africa',
    defaultEmploymentType: 'Contract',
  },
};

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}
function htmlToText(value) {
  const $ = cheerio.load(`<div>${value || ''}</div>`);
  return clean($.text()).slice(0, 20_000);
}
function idFor(source, link) {
  const digest = crypto.createHash('sha1').update(`${source.key}|${link}`).digest('hex').slice(0, 20);
  return `careers-page-${source.key}-${digest}`;
}

async function fetchText(url) {
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
      const type = response.headers.get('content-type') || '';
      if (type && !/html/i.test(type)) throw new Error(`unsupported content-type: ${type}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(1_000 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function jsonLdValues(html) {
  const $ = cheerio.load(html || '');
  const values = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      if (Array.isArray(parsed)) values.push(...parsed);
      else if (parsed?.['@graph'] && Array.isArray(parsed['@graph'])) values.push(...parsed['@graph']);
      else values.push(parsed);
    } catch (_) { /* Ignore unrelated or malformed JSON-LD. */ }
  });
  return values;
}
function findJobPosting(html) {
  return jsonLdValues(html).find((value) => {
    const type = value?.['@type'];
    return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
  }) || null;
}
function extractJobLinks(html, sourceUrl, source = {}) {
  const $ = cheerio.load(html || '');
  const base = new URL(source.jobOrigin || sourceUrl);
  const sourcePath = (source.jobPath || base.pathname).replace(/\/$/, '');
  const links = new Map();
  const escapedSourcePath = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  $('a[href]').each((_, anchor) => {
    const href = absoluteUrl($(anchor).attr('href'), sourceUrl);
    if (!href) return;
    const url = new URL(href);
    if (url.origin !== base.origin) return;
    const match = url.pathname.match(new RegExp(`^${escapedSourcePath}/job/([A-Za-z0-9]+)$`, 'i'));
    if (!match) return;
    links.set(url.toString(), { link: url.toString(), listingTitle: clean($(anchor).text()) });
  });
  return [...links.values()];
}
function addressFor(job) {
  const address = job?.jobLocation?.address;
  if (Array.isArray(address)) return clean(address.map(addressFor).filter(Boolean).join(', '));
  if (typeof address === 'string') return clean(address);
  return clean([
    address?.addressLocality,
    address?.addressRegion,
    address?.addressCountry,
  ].filter(Boolean).join(', '));
}
function parseDetail(html, summary, source) {
  const $ = cheerio.load(html || '');
  const jsonJob = findJobPosting(html);
  const title = clean(jsonJob?.title || $('h1').first().text() || summary.listingTitle);
  if (!title || title.length < 3) return null;
  const descriptionHtml = jsonJob?.description || $('h4.redactor-styles').first().html() || $('main').first().html() || '';
  const location = addressFor(jsonJob) || clean($('body').text().match(/Working Place:\s*([^\n]+)/i)?.[1]) || source.defaultLocation || '';
  const organization = typeof jsonJob?.hiringOrganization === 'object' ? jsonJob.hiringOrganization.name : '';
  const link = summary.link;
  return {
    id: idFor(source, link),
    agency_id: 'general',
    employer_id: null,
    title,
    company: clean(organization || source.company),
    company_photo: '',
    location,
    closing_date: clean(jsonJob?.validThrough || ''),
    notes: htmlToText(descriptionHtml),
    link,
    email: '', phone: '', remote: null,
    experience_level: '',
    employment_type: clean(jsonJob?.employmentType || source.defaultEmploymentType || ''),
    contract_type: '', work_schedule: '', hours: '', salary: '', start_date: '',
    source_type: 'careers_page',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  };
}

export function parseListing(html, source) {
  return extractJobLinks(html, source.url, source);
}
export function parseJobDetail(html, summary, source) {
  return parseDetail(html, summary, source);
}

async function fetchSource(source) {
  const listingHtml = await fetchText(source.url);
  const summaries = extractJobLinks(listingHtml, source.url, source);
  if (!summaries.length) throw new Error(`${source.label}: no public /job/{id} links found`);
  const selected = summaries.slice(0, MAX_JOBS);
  if (summaries.length > selected.length) {
    console.warn(`[careers-page:${source.key}] limiting ${summaries.length} discovered jobs to ${selected.length}; set CAREERS_PAGE_MAX_JOBS to raise the cap`);
  }
  const jobs = [];
  let failures = 0;
  for (let i = 0; i < selected.length; i += CONCURRENCY) {
    const batch = selected.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (summary) => {
      try { return parseDetail(await fetchText(summary.link), summary, source); }
      catch (error) {
        failures += 1;
        console.warn(`[careers-page:${source.key}] detail failed ${summary.link}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }));
    jobs.push(...results.filter(Boolean));
    if (i + CONCURRENCY < selected.length) await sleep(REQUEST_DELAY_MS);
  }
  if (!jobs.length) throw new Error(`${source.label}: all detail pages failed or changed shape`);
  return { source, discovered: summaries.length, jobs, failures, complete: selected.length === summaries.length };
}

async function removeClosed(source, liveIds) {
  const prefix = `careers-page-${source.key}-`;
  const { data, error } = await supabase.from('vacancies').select('id').like('id', `${prefix}%`).limit(2_000);
  if (error) throw error;
  const stale = (data || []).map((row) => row.id).filter((id) => !liveIds.has(id));
  if (!stale.length) return 0;
  const { error: deleteError } = await supabase.from('vacancies').delete().in('id', stale);
  if (deleteError) throw deleteError;
  return stale.length;
}
async function upsertJobs(jobs) {
  const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
  if (error) throw error;
  return jobs.length;
}

export async function runSource(source, { dryRun = false } = {}) {
  const result = await fetchSource(source);
  console.log(`[careers-page:${source.key}] discovered ${result.discovered}, parsed ${result.jobs.length}, detail failures ${result.failures}`);
  if (dryRun) {
    result.jobs.slice(0, 3).forEach((job) => console.log(`[careers-page:${source.key}] sample`, JSON.stringify({ ...job, notes: job.notes.slice(0, 250) })));
    return { source: source.key, fetched: result.jobs.length, upserted: 0, removed: 0, dryRun: true };
  }
  const upserted = await upsertJobs(result.jobs);
  let removed = 0;
  // Only remove stale records when every discovered listing was processed and
  // every detail page succeeded. A partial run must never delete live jobs.
  if (result.complete && result.failures === 0) removed = await removeClosed(source, new Set(result.jobs.map((job) => job.id)));
  else console.warn(`[careers-page:${source.key}] skipped stale cleanup because the run was partial`);
  return { source: source.key, fetched: result.jobs.length, upserted, removed, dryRun: false };
}

export function selectSources(only = process.env.CAREERS_PAGE_ONLY || '') {
  const keys = only.split(',').map((key) => key.trim().toLowerCase()).filter(Boolean);
  if (!keys.length) return Object.values(SOURCES);
  const unknown = keys.filter((key) => !SOURCES[key]);
  if (unknown.length) throw new Error(`Unknown CAREERS_PAGE_ONLY source(s): ${unknown.join(', ')}. Known: ${Object.keys(SOURCES).join(', ')}`);
  return keys.map((key) => SOURCES[key]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.env.DRY_RUN === '1';
  if (!supabase && !dryRun) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let failures = 0;
  let total = 0;
  for (const source of selectSources()) {
    try {
      const summary = await runSource(source, { dryRun });
      total += summary.upserted;
      console.log(`[careers-page:${source.key}] complete`, JSON.stringify(summary));
    } catch (error) {
      failures += 1;
      console.error(`[careers-page:${source.key}] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!total && !dryRun && !failures) {
    console.error('[careers-page] no vacancies were upserted; refusing a green empty run');
    failures = 1;
  }
  if (failures) process.exitCode = 1;
}

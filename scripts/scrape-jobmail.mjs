import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GENERAL_URL = process.env.JOBMAIL_GENERAL_URL || 'https://www.jobmail.co.za/jobs';
const PAGE_COUNT = parsePositiveInt(process.env.JOBMAIL_PAGES, 3);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.JOBMAIL_REQUEST_DELAY_MS, 1_000);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.JOBMAIL_REQUEST_TIMEOUT_MS, 60_000);
const FETCH_ATTEMPTS = parsePositiveInt(process.env.JOBMAIL_FETCH_ATTEMPTS, 2);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersJobMailScraper/1.0 (+https://sa-recruiters.co.za)';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
let agencyDirectoryPromise;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}
function extractJobId(value) { return String(value ?? '').match(/-id-(\d+)(?:[/?#]|$)/i)?.[1] || null; }
function normalizeAgencyName(value) { return clean(value).toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, ''); }
const AGENCY_ALIASES = new Map([
  ['fusionpersonnel', 'Fusion Recruitment'],
  ['dcvsabenzaitandrecruitment', 'Sabenza IT Recruitment'],
]);
export function agencyIdForCompany(company, agencies) {
  const normalized = normalizeAgencyName(company);
  if (!normalized) return 'general';
  const target = normalizeAgencyName(AGENCY_ALIASES.get(normalized) || company);
  return (agencies || []).find((agency) => normalizeAgencyName(agency.name) === target)?.id || 'general';
}

export function parseJobMailJobs(html, pageUrl = GENERAL_URL) {
  const $ = cheerio.load(html);
  const jobs = [];
  const seen = new Set();
  $('.results-item[id^="results-item-"]').each((_, element) => {
    const card = $(element);
    const anchor = card.find('a[id^="jobDetailUrl-"][href]').first();
    const href = anchor.attr('href');
    const link = absoluteUrl(href, pageUrl);
    const jobId = extractJobId(href) || clean(card.attr('id')).replace(/^results-item-/, '');
    const title = clean(anchor.find('h3').text() || anchor.text());
    if (!jobId || !link || !title || seen.has(jobId)) return;
    seen.add(jobId);
    const posted = clean(card.find('.job-posted').first().text());
    jobs.push({
      id: `jobmail-${jobId}`,
      title,
      company: clean(card.find('.company').first().text()),
      location: clean(card.find('.job-location').first().text()),
      notes: posted.slice(0, 20_000),
      link,
      source_type: 'agency',
      source_checked_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    });
  });
  return jobs;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchPage(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT } });
      if (!response.ok) throw new Error(`Job Mail returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        console.warn(`[jobmail] request attempt ${attempt} failed for ${url}: ${error instanceof Error ? error.message : String(error)}; retrying`);
        await sleep(2_000);
      }
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}
function pageUrlFor(page) { return page <= 1 ? GENERAL_URL : `${GENERAL_URL.replace(/\/$/, '')}/page${page}`; }
async function loadAgencyDirectory() {
  if (!agencyDirectoryPromise) {
    agencyDirectoryPromise = supabase.from('agencies').select('id,name').limit(1000)
      .then(({ data, error }) => { if (error) throw error; return data || []; });
  }
  return agencyDirectoryPromise;
}
async function upsertJobs(parsedJobs) {
  const agencies = await loadAgencyDirectory();
  const links = parsedJobs.map((job) => job.link);
  const { data: existingJobs, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((job) => [job.link, job.id]));
  const jobs = parsedJobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id, agency_id: agencyIdForCompany(job.company, agencies) }));
  if (jobs.length) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}
async function scrapePage(page) {
  const url = pageUrlFor(page);
  console.log(`[jobmail] page ${page}: fetching ${url}`);
  const parsed = parseJobMailJobs(await fetchPage(url), url);
  const jobs = await upsertJobs(parsed);
  console.log(`[jobmail] page ${page}: parsed ${parsed.length}, upserted ${jobs.length}`);
  return jobs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let failures = 0;
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    try { await scrapePage(page); }
    catch (error) { failures += 1; console.error(`[jobmail] page ${page}: ${error instanceof Error ? error.message : String(error)}`); }
    if (page < PAGE_COUNT) await sleep(REQUEST_DELAY_MS);
  }
  if (failures) process.exitCode = 1;
}

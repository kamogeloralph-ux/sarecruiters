import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKDAY_BASE = 'https://picknpay.wd3.myworkdayjobs.com';
const WORKDAY_TENANT = 'picknpay';
const WORKDAY_SITE = 'PNP_Careers';
const WORKDAY_SEARCH = `${WORKDAY_BASE}/wday/cxs/${WORKDAY_TENANT}/${WORKDAY_SITE}/jobs`;
const WORKDAY_SITE_URL = `${WORKDAY_BASE}/${WORKDAY_SITE}`;
const PAGE_SIZE = Math.min(Math.max(Number.parseInt(process.env.RETAIL_PAGE_SIZE || '20', 10), 1), 20);
const DETAIL_CONCURRENCY = Math.min(Math.max(Number.parseInt(process.env.RETAIL_DETAIL_CONCURRENCY || '4', 10), 1), 8);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.RETAIL_REQUEST_TIMEOUT_MS || '60000', 10);
const FETCH_ATTEMPTS = Number.parseInt(process.env.RETAIL_FETCH_ATTEMPTS || '2', 10);
const USER_AGENT = 'SA-Recruiters-Retail-Scraper/1.0 (+https://sa-recruiters.co.za/)';
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
function absoluteJobUrl(externalPath) {
  return `${WORKDAY_SITE_URL}${externalPath.startsWith('/') ? externalPath : `/${externalPath}`}`;
}
function idForJob(job) { return `retail-pnp-${job.jobReqId || job.jobPostingId}`; }

export function parsePickNPaySearch(payload) {
  if (!payload || !Array.isArray(payload.jobPostings)) return [];
  return payload.jobPostings
    .filter((job) => job && job.title && job.externalPath)
    .map((job) => ({
      title: clean(job.title),
      location: clean(job.locationsText),
      link: absoluteJobUrl(job.externalPath),
      externalPath: job.externalPath,
    }));
}

export function parsePickNPayDetail(payload, summary) {
  const info = payload && payload.jobPostingInfo;
  if (!info || !info.title || !summary?.link) return null;
  const jobReqId = clean(info.jobReqId || info.jobPostingId || summary.externalPath.split('_').pop());
  return {
    id: idForJob({ jobReqId, jobPostingId: info.jobPostingId }),
    agency_id: 'general',
    employer_id: null,
    title: clean(info.title),
    company: 'Pick n Pay',
    location: clean(info.location || summary.location),
    closing_date: '',
    notes: htmlToText(info.jobDescription).slice(0, 20_000),
    link: summary.link,
    email: '',
    phone: '',
    remote: 'No',
    experience_level: '',
    employment_type: clean(info.timeType || 'Full time'),
    contract_type: '',
    work_schedule: '',
    hours: '',
    salary: '',
    start_date: clean(info.startDate),
    source_type: 'retail',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  };
}

async function fetchJson(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT, ...(options.headers || {}) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(1500 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

export async function fetchPickNPayJobs() {
  const summaries = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await fetchJson(WORKDAY_SEARCH, {
      method: 'POST',
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' }),
    });
    const page = parsePickNPaySearch(payload);
    summaries.push(...page);
    console.log(`[retail:pnp] search offset ${offset}: ${page.length} jobs`);
    if (page.length < PAGE_SIZE || summaries.length >= Number(payload.total || 0)) break;
  }
  return summaries;
}

async function fetchDetails(summaries) {
  const jobs = [];
  let cursor = 0;
  async function worker() {
    while (cursor < summaries.length) {
      const summary = summaries[cursor++];
      try {
        const payload = await fetchJson(`${WORKDAY_BASE}/wday/cxs/${WORKDAY_TENANT}/${WORKDAY_SITE}${summary.externalPath}`);
        const job = parsePickNPayDetail(payload, summary);
        if (job) jobs.push(job);
      } catch (error) {
        console.error(`[retail:pnp] detail failed for ${summary.link}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, summaries.length) }, worker));
  return jobs;
}

async function upsertJobs(jobs) {
  if (!jobs.length) return 0;
  const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
  if (error) throw error;
  return jobs.length;
}

export async function runRetailGroupScraper() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const results = { picknpay: 0, shoprite: 0, spar: 0 };
  const summaries = await fetchPickNPayJobs();
  results.picknpay = await upsertJobs(await fetchDetails(summaries));
  // Shoprite's public store portal is currently a registration/talent-pool flow,
  // not a public vacancy feed. SPAR directs applicants to Pnet; do not duplicate
  // or scrape it here while the Pnet source is being replaced.
  console.log('[retail:shoprite] skipped: no public store-vacancy feed exposed');
  console.log('[retail:spar] skipped: retailer directs vacancies to Pnet');
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runRetailGroupScraper();
  console.log(`[retail] completed: ${JSON.stringify(results)}`);
}

import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HIMALAYAS_COUNTRY = process.env.HIMALAYAS_COUNTRY || 'ZA';
const PAGE_COUNT = Number.parseInt(process.env.HIMALAYAS_PAGES || '5', 10);
const PAGE_SIZE = Math.min(Math.max(Number.parseInt(process.env.HIMALAYAS_PAGE_SIZE || '20', 10) || 20, 1), 20);
const REQUEST_DELAY_MS = Number.parseInt(process.env.HIMALAYAS_REQUEST_DELAY_MS || '1500', 10);
const API_URL = 'https://himalayas.app/jobs/api/search';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
  return clean(String(value ?? '').replace(/<[^>]*>/g, ' '));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobSlug(job) {
  const source = clean(job?.slug) || clean(job?.guid).split('/').filter(Boolean).pop();
  return source ? source.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) : '';
}

function formatSalary(job) {
  if (job?.minSalary == null && job?.maxSalary == null) return '';
  const currency = clean(job.currency) || 'USD';
  const period = clean(job.salaryPeriod);
  const min = job.minSalary != null ? Number(job.minSalary).toLocaleString('en-US') : '';
  const max = job.maxSalary != null ? Number(job.maxSalary).toLocaleString('en-US') : '';
  const range = min && max && min !== max ? `${min} - ${max}` : (min || max);
  return `${currency} ${range}${period ? ` (${period})` : ''}`;
}

function formatLocation(job) {
  const restrictions = Array.isArray(job?.locationRestrictions) ? job.locationRestrictions : [];
  return restrictions.length ? `Remote · ${restrictions.includes('South Africa') ? 'South Africa eligible' : restrictions.slice(0, 3).join(', ')}` : 'Remote';
}

// Maps Himalayas /jobs/api/search results into the shared vacancy shape.
export function mapHimalayasResults(payload) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const now = new Date().toISOString();
  return jobs.map((job) => {
    const slug = jobSlug(job);
    const link = clean(job?.applicationLink) || clean(job?.guid);
    const title = clean(job?.title);
    if (!slug || !link || !title) return null;
    const salary = formatSalary(job);
    const employment = clean(job?.employmentType);
    const excerpt = stripHtml(job?.excerpt);
    const description = stripHtml(job?.description);
    const notes = clean([salary, employment, excerpt || description].filter(Boolean).join(' · ')).slice(0, 20_000);
    return {
      id: `himalayas-${slug}`,
      title,
      company: clean(job?.companyName) || 'Himalayas employer',
      location: formatLocation(job),
      notes,
      link,
      remote: 'Remote',
      source_type: 'himalayas',
      source_checked_at: now,
      last_verified_at: now,
    };
  }).filter(Boolean);
}

async function fetchPage(page) {
  const url = new URL(API_URL);
  url.searchParams.set('country', HIMALAYAS_COUNTRY);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Himalayas returned HTTP ${response.status}`);
  return body;
}

async function upsertJobs(mappedJobs) {
  const links = mappedJobs.map((job) => job.link);
  const { data: existingJobs, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((job) => [job.link, job.id]));
  const jobs = mappedJobs.map((job) => ({
    ...job,
    id: existingByLink.get(job.link) || job.id,
    agency_id: 'general',
  }));
  if (jobs.length) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}

async function syncPage(page) {
  console.log(`[himalayas] page ${page}: fetching ${HIMALAYAS_COUNTRY}-eligible remote jobs`);
  const payload = await fetchPage(page);
  const mapped = mapHimalayasResults(payload);
  const jobs = await upsertJobs(mapped);
  console.log(`[himalayas] page ${page}: parsed ${mapped.length}, upserted ${jobs.length}`);
  return jobs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let failures = 0;
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    try {
      await syncPage(page);
    } catch (error) {
      failures += 1;
      console.error(`[himalayas] page ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page < PAGE_COUNT) await sleep(REQUEST_DELAY_MS);
  }
  if (failures) process.exitCode = 1;
}

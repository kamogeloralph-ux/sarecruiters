import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

export const INTERCON_INDEX_URL = 'https://www.interconrecruitment.co.za/jobs-2';
export const INTERCON_ORIGIN = new URL(INTERCON_INDEX_URL).origin;
const INTERCON_AGENCY_NAME = 'Intercon Recruitment Gauteng';
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersInterconSync/1.0 (+https://sa-recruiters.co.za)';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function clean(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#010;|&#x0a;|\\n/gi, '\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function stableId(url) {
  return `agency-${crypto.createHash('sha1').update(`Intercon Recruitment-${url}`).digest('hex').slice(0, 20)}`;
}

export function parseInterconIndex(html) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href]').each((_, element) => {
    const raw = $(element).attr('href') || '';
    let url;
    try { url = new URL(raw, INTERCON_INDEX_URL); } catch { return; }
    if (url.origin !== INTERCON_ORIGIN || !url.pathname.startsWith('/jobs-2/') || url.pathname === '/jobs-2/') return;
    url.hash = '';
    links.add(url.toString());
  });
  return [...links];
}

function readJobPosting(html) {
  const $ = cheerio.load(html);
  const schemas = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const value = JSON.parse($(element).html() || 'null');
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (candidate && candidate['@type'] === 'JobPosting') schemas.push(candidate);
      }
    } catch { /* ignore malformed unrelated JSON-LD */ }
  });
  const schema = schemas[0];
  if (!schema?.title || !schema?.description) return null;

  const mailto = $('a[href^="mailto:"]').map((_, element) => $(element).attr('href') || '').get()
    .map((href) => href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase())
    .find((email) => /^[^@\s]+@interconrecruitment\.co\.za$/i.test(email)) || '';
  const location = schema.jobLocation?.address || {};
  const salary = schema.baseSalary?.value || {};
  return {
    title: clean(schema.title),
    description: clean(schema.description),
    requirements: clean(schema.MinimumRequirements),
    salaryNotes: clean(schema['Salary & Benefits']),
    applyNotes: clean(schema['To Apply']),
    email: mailto,
    location: clean([location.addressLocality, location.addressRegion].filter(Boolean).join(', ')),
    employmentType: clean(schema.employmentType).replaceAll('_', ' '),
    salary: clean(schemaSalary(salary, schema['Salary & Benefits'])),
    startDate: normalizeDate(schema.datePosted),
    closingDate: normalizeDate(schema.validThrough),
  };
}

function schemaSalary(value, fallback) {
  if (value && (value.minValue || value.maxValue)) {
    const min = value.minValue ? `R${value.minValue}` : '';
    const max = value.maxValue ? ` - R${value.maxValue}` : '';
    return `${min}${max}${value.unitText ? ` ${value.unitText.toLowerCase()}` : ''}`.trim();
  }
  return fallback || '';
}

function normalizeDate(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(String(value || '').trim());
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function parseInterconDetail(html, url, now = new Date()) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return null; }
  if (parsedUrl.origin !== INTERCON_ORIGIN || !parsedUrl.pathname.startsWith('/jobs-2/')) return null;
  const job = readJobPosting(html);
  if (!job) return null;
  if (job.closingDate && job.closingDate < now.toISOString().slice(0, 10)) return null;
  const notes = [job.description, job.requirements && `Minimum requirements:\n${job.requirements}`, job.salaryNotes, job.applyNotes]
    .filter(Boolean).join('\n\n');
  return {
    id: stableId(parsedUrl.toString()),
    title: job.title,
    company: INTERCON_AGENCY_NAME,
    location: job.location,
    link: parsedUrl.toString(),
    email: job.email,
    phone: '+27878217875',
    remote: false,
    experience_level: '',
    employment_type: job.employmentType,
    contract_type: '',
    work_schedule: '',
    hours: '',
    salary: job.salary,
    start_date: job.startDate,
    closing_date: job.closingDate,
    notes,
    source_type: 'agency',
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await mapper(items[index]); } catch (error) { console.warn(`[intercon] skipped ${items[index]}: ${error.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output.filter(Boolean);
}

async function removeStale(agencyId, currentIds) {
  const { data, error } = await supabase.from('vacancies').select('id').eq('agency_id', agencyId).eq('source_type', 'agency').limit(500);
  if (error) throw error;
  const stale = (data || []).map((row) => row.id).filter((id) => !currentIds.has(id));
  if (!stale.length) return 0;
  const { error: deleteError } = await supabase.from('vacancies').delete().in('id', stale);
  if (deleteError) throw deleteError;
  return stale.length;
}

export async function syncIntercon() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { data: agencies, error: agencyError } = await supabase.from('agencies').select('id,name,photo').ilike('name', '%Intercon%').limit(10);
  if (agencyError) throw agencyError;
  const agency = (agencies || []).find((row) => row.name === INTERCON_AGENCY_NAME) || agencies?.[0];
  if (!agency) throw new Error('Intercon Recruitment agency record was not found');

  const indexHtml = await fetchText(INTERCON_INDEX_URL);
  const urls = parseInterconIndex(indexHtml);
  const jobs = await mapWithConcurrency(urls, 5, async (url) => parseInterconDetail(await fetchText(url), url));
  if (!jobs.length) throw new Error('Intercon index produced zero current structured vacancies; refusing to delete existing rows');

  const checkedAt = new Date().toISOString();
  const rows = jobs.map((job) => ({ ...job, agency_id: agency.id, employer_id: null, company_photo: agency.photo || null, source_checked_at: checkedAt, last_verified_at: checkedAt }));
  const { error: upsertError } = await supabase.from('vacancies').upsert(rows, { onConflict: 'id' });
  if (upsertError) throw upsertError;
  const removed = await removeStale(agency.id, new Set(rows.map((row) => row.id)));
  const { error: statusError } = await supabase.from('agencies').update({
    site_vacancy_url: INTERCON_INDEX_URL,
    site_scrape_status: 'ok',
    site_scrape_reason: `Wix JobPosting pages: ${rows.length} current vacancies`,
    site_scraped_at: checkedAt,
  }).eq('id', agency.id);
  if (statusError) throw statusError;
  return { agency: agency.name, discovered: urls.length, current: rows.length, upserted: rows.length, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`[intercon] completed: ${JSON.stringify(await syncIntercon())}`);
}

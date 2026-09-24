import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SIMPLIFY_BASE_URL = process.env.SIMPLIFY_BASE_URL || 'https://jobs.simplify.hr';
const PAGE_SIZE = parsePositiveInt(process.env.SIMPLIFY_PAGE_SIZE, 100);
const MAX_PAGES = parsePositiveInt(process.env.SIMPLIFY_MAX_PAGES, 100);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.SIMPLIFY_REQUEST_DELAY_MS, 750);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SIMPLIFY_REQUEST_TIMEOUT_MS, 30_000);
const FETCH_ATTEMPTS = parsePositiveInt(process.env.SIMPLIFY_FETCH_ATTEMPTS, 2);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersSimplifyScraper/1.0 (+https://sa-recruiters.co.za)';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}

function simplifyVacancyId(link) {
  try {
    const url = new URL(link);
    const match = url.pathname.match(/^\/vacancy\/([^/?#]+)/i);
    if (!match || !url.hostname.endsWith('.simplify.hr')) return null;
    return `${url.hostname}-${match[1]}`.toLowerCase();
  } catch {
    return null;
  }
}

function parseDateLabel(value) {
  const match = clean(value).match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  return match ? match[1] : '';
}

function mapEmploymentType(value) {
  const type = clean(value).toLowerCase();
  if (type.includes('part')) return 'Part time';
  if (type.includes('contract') || type.includes('temporary') || type.includes('temp')) return 'Contract';
  if (type.includes('intern')) return 'Internship';
  if (type.includes('permanent') || type.includes('full')) return 'Full time';
  return clean(value);
}

function simplifyPageUrl(page, size = PAGE_SIZE) {
  const url = new URL(SIMPLIFY_BASE_URL);
  url.searchParams.set('Page', String(page));
  url.searchParams.set('size', String(size));
  return url.toString();
}

function listingCardFor($, heading) {
  // The heading row and details row are siblings inside the same listing
  // wrapper. Using the next .row keeps the parser independent of Bootstrap's
  // changing column layout and avoids accidentally joining adjacent cards.
  const details = heading.nextAll('.row').first();
  return { heading, details };
}

export function parseSimplifyJobs(html, pageUrl = SIMPLIFY_BASE_URL, now = new Date()) {
  const $ = cheerio.load(html);
  const jobs = [];
  const seen = new Set();

  $('.job-heading-row').each((_, element) => {
    const heading = $(element);
    const details = listingCardFor($, heading).details;
    const titleAnchor = heading.find('a.job-title').first();
    const link = absoluteUrl(titleAnchor.attr('href'), pageUrl);
    const idPart = simplifyVacancyId(link);
    const title = clean(titleAnchor.attr('title') || titleAnchor.text());
    if (!link || !idPart || !title || seen.has(link)) return;
    seen.add(link);

    const company = clean(details.find('img.img-thumbnail-company').first().attr('alt'));
    const location = clean(heading.find('.job-location').first().text());
    const employmentType = mapEmploymentType(heading.find('.job-type').first().text());
    const detailsText = clean(details.text());
    const closingDate = parseDateLabel(detailsText.match(/Closing Date\s*:\s*([^\n]+?)(?=Posted Date|$)/i)?.[1] || '');
    const postedLabel = clean(detailsText.match(/Posted Date\s*:\s*([^\n]+?)(?=Closing Date|$)/i)?.[1] || '');
    const industry = clean(detailsText.match(/Company Primary Industry\s*:\s*([^\n]+?)(?=Posted Date|Closing Date|$)/i)?.[1] || '');
    const description = clean(details.find('p').first().text());
    const stale = isStaleVacancy({
      closing_date: closingDate,
      postedText: '',
      source_type: 'simplify',
      created_at: now.toISOString(),
    }, now);
    if (stale.stale) return;

    jobs.push({
      id: `simplify-${idPart}`,
      agency_id: 'general',
      employer_id: null,
      title,
      company,
      company_photo: null,
      location,
      closing_date: closingDate,
      notes: clean([
        postedLabel ? `Posted ${postedLabel}.` : '',
        industry ? `Industry: ${industry}.` : '',
        description,
        `Simplify Jobs company subdomain: ${new URL(link).hostname}`,
      ].filter(Boolean).join(' ')).slice(0, 20_000),
      link,
      email: '',
      phone: '',
      remote: null,
      experience_level: '',
      employment_type: employmentType,
      contract_type: '',
      work_schedule: '',
      hours: '',
      salary: '',
      start_date: '',
      source_type: 'simplify',
      source_checked_at: now.toISOString(),
      last_verified_at: now.toISOString(),
      created_at: now.toISOString(),
    });
  });

  // Keep the raw count separate from the fresh count. A page can contain only
  // closed jobs; that is not the end of pagination, so the caller must keep
  // going until the source returns a page with no listing cards at all.
  jobs.rawListingCount = $('.job-heading-row').length;
  return jobs;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchPage(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
      });
      if (!response.ok) throw new Error(`Simplify Jobs returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(1_000 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function upsertJobs(jobs) {
  if (!jobs.length) return 0;
  const links = jobs.map((job) => job.link);
  const { data: existing, error: lookupError } = await supabase
    .from('vacancies').select('id,link').in('link', links).limit(500);
  if (lookupError) throw lookupError;
  const existingByLink = new Map((existing || []).map((row) => [row.link, row.id]));
  const rows = jobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id }));
  const { error } = await supabase.from('vacancies').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows.length;
}

export async function runSimplifyScraper({ maxPages = MAX_PAGES, pageSize = PAGE_SIZE, now = new Date() } = {}) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let totalParsed = 0;
  let totalUpserted = 0;
  let failures = 0;
  let pagesWithListings = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = simplifyPageUrl(page, pageSize);
    try {
      console.log(`[simplify] page ${page}: fetching ${pageUrl}`);
      const parsed = parseSimplifyJobs(await fetchPage(pageUrl), pageUrl, now);
      const upserted = await upsertJobs(parsed);
      totalParsed += parsed.length;
      totalUpserted += upserted;
      if (parsed.rawListingCount) pagesWithListings += 1;
      console.log(`[simplify] page ${page}: found ${parsed.rawListingCount} listing(s), parsed ${parsed.length} fresh, upserted ${upserted}`);
      if (!parsed.rawListingCount) break;
    } catch (error) {
      failures += 1;
      console.error(`[simplify] page ${page} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page < maxPages) await sleep(REQUEST_DELAY_MS);
  }

  if (!totalUpserted && !failures) {
    throw new Error('[simplify] run completed without upserting a single vacancy -- likely a site markup or pagination change');
  }
  return { pagesWithListings, parsed: totalParsed, upserted: totalUpserted, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runSimplifyScraper();
  console.log(`[simplify] completed: ${JSON.stringify(results)}`);
  if (results.failures) process.exitCode = 1;
}

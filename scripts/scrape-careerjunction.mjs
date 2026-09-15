import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { pathToFileURL } from 'node:url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersCareerJunctionScraper/1.0 (+https://sa-recruiters.co.za)';
const GENERAL_URL = process.env.CAREERJUNCTION_GENERAL_URL || 'https://www.careerjunction.co.za/jobs/results';
// CareerJunction's per-company pages return a bot-challenge page (no login, but
// gated), so unlike Pnet there is no per-agency rotation here — only the public
// "all jobs" results listing, which loads without a challenge.
const PAGE_COUNT = parsePositiveInt(process.env.CAREERJUNCTION_PAGES, 3);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.CAREERJUNCTION_REQUEST_DELAY_MS, 1_000);

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
let agencyDirectoryPromise;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeAgencyName(value) {
  return clean(value).toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
}

const AGENCY_ALIASES = new Map([
  ['fusionpersonnel', 'Fusion Recruitment'],
  ['dcvsabenzaitandrecruitment', 'Sabenza IT Recruitment'],
]);

export function agencyIdForCompany(company, agencies) {
  const normalized = normalizeAgencyName(company);
  if (!normalized) return 'general';
  const targetName = AGENCY_ALIASES.get(normalized) || company;
  const target = normalizeAgencyName(targetName);
  const match = (agencies || []).find((agency) => normalizeAgencyName(agency.name) === target);
  return match?.id || 'general';
}

async function loadAgencyDirectory() {
  if (!agencyDirectoryPromise) {
    agencyDirectoryPromise = supabase
      .from('agencies')
      .select('id,name')
      .limit(1000)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      });
  }
  return agencyDirectoryPromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containerLines(el) {
  const html = el.html()
    .replace(/<(br|\/div|\/p|\/h[1-6]|\/li|\/a|\/span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return html.replace(/&nbsp;/gi, ' ').split(/\n+/).map(clean).filter(Boolean);
}

function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractJobId(urlOrText) {
  const match = String(urlOrText ?? '').match(/-job-(\d+)\.aspx/i) || String(urlOrText ?? '').match(/\bjob\s+(\d+)\b/i);
  return match?.[1] || null;
}

// Walks up from a job-detail anchor to find the smallest ancestor that also
// contains this job's reference text ("Job <id>"), which is how a listing
// card can be located without depending on any particular wrapper tag/class.
function findCard($, anchor, jobId) {
  const refPattern = new RegExp(`Job\\s*${jobId}(\\D|$)`);
  let node = anchor.parent();
  for (let depth = 0; depth < 12 && node.length; depth += 1) {
    if (refPattern.test(clean(node.text()))) return node;
    node = node.parent();
  }
  return null;
}

function parseJobFromAnchor($, anchor, pageUrl) {
  const href = anchor.attr('href');
  const link = absoluteUrl(href, pageUrl);
  const jobId = extractJobId(href);
  if (!link || !jobId) return null;

  const card = findCard($, anchor, jobId);
  const now = new Date().toISOString();

  if (!card) {
    const title = clean(anchor.text());
    if (!title) return null;
    return {
      id: `cj-${jobId}`,
      title,
      company: '',
      location: '',
      notes: '',
      link,
      source_type: 'agency',
      source_checked_at: now,
      last_verified_at: now,
    };
  }

  // Prefer the title anchor over the duplicate "Show More" link that points
  // to the same URL within the same card.
  const titleCandidates = card.find(`a[href*="-job-${jobId}"]`)
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((text) => text && !/^(show more|save this job|not for me)$/i.test(text));
  const title = titleCandidates[0] || clean(anchor.text());
  if (!title) return null;

  const companyCandidates = card.find('a[href*="/companies/"]')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  const company = companyCandidates[0] || '';
  const location = clean(
    card.find('a[href*="/jobs/"]').not('[href*="-job-"]').last().text()
  );

  const lines = containerLines(card);
  const salaryLine = lines.find((line) => /^(R\s?(undisclosed|[\d.,])|undisclosed)/i.test(line)) || '';
  const typeLine = lines.find((line) => /^(Permanent|Contract|Temporary|Learnership|Internship|Freelance)\b/i.test(line)) || '';
  const postedLine = lines.find((line) => /^Posted /i.test(line)) || '';
  const notes = clean([salaryLine, typeLine, postedLine].filter(Boolean).join(' · ')).slice(0, 20_000);

  return {
    id: `cj-${jobId}`,
    title,
    company,
    location,
    notes,
    link,
    source_type: 'agency',
    source_checked_at: now,
    last_verified_at: now,
  };
}

export function parseCareerJunctionJobs(html, pageUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const jobs = [];

  $('a[href*="-job-"]').each((_, element) => {
    const anchor = $(element);
    const jobId = extractJobId(anchor.attr('href'));
    if (!jobId || seen.has(jobId)) return;
    const job = parseJobFromAnchor($, anchor, pageUrl);
    if (!job) return;
    seen.add(jobId);
    jobs.push(job);
  });

  return jobs;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': USER_AGENT,
      },
    });
    if (!response.ok) throw new Error(`CareerJunction returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function pageUrlFor(page) {
  if (page <= 1) return GENERAL_URL;
  const separator = GENERAL_URL.includes('?') ? '&' : '?';
  return `${GENERAL_URL}${separator}page=${page}`;
}

async function upsertJobs(parsedJobs) {
  const agencies = await loadAgencyDirectory();
  const links = parsedJobs.map((job) => job.link);
  const { data: existingJobs, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((job) => [job.link, job.id]));
  const jobs = parsedJobs.map((job) => ({
    ...job,
    id: existingByLink.get(job.link) || job.id,
    agency_id: agencyIdForCompany(job.company, agencies),
  }));

  if (jobs.length > 0) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}

async function scrapePage(page) {
  const url = pageUrlFor(page);
  console.log(`[careerjunction] page ${page}: fetching ${url}`);
  const html = await fetchPage(url);
  const parsed = parseCareerJunctionJobs(html, url);
  const jobs = await upsertJobs(parsed);
  console.log(`[careerjunction] page ${page}: parsed ${parsed.length}, upserted ${jobs.length}`);
  return jobs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let failures = 0;
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    try {
      await scrapePage(page);
    } catch (error) {
      failures += 1;
      console.error(`[careerjunction] page ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page < PAGE_COUNT) await sleep(REQUEST_DELAY_MS);
  }

  if (failures > 0) process.exitCode = 1;
}

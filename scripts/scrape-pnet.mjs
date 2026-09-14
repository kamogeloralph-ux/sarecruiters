import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { pathToFileURL } from 'node:url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parsePositiveInt(process.env.SCRAPE_BATCH_SIZE, 1);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersPnetScraper/1.0 (+https://sa-recruiters.co.za)';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function articleLines(article) {
  const html = article.html()
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

function extractPnetId(urlOrId) {
  const match = String(urlOrId ?? '').match(/(?:--|job-item-)(\d{4,})(?:-inline\.html)?(?:[/?#]|$)/i);
  return match?.[1] || null;
}

function parseCard(article, pageUrl) {
  const title = clean(article.find('a[href*="/jobs--"]').first().text());
  const link = absoluteUrl(article.find('a[href*="/jobs--"]').first().attr('href'), pageUrl);
  const pnetId = extractPnetId(article.attr('id')) || extractPnetId(link);
  const lines = articleLines(article);

  if (!title || !link || !pnetId) return null;

  const titleIndex = lines.findIndex((line) => line.toLowerCase() === title.toLowerCase());
  const company = lines[titleIndex + 1] || '';
  const location = lines[titleIndex + 2] || '';
  const notes = clean(lines.slice(titleIndex + 3).filter((line) => !/^more$/i.test(line) && !/^\d+\s+(day|week|month)s? ago$/i.test(line)).join(' '));

  return {
    id: `pnet-${pnetId}`,
    title,
    company,
    location,
    notes: notes.slice(0, 20_000),
    link,
    source_type: 'agency',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  };
}

export function parsePnetJobs(html, pageUrl) {
  const $ = cheerio.load(html);
  const jobs = [];
  $('article[id^="job-item-"]').each((_, element) => {
    const job = parseCard($(element), pageUrl);
    if (job) jobs.push(job);
  });

  // Keep the parser useful if Pnet changes the card wrapper but retains canonical links.
  if (jobs.length === 0) {
    const seen = new Set();
    $('a[href*="/jobs--"]').each((_, element) => {
      const link = absoluteUrl($(element).attr('href'), pageUrl);
      const pnetId = extractPnetId(link);
      const title = clean($(element).text());
      if (!link || !pnetId || !title || seen.has(pnetId)) return;
      seen.add(pnetId);
      jobs.push({
        id: `pnet-${pnetId}`,
        title,
        company: '',
        location: '',
        notes: '',
        link,
        source_type: 'agency',
        source_checked_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
      });
    });
  }

  return jobs.filter((job, index, all) => all.findIndex((candidate) => candidate.id === job.id) === index);
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
    if (!response.ok) throw new Error(`Pnet returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAgencies() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { data, error } = await supabase
    .from('agencies')
    .select('id,name,pnet_url,last_scraped_at')
    .not('pnet_url', 'is', null)
    .order('last_scraped_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  return data || [];
}

async function scrapeAgency(agency) {
  const startedAt = new Date().toISOString();
  console.log(`[pnet] ${agency.name}: fetching ${agency.pnet_url}`);
  const html = await fetchPage(agency.pnet_url);
  const parsedJobs = parsePnetJobs(html, agency.pnet_url);
  const links = parsedJobs.map((job) => job.link);
  const { data: existingJobs, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((job) => [job.link, job.id]));
  const jobs = parsedJobs.map((job) => ({
    ...job,
    id: existingByLink.get(job.link) || job.id,
    agency_id: agency.id,
  }));

  if (jobs.length > 0) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }

  const { error: timestampError } = await supabase
    .from('agencies')
    .update({ last_scraped_at: startedAt })
    .eq('id', agency.id);
  if (timestampError) throw timestampError;

  console.log(`[pnet] ${agency.name}: parsed ${jobs.length}, upserted ${jobs.length}`);
  return { agency: agency.name, jobs: jobs.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const agencies = await loadAgencies();
  if (agencies.length === 0) {
    console.log('[pnet] no agencies with a configured pnet_url');
    process.exit(0);
  }

  let failures = 0;
  for (const agency of agencies) {
    try {
      await scrapeAgency(agency);
    } catch (error) {
      failures += 1;
      console.error(`[pnet] ${agency.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures > 0) process.exitCode = 1;
}

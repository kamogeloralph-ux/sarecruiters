import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DPSA_BASE = 'https://www.dpsa.gov.za';
const DPSA_PAGE_BASE = `${DPSA_BASE}/newsroom/psvc`;
const DPSA_TIMEOUT_MS = Number(process.env.DPSA_TIMEOUT_MS || 20_000);
const DPSA_MAX_CIRCULAR = Number(process.env.DPSA_MAX_CIRCULAR || 60);
const DPSA_YEARS = String(process.env.DPSA_YEARS || new Date().getUTCFullYear())
  .split(',').map((year) => Number(year.trim())).filter(Boolean);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugPart(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function circularPageUrl(number, year) {
  return `${DPSA_PAGE_BASE}/circular-${number}-of-${year}/`;
}

function parsePostingDate(text) {
  const match = clean(text).match(/Posting Date\s*:?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  return match ? match[1] : '';
}

export function parseCircularPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const heading = clean($('h1').first().text() || $('title').first().text());
  const circularMatch = heading.match(/Circular\s+(\d+)\s+of\s+(\d{4})/i) || pageUrl.match(/circular-(\d+)-of-(\d{4})/i);
  if (!circularMatch) return null;
  const number = Number(circularMatch[1]);
  const year = Number(circularMatch[2]);
  const bodyText = clean($('body').text());
  const postingDate = parsePostingDate(bodyText);
  let pdf = '';
  $('a[href]').each((_, anchor) => {
    const href = clean($(anchor).attr('href'));
    if (!/\.pdf(?:$|\?)/i.test(href)) return;
    if (!pdf || /PSV\s*CIRCULAR/i.test(href) || /CIRCULAR/i.test($(anchor).text())) pdf = new URL(href, pageUrl).href;
  });
  if (!pdf) return null;
  const title = `DPSA Public Service Vacancy Circular ${number} of ${year}`;
  const id = `dpsa-${year}-${String(number).padStart(2, '0')}`;
  return {
    id,
    title,
    company: 'Department of Public Service and Administration',
    location: 'South Africa',
    notes: clean([
      postingDate ? `Posting date: ${postingDate}.` : '',
      'Official government public-service vacancy circular. Open the PDF to search departments, posts, reference numbers, requirements, and closing dates.',
      `Circular page: ${pageUrl}`,
    ].filter(Boolean).join(' ')),
    link: pdf,
    agency_id: 'general',
    source_type: 'dpsa',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    created_at: postingDate ? new Date(postingDate).toISOString() : new Date().toISOString(),
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DPSA_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html' } });
    if (!response.ok) return null;
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverCirculars({ years = DPSA_YEARS, maxCircular = DPSA_MAX_CIRCULAR } = {}) {
  const found = [];
  for (const year of years) {
    for (let number = maxCircular; number >= 1; number -= 1) {
      const pageUrl = circularPageUrl(number, year);
      try {
        const html = await fetchText(pageUrl);
        if (!html) continue;
        const circular = parseCircularPage(html, pageUrl);
        if (circular) found.push(circular);
      } catch (error) {
        console.warn(`[dpsa] unable to inspect ${pageUrl}: ${error.message}`);
      }
    }
  }
  return found;
}

export async function upsertCirculars(circulars) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!circulars.length) return 0;
  const { error } = await supabase.from('vacancies').upsert(circulars, { onConflict: 'id' });
  if (error) throw error;
  return circulars.length;
}

async function main() {
  const circulars = await discoverCirculars();
  const unique = [...new Map(circulars.map((circular) => [circular.id, circular])).values()];
  console.log(`[dpsa] discovered ${unique.length} official circular PDFs across ${DPSA_YEARS.join(', ')}`);
  const count = await upsertCirculars(unique);
  console.log(`[dpsa] upserted ${count} circular archive records`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[dpsa] sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { circularPageUrl, slugPart };

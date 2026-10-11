import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INDEED_RSS_URL = process.env.INDEED_RSS_URL || 'https://za.indeed.com/rss?q=developer&l=South+Africa';
const MAX_VACANCIES = parsePositiveInt(process.env.INDEED_MAX_VACANCIES, 50);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SA-RecruitersIndeedSync/1.0 (+https://sa-recruiters.co.za)';
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: true,
  processEntities: true,
});

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

function textFromHtml(value) {
  const html = String(value ?? '');
  if (!html) return '';
  const root = cheerio.load(`<div>${html}</div>`);
  root('br').replaceWith(' | ');
  root('p,li,tr').each((_, element) => root(element).append(' | '));
  return clean(root('div').text()).replace(/\s*\|\s*/g, ' | ');
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function itemArray(parsed) {
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) return Array.isArray(rssItems) ? rssItems : [rssItems];
  const atomEntries = parsed?.feed?.entry;
  if (atomEntries) return Array.isArray(atomEntries) ? atomEntries : [atomEntries];
  return [];
}

function itemLink(item) {
  const link = firstValue(item?.link);
  if (typeof link === 'string') return clean(link);
  return clean(link?.['#text'] || link?.['@_href']);
}

function itemText(item, key) {
  const value = firstValue(item?.[key]);
  return clean(typeof value === 'object' ? value?.['#text'] : value);
}

function stableId(link, title) {
  const digest = createHash('sha256').update(`${link}\n${title}`).digest('hex').slice(0, 24);
  return `indeed-${digest}`;
}

function publishedIso(value, now) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return now.toISOString();
  return date.toISOString();
}

function extractLocation(description) {
  const match = description.match(/(?:location|地点)\s*:\s*([^|•·;]+?)(?=\s+(?:salary|job type|posted|description)\s*:|\s+\|\s+|$)/i);
  return clean(match?.[1] || 'South Africa');
}

function extractCompany(item, description) {
  const source = itemText(item, 'source');
  if (source) return source;
  const match = description.match(/(?:company|employer)\s*:\s*([^|•·;]+?)(?=\s+(?:location|salary|job type)\s*:|$)/i);
  return clean(match?.[1] || '');
}

export function parseIndeedFeed(xml, now = new Date()) {
  const parsed = typeof xml === 'string' ? xmlParser.parse(xml) : xml;
  const seen = new Set();
  return itemArray(parsed).map((item) => {
    const title = itemText(item, 'title');
    const link = itemLink(item);
    if (!title || !link || seen.has(link)) return null;
    seen.add(link);

    const description = textFromHtml(itemText(item, 'description') || itemText(item, 'summary'));
    const published = publishedIso(itemText(item, 'pubDate') || itemText(item, 'published') || itemText(item, 'updated'), now);
    const stale = isStaleVacancy({
      closing_date: '',
      postedText: published.slice(0, 10),
      source_type: 'indeed',
      created_at: published,
    }, now);
    if (stale.stale) return null;

    return {
      id: stableId(link, title),
      agency_id: 'general',
      employer_id: null,
      title,
      company: extractCompany(item, description),
      company_photo: null,
      location: extractLocation(description),
      closing_date: '',
      notes: clean([`Posted ${published.slice(0, 10)}.`, description].filter(Boolean).join(' ')).slice(0, 20_000),
      link,
      email: '',
      phone: '',
      remote: null,
      experience_level: '',
      employment_type: '',
      contract_type: '',
      work_schedule: '',
      hours: '',
      salary: '',
      start_date: '',
      source_type: 'indeed',
      source_checked_at: now.toISOString(),
      last_verified_at: now.toISOString(),
      created_at: published,
    };
  }).filter(Boolean).slice(0, MAX_VACANCIES);
}

async function fetchFeed(url = INDEED_RSS_URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9',
        'user-agent': USER_AGENT,
      },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Indeed returned HTTP ${response.status}`);
    if (!body.trim()) throw new Error('Indeed returned an empty RSS response');
    if (!/<\s*(?:rss|feed)\b/i.test(body)) {
      throw new Error('Indeed returned non-RSS content (the endpoint may require a permitted API/feed route)');
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
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

export async function runIndeedSync({ url = INDEED_RSS_URL, now = new Date() } = {}) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const xml = await fetchFeed(url);
  const jobs = parseIndeedFeed(xml, now);
  const upserted = await upsertJobs(jobs);
  return { parsed: jobs.length, upserted, url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runIndeedSync();
    console.log(`[indeed] completed: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[indeed] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { isStaleVacancy } from './vacancy-freshness.mjs';
import { envInt } from './scrape-limits.mjs';

export const BIZCOMMUNITY_RSS_URL = 'https://www.bizcommunity.com/rssjobs.aspx?l=196&c=11&pi=999&sm=3';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS || '30000', 10);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersBizcommunitySync/1.0 (+https://sa-recruiters.co.za)';
const MAX_VACANCIES = envInt(process.env.BIZCOMMUNITY_MAX_VACANCIES, 500, { min: 1, max: 5000 });
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function clean(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function textOf(root, selector) {
  return clean(root.find(selector).first().text());
}

function labelValue(text, label) {
  const labels = '(?:Posted by|Province|City|Type|Education level|Transport/travel requirements)';
  const match = String(text).match(new RegExp(`${label}\\s*:\\s*(.*?)(?=\\s*${labels}\\s*:|$)`, 'i'));
  return match ? clean(match[1]) : '';
}

function stripReadMore(text) {
  return clean(text)
    .replace(/Read full job description[\s\S]*$/i, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim();
}

function stableId(value) {
  const digest = createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
  return `bizcommunity-${digest}`;
}

export function mapBizcommunityItems(xml, now = new Date()) {
  if (!xml || typeof xml !== 'string') return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const seen = new Set();
  const nowIso = now.toISOString();
  const jobs = [];

  $('item').each((_, item) => {
    if (jobs.length >= MAX_VACANCIES) return false;
    const root = $(item);
    const title = textOf(root, 'title');
    const link = textOf(root, 'link') || textOf(root, 'guid');
    const guid = textOf(root, 'guid') || link;
    const rawDescription = root.find('description').first().text();
    const descriptionHtml = rawDescription || root.find('description').first().html() || '';
    const descriptionText = clean(cheerio.load(descriptionHtml).text());
    if (!title || !link || !/^https?:\/\//i.test(link)) return;

    const dedupeKey = guid || link;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const company = labelValue(descriptionText, 'Posted by');
    const province = labelValue(descriptionText, 'Province');
    const city = labelValue(descriptionText, 'City');
    const type = labelValue(descriptionText, 'Type');
    const education = labelValue(descriptionText, 'Education level');
    const transport = labelValue(descriptionText, 'Transport/travel requirements');
    const postedDate = root.find('pubDate').first().text().trim();
    const location = clean([city, province].filter(Boolean).join(', '));
    const parsedPostedDate = postedDate && !Number.isNaN(Date.parse(postedDate))
      ? new Date(postedDate).toISOString().slice(0, 10)
      : postedDate;
    const stale = isStaleVacancy({ closing_date: '', postedText: parsedPostedDate, source_type: 'bizcommunity' }, now);
    if (stale.stale) return;

    const detail = stripReadMore(descriptionText);
    const notes = clean([
      type && `Employment: ${type}`,
      education && `Education: ${education}`,
      transport && `Travel: ${transport}`,
      postedDate && `Posted ${postedDate}`,
      detail,
    ].filter(Boolean).join(' · ')).slice(0, 20000);

    jobs.push({
      id: stableId(guid || link),
      title,
      company,
      location,
      closing_date: '',
      notes,
      link,
      agency_id: 'general',
      source_type: 'bizcommunity',
      source_checked_at: nowIso,
      last_verified_at: nowIso,
    });
    if (jobs.length >= MAX_VACANCIES) return false;
  });
  return jobs;
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1', 'user-agent': USER_AGENT },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Bizcommunity returned HTTP ${response.status}`);
      if (!body.includes('<item')) throw new Error('Bizcommunity response did not contain RSS items');
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function upsertJobs(jobs) {
  if (!supabase || !jobs.length) return jobs.length;
  const links = jobs.map((job) => job.link);
  const { data: existing, error: existingError } = await supabase.from('vacancies').select('id,link').in('link', links);
  if (existingError) throw existingError;
  const existingByLink = new Map((existing || []).map((row) => [row.link, row.id]));
  const reconciled = jobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id }));
  for (let i = 0; i < reconciled.length; i += 100) {
    const batch = reconciled.slice(i, i + 100);
    const { error } = await supabase.from('vacancies').upsert(batch, { onConflict: 'id' });
    if (error) throw error;
  }
  return reconciled.length;
}

async function main() {
  const now = new Date();
  const xml = await fetchWithRetry(BIZCOMMUNITY_RSS_URL);
  const jobs = mapBizcommunityItems(xml, now);
  const saved = await upsertJobs(jobs);
  console.log(`[bizcommunity] parsed ${jobs.length} feed listings (cap ${MAX_VACANCIES}), upserted ${saved}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error('[bizcommunity] sync failed:', error); process.exitCode = 1; });
}

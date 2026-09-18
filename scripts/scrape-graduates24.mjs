import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

// NOTE ON SELECTOR STRATEGY: this scraper was written against Graduates24's
// rendered page content (fetched through a browser-side tool), not its raw
// HTML source, so exact CSS class names on the live site are unknown. Every
// other scraper in this repo (jobmail, careerjunction, retail) targets
// specific classes/ids because their raw HTML was inspected directly.
// Instead of guessing plausible-looking class names that might not exist,
// this one anchors on two structural markers that are visible in the
// rendered output and unlikely to change: each listing has an <h2> title
// and a "Read More" link. Do a real dry run (GRADUATES24_PAGES=1 node
// scripts/scrape-graduates24.mjs) and check the results before relying on
// this in production — see scrape-graduates24.test.mjs for the fixture
// this was built and tested against.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GENERAL_URL = process.env.GRADUATES24_GENERAL_URL || 'https://www.graduates24.com/learnerships';
const PAGE_COUNT = parsePositiveInt(process.env.GRADUATES24_PAGES, 60);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.GRADUATES24_REQUEST_DELAY_MS, 1_500);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.GRADUATES24_REQUEST_TIMEOUT_MS, 60_000);
const FETCH_ATTEMPTS = parsePositiveInt(process.env.GRADUATES24_FETCH_ATTEMPTS, 2);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersGraduates24Scraper/1.0 (+https://sa-recruiters.co.za)';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}
function slugFromLink(link) {
  try { return new URL(link).pathname.replace(/^\/+/, '').replace(/\/+$/, ''); }
  catch { return null; }
}

// Titles on this site consistently follow a "Company: Programme name"
// pattern (e.g. "Hollard: Learnership Programme 2026",
// "Dis-Chem: Dispensary Support Learnerships 2026 / 2027"). Government/
// agency postings without that pattern (e.g. "SA Government Internships
// 2026 / 2027") just fall back to no company, same as jobmail/
// careerjunction do for listings they can't attribute.
export function companyFromTitle(title) {
  const match = clean(title).match(/^([^:]{2,60}):\s*(.+)$/);
  return match ? clean(match[1]) : '';
}

export function parseGraduates24Jobs(html, pageUrl = GENERAL_URL) {
  const $ = cheerio.load(html);
  const jobs = [];
  const seen = new Set();
  $('a').each((_, el) => {
    const anchor = $(el);
    if (clean(anchor.text()).toLowerCase() !== 'read more') return;
    const link = absoluteUrl(anchor.attr('href'), pageUrl);
    const slug = slugFromLink(link);
    if (!link || !slug || seen.has(slug)) return;

    // Walk up from the "Read More" link until we find an ancestor that
    // also contains this listing's <h2> title — that's the card container.
    let container = anchor.parent();
    for (let hops = 0; hops < 6 && container.length && !container.find('h2').length; hops += 1) {
      container = container.parent();
    }
    const title = clean(container.find('h2').first().text()).replace(/\s*New\s*$/, '');
    if (!title) return;
    seen.add(slug);

    // The posted/location/closing-date line is the shortest element within
    // the card whose text contains "Posted:" — a small <p>/<div> holding
    // just that line, as opposed to a large wrapper whose full text
    // happens to include the word too.
    let dateLine = '';
    container.find('*').each((__, el2) => {
      const text = clean($(el2).text());
      if (/Posted:/i.test(text) && (!dateLine || text.length < dateLine.length)) dateLine = text;
    });
    const postedMatch = dateLine.match(/Posted:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    const closesMatch = dateLine.match(/Closes:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    let location = dateLine;
    if (postedMatch) location = location.slice(location.indexOf(postedMatch[0]) + postedMatch[0].length);
    if (closesMatch) location = location.slice(0, location.indexOf(closesMatch[0]));
    location = clean(location.replace(/^New\b/i, ''));

    // The description snippet is the longest text-bearing element in the
    // card that isn't the title or the date line.
    let description = '';
    container.find('p, div, span').each((__, el2) => {
      const text = clean($(el2).text());
      if (text && text !== title && text !== dateLine && !/^(Read More|Share)$/i.test(text) && text.length > description.length) {
        description = text;
      }
    });

    jobs.push({
      id: `graduates24-${slug}`,
      title,
      company: companyFromTitle(title),
      location,
      closing_date: closesMatch ? closesMatch[1] : '',
      notes: (postedMatch ? `Posted ${postedMatch[1]}. ` : '') + description.slice(0, 20_000 - 20),
      link,
      // 'learnerships' is a dedicated source type (see isDedicatedVacancySource
      // in app-data.js) so every posting lands in its own Learnerships card
      // instead of being matched to an individual agency or falling into
      // General Vacancies — same pattern as government/retail/himalayas/adzuna.
      agency_id: 'general',
      source_type: 'learnerships',
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
      if (!response.ok) throw new Error(`Graduates24 returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        console.warn(`[graduates24] request attempt ${attempt} failed for ${url}: ${error instanceof Error ? error.message : String(error)}; retrying`);
        await sleep(2_000);
      }
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}
function pageUrlFor(page) { return page <= 1 ? GENERAL_URL : `${GENERAL_URL.replace(/\/$/, '')}?page=${page}`; }
async function upsertJobs(parsedJobs) {
  const links = parsedJobs.map((job) => job.link);
  const { data: existingJobs, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((job) => [job.link, job.id]));
  const jobs = parsedJobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id }));
  if (jobs.length) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}
async function scrapePage(page) {
  const url = pageUrlFor(page);
  console.log(`[graduates24] page ${page}: fetching ${url}`);
  const parsed = parseGraduates24Jobs(await fetchPage(url), url);
  const jobs = await upsertJobs(parsed);
  console.log(`[graduates24] page ${page}: parsed ${parsed.length}, upserted ${jobs.length}`);
  return jobs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let failures = 0;
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    try {
      const count = await scrapePage(page);
      // Graduates24 shows "no results" rather than erroring once you run
      // past the last real page — stop early instead of grinding through
      // the configured page count fetching nothing.
      if (count === 0) { console.log(`[graduates24] page ${page}: no jobs found, stopping`); break; }
    }
    catch (error) { failures += 1; console.error(`[graduates24] page ${page}: ${error instanceof Error ? error.message : String(error)}`); }
    if (page < PAGE_COUNT) await sleep(REQUEST_DELAY_MS);
  }
  if (failures) process.exitCode = 1;
}

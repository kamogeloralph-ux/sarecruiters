import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { isStaleVacancy } from './vacancy-freshness.mjs';
import { envInt } from './scrape-limits.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersTakealotSync/1.0 (+https://sa-recruiters.co.za)';
const MAX_VACANCIES = envInt(process.env.TAKEALOT_MAX_VACANCIES, 500, { min: 1, max: 5000 });
const BOARDS = [
  { key: 'takealotcom', label: 'takealot.com' },
  { key: 'takealotgroup', label: 'Takealot Group' },
];

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

function htmlToText(value) {
  let current = String(value ?? '');
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = cheerio.load(current).text();
    if (decoded === current) break;
    current = decoded;
  }
  return clean(cheerio.load(current).text());
}

function apiUrl(board) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
}

export function mapGreenhouseJobs(payload, board, now = new Date()) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const nowIso = now.toISOString();
  return jobs.map((item) => {
    const externalId = item?.id != null ? String(item.id) : '';
    const link = clean(item?.absolute_url);
    const title = clean(item?.title);
    if (!externalId || !link || !title) return null;

    const postedText = item?.first_published || item?.updated_at || '';
    const closingDate = item?.application_deadline || '';
    const location = clean(item?.location?.name || (Array.isArray(item?.offices) ? item.offices.map((office) => office?.location || office?.name).filter(Boolean).join(', ') : ''));
    const description = htmlToText(item?.content);
    const department = Array.isArray(item?.departments) ? item.departments.map((entry) => entry?.name).filter(Boolean).join(', ') : '';
    const notes = clean([
      postedText && `Posted ${postedText}`,
      department && `Department: ${department}`,
      description,
    ].filter(Boolean).join(' · ')).slice(0, 20_000);

    const stale = isStaleVacancy({ closing_date: closingDate, postedText, source_type: 'takealot' }, now);
    if (stale.stale) {
      console.log(`[takealot:${board}] skipping ${link}: ${stale.reason}`);
      return null;
    }

    return {
      id: `takealot-${board}-${externalId}`,
      title,
      company: clean(item?.company_name) || (board === 'takealotcom' ? 'takealot.com' : 'Takealot Group'),
      location,
      closing_date: clean(closingDate),
      notes,
      link,
      agency_id: 'general',
      source_type: 'takealot',
      source_checked_at: nowIso,
      last_verified_at: nowIso,
    };
  }).filter(Boolean);
}

async function fetchBoard(board) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(board), {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Greenhouse ${board} returned HTTP ${response.status}`);
    if (!payload || !Array.isArray(payload.jobs)) throw new Error(`Greenhouse ${board} returned an invalid jobs payload`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertJobs(mappedJobs) {
  if (!mappedJobs.length) return [];
  const links = mappedJobs.map((job) => job.link);
  const { data: existing, error: existingError } = await supabase.from('vacancies').select('id,link').in('link', links).limit(500);
  if (existingError) throw existingError;
  const existingByLink = new Map((existing || []).map((row) => [row.link, row.id]));
  const jobs = mappedJobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id }));
  for (let index = 0; index < jobs.length; index += 100) {
    const { error } = await supabase.from('vacancies').upsert(jobs.slice(index, index + 100), { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}

async function removeClosed(liveIds) {
  const { data, error } = await supabase.from('vacancies').select('id').eq('source_type', 'takealot').limit(1000);
  if (error) throw error;
  const staleIds = (data || []).map((row) => row.id).filter((id) => !liveIds.has(id));
  if (!staleIds.length) return 0;
  const { error: deleteError } = await supabase.from('vacancies').delete().in('id', staleIds);
  if (deleteError) throw deleteError;
  return staleIds.length;
}

export function mergeGreenhouseJobs(boardPayloads, now = new Date()) {
  const byLink = new Map();
  for (const { board, payload } of boardPayloads) {
    for (const job of mapGreenhouseJobs(payload, board, now)) {
      if (!byLink.has(job.link)) byLink.set(job.link, job);
    }
  }
  return [...byLink.values()]
    .sort((a, b) => String(b.source_checked_at).localeCompare(String(a.source_checked_at)))
    .slice(0, MAX_VACANCIES);
}

export async function runTakealotSync() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const boardPayloads = [];
  for (const board of BOARDS) {
    const payload = await fetchBoard(board.key);
    boardPayloads.push({ board: board.key, payload });
    console.log(`[takealot:${board.key}] received ${payload.jobs.length} Greenhouse jobs`);
  }
  const mapped = mergeGreenhouseJobs(boardPayloads);
  const saved = await upsertJobs(mapped);
  const removed = await removeClosed(new Set(saved.map((job) => job.id)));
  console.log(`[takealot] mapped ${mapped.length}, upserted ${saved.length}, removed ${removed} closed rows (cap ${MAX_VACANCIES})`);
  return { fetched: mapped.length, upserted: saved.length, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTakealotSync().catch((error) => {
    console.error(`[takealot] sync failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

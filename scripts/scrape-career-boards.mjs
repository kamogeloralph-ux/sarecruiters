import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.CAREER_BOARD_REQUEST_TIMEOUT_MS || '30000', 10);
const FETCH_ATTEMPTS = Math.max(Number.parseInt(process.env.CAREER_BOARD_FETCH_ATTEMPTS || '2', 10), 1);
const DETAIL_CONCURRENCY = Math.min(Math.max(Number.parseInt(process.env.CAREER_BOARD_CONCURRENCY || '4', 10), 1), 8);
const USER_AGENT = 'SA-Recruiters-CareerBoardScraper/1.0 (+https://sa-recruiters.co.za/)';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function htmlToText(value) {
  return clean(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceId(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
}

function parseDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : date.toISOString();
}

function locationText(value) {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(locationText).filter(Boolean).join(', ');
  if (!value || typeof value !== 'object') return '';
  return clean(value.name || value.city || value.location || [value.addressLocality, value.addressRegion, value.addressCountry].filter(Boolean).join(', '));
}

function normalizeBoard(board) {
  if (!board || typeof board !== 'object') return null;
  const type = clean(board.type).toLowerCase();
  const name = clean(board.name || board.company || board.board);
  if (!['lever', 'greenhouse'].includes(type) || !name) return null;
  return { type, name, label: clean(board.label || board.company || board.name || name) };
}

export function parseBoardConfig(value = process.env.CAREER_BOARDS || '') {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(normalizeBoard).filter(Boolean);
  } catch (_) { /* Fall back to compact type:name entries. */ }
  return value.split(',').map((entry) => {
    const [type, ...nameParts] = entry.split(':');
    return normalizeBoard({ type, name: nameParts.join(':') });
  }).filter(Boolean);
}

export function parseLeverJobs(payload, board) {
  if (!Array.isArray(payload)) return [];
  return payload.filter((job) => job && job.id && job.text && job.hostedUrl).map((job) => {
    const categories = job.categories || {};
    const location = locationText(categories.location || job.workplaceType);
    const remote = /remote/i.test(`${location} ${job.workplaceType || ''}`) ? 'Remote' : null;
    return {
      id: `career-lever-${sourceId(board.name)}-${sourceId(job.id)}`,
      agency_id: 'general', employer_id: null,
      title: clean(job.text), company: board.label,
      location, closing_date: '',
      notes: htmlToText(job.descriptionPlain || job.description || job.additionalPlain || job.additional || ''),
      link: job.hostedUrl,
      email: '', phone: '', remote,
      experience_level: '', employment_type: clean(categories.commitment || ''),
      contract_type: '', work_schedule: '', hours: '', salary: '', start_date: '',
      source_type: 'career_board',
      source_checked_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    };
  });
}

export function parseGreenhouseJobs(payload, board) {
  if (!payload || !Array.isArray(payload.jobs)) return [];
  return payload.jobs.filter((job) => job && job.id && job.title && job.absolute_url).map((job) => {
    const location = locationText(job.location || job.offices || job.location_names);
    const remote = /remote/i.test(`${location} ${job.title}`) ? 'Remote' : null;
    return {
      id: `career-greenhouse-${sourceId(board.name)}-${sourceId(job.id)}`,
      agency_id: 'general', employer_id: null,
      title: clean(job.title), company: board.label,
      location, closing_date: '',
      notes: htmlToText(job.content || job.description || ''),
      link: job.absolute_url,
      email: '', phone: '', remote,
      experience_level: '', employment_type: '',
      contract_type: '', work_schedule: '', hours: '', salary: '', start_date: '',
      source_type: 'career_board',
      source_checked_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    };
  });
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(1000 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function fetchLeverBoard(board) {
  const payload = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(board.name)}?mode=json`);
  return parseLeverJobs(payload, board);
}

export async function fetchGreenhouseBoard(board) {
  const payload = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.name)}/jobs?content=true`);
  return parseGreenhouseJobs(payload, board);
}

export async function fetchCareerBoard(board) {
  if (board.type === 'lever') return fetchLeverBoard(board);
  if (board.type === 'greenhouse') return fetchGreenhouseBoard(board);
  throw new Error(`Unsupported board type: ${board.type}`);
}

export async function scrapeCareerBoards(boards = parseBoardConfig()) {
  const jobs = [];
  let cursor = 0;
  async function worker() {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      try {
        const boardJobs = await fetchCareerBoard(board);
        jobs.push(...boardJobs);
        console.log(`[career:${board.type}] ${board.name}: ${boardJobs.length} jobs`);
      } catch (error) {
        console.error(`[career:${board.type}] ${board.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, boards.length) }, worker));
  return jobs;
}

export async function upsertCareerBoardJobs(jobs) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database writes');
  if (!jobs.length) return 0;
  const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
  if (error) throw error;
  return jobs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const boards = parseBoardConfig();
  if (!boards.length) {
    console.error('No career boards configured. Set CAREER_BOARDS, for example:');
    console.error('CAREER_BOARDS="lever:company-one,greenhouse:company-two"');
    process.exitCode = 1;
  } else {
    const jobs = await scrapeCareerBoards(boards);
    if (supabase) await upsertCareerBoardJobs(jobs);
    console.log(`[career] completed: ${jobs.length} jobs from ${boards.length} boards`);
  }
}

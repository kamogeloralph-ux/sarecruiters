import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
const ADZUNA_COUNTRY = process.env.ADZUNA_COUNTRY || 'za';
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SCRAPE_REQUEST_TIMEOUT_MS, 30_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersAdzunaSync/1.0 (+https://sa-recruiters.co.za)';
// Free tier is 25 calls/min, 250/day. Keep PAGE_COUNT modest by default —
// four scheduled runs/day x a handful of pages stays well under the daily cap.
const PAGE_COUNT = parsePositiveInt(process.env.ADZUNA_PAGES, 3);
const RESULTS_PER_PAGE = parsePositiveInt(process.env.ADZUNA_RESULTS_PER_PAGE, 50);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.ADZUNA_REQUEST_DELAY_MS, 3_000);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSalary(min, max, isPredicted) {
  if (!min && !max) return '';
  const format = (value) => `R${Math.round(value).toLocaleString('en-US')}`;
  const text = min && max && min !== max
    ? `${format(min)} - ${format(max)}`
    : format(min || max);
  const predicted = isPredicted === '1' || isPredicted === 1 || isPredicted === true;
  return predicted ? `${text} (estimated)` : text;
}

// Maps a raw Adzuna /search response into the shared vacancy shape used by
// the other active vacancy sources.
export function mapAdzunaResults(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const now = new Date().toISOString();

  return results
    .map((item) => {
      const id = item?.id != null ? String(item.id) : null;
      const link = item?.redirect_url || null;
      const title = clean(item?.title);
      if (!id || !link || !title) return null;

      const company = clean(item?.company?.display_name);
      const location = clean(item?.location?.display_name);
      const salary = formatSalary(item?.salary_min, item?.salary_max, item?.salary_is_predicted);
      const contract = clean([item?.contract_time, item?.contract_type].filter(Boolean).join(' '));
      const posted = item?.created ? `Posted ${String(item.created).slice(0, 10)}` : '';
      const description = clean(item?.description).slice(0, 500);
      const notes = clean([salary, contract, posted, description].filter(Boolean).join(' · ')).slice(0, 20_000);

      return {
        id: `adzuna-${id}`,
        title,
        company,
        location,
        notes,
        link,
        source_type: 'adzuna',
        source_checked_at: now,
        last_verified_at: now,
      };
    })
    .filter(Boolean);
}

function searchUrl(page) {
  const params = new URLSearchParams({
    app_id: ADZUNA_APP_ID,
    app_key: ADZUNA_APP_KEY,
    results_per_page: String(RESULTS_PER_PAGE),
    'content-type': 'application/json',
  });
  return `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/${page}?${params.toString()}`;
}

async function fetchPage(page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(searchUrl(page), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.exception || body?.display || `HTTP ${response.status}`;
      throw new Error(`Adzuna returned ${message}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertJobs(mappedJobs) {
  const links = mappedJobs.map((job) => job.link);
  const { data: existingJobs, error: existingError } = links.length
    ? await supabase.from('vacancies').select('id,link').in('link', links).limit(500)
    : { data: [], error: null };
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((job) => [job.link, job.id]));
  const jobs = mappedJobs.map((job) => ({
    ...job,
    id: existingByLink.get(job.link) || job.id,
    agency_id: 'general',
  }));

  if (jobs.length > 0) {
    const { error } = await supabase.from('vacancies').upsert(jobs, { onConflict: 'id' });
    if (error) throw error;
  }
  return jobs;
}

async function syncPage(page) {
  console.log(`[adzuna] page ${page}: fetching ${ADZUNA_COUNTRY}/search/${page}`);
  const payload = await fetchPage(page);
  const mapped = mapAdzunaResults(payload);
  const jobs = await upsertJobs(mapped);
  console.log(`[adzuna] page ${page}: parsed ${mapped.length}, upserted ${jobs.length}`);
  return jobs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) throw new Error('ADZUNA_APP_ID and ADZUNA_APP_KEY are required');

  let failures = 0;
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    try {
      await syncPage(page);
    } catch (error) {
      failures += 1;
      console.error(`[adzuna] page ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page < PAGE_COUNT) await sleep(REQUEST_DELAY_MS);
  }

  if (failures > 0) process.exitCode = 1;
}

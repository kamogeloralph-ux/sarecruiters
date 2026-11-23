import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.JONSSON_REQUEST_TIMEOUT_MS || '30000', 10);
const MAX_VACANCIES = Math.min(Math.max(Number.parseInt(process.env.JONSSON_MAX_VACANCIES || '200', 10), 1), 500);
const BOARD = 'jonssonworkwear';
const API_URL = `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs?content=true`;
const USER_AGENT = 'SA-RecruitersJonssonWorkwearSync/1.0 (+https://sa-recruiters.co.za)';
const ALLOWED_PROVINCES = ['Gauteng', 'KwaZulu-Natal', 'Western Cape'];
const ALLOWED_DEPARTMENTS = ['Retail', 'Manufacturing', 'Technology', 'Tech'];
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function htmlToText(value) {
  let current = String(value ?? '');
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = cheerio.load(current).text();
    if (decoded === current) break;
    current = decoded;
  }
  return clean(cheerio.load(current).text());
}
function postedDate(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}
function departmentNames(item) {
  return Array.isArray(item?.departments)
    ? item.departments.map((entry) => clean(entry?.name)).filter(Boolean)
    : [];
}
function locationName(item) {
  return clean(item?.location?.name || (Array.isArray(item?.offices)
    ? item.offices.map((office) => office?.location || office?.name).filter(Boolean).join(', ')
    : ''));
}
function matchesScope(item) {
  const departments = departmentNames(item);
  const location = locationName(item);
  const departmentOk = departments.some((name) => ALLOWED_DEPARTMENTS.some((allowed) => name.toLowerCase() === allowed.toLowerCase()));
  const provinceOk = ALLOWED_PROVINCES.some((province) => location.toLowerCase().includes(province.toLowerCase()));
  return departmentOk && provinceOk;
}

export function mapJonssonJobs(payload, now = new Date()) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const nowIso = now.toISOString();
  return jobs.map((item) => {
    const externalId = item?.id != null ? String(item.id) : '';
    const title = clean(item?.title);
    const link = clean(item?.absolute_url);
    if (!externalId || !title || !link || !matchesScope(item)) return null;
    const location = locationName(item);
    const posted = postedDate(item?.first_published || item?.updated_at);
    const closingDate = clean(item?.application_deadline);
    const departments = departmentNames(item).join(', ');
    const description = htmlToText(item?.content);
    const notes = clean([
      posted && `Posted ${posted}`,
      departments && `Department: ${departments}`,
      description,
    ].filter(Boolean).join(' · ')).slice(0, 20_000);
    const stale = isStaleVacancy({ closing_date: closingDate, postedText: posted, source_type: 'retail' }, now);
    if (stale.stale) return null;
    return {
      id: `retail-jonsson-${externalId}`,
      title,
      company: clean(item?.company_name) || 'Jonsson Workwear',
      location,
      closing_date: closingDate,
      notes,
      link,
      agency_id: 'general',
      source_type: 'retail',
      source_checked_at: nowIso,
      last_verified_at: nowIso,
    };
  }).filter(Boolean).slice(0, MAX_VACANCIES);
}

async function fetchJobs() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Greenhouse Jonsson Workwear returned HTTP ${response.status}`);
    if (!payload || !Array.isArray(payload.jobs)) throw new Error('Greenhouse Jonsson Workwear returned an invalid jobs payload');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
async function upsertJobs(jobs) {
  if (!jobs.length) return [];
  const links = jobs.map((job) => job.link);
  const { data: existing, error: existingError } = await supabase.from('vacancies').select('id,link').in('link', links).limit(500);
  if (existingError) throw existingError;
  const existingByLink = new Map((existing || []).map((row) => [row.link, row.id]));
  const rows = jobs.map((job) => ({ ...job, id: existingByLink.get(job.link) || job.id }));
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase.from('vacancies').upsert(rows.slice(index, index + 100), { onConflict: 'id' });
    if (error) throw error;
  }
  return rows;
}
async function removeClosed(liveIds) {
  const { data, error } = await supabase.from('vacancies').select('id').eq('source_type', 'retail').like('id', 'retail-jonsson-%').limit(500);
  if (error) throw error;
  const staleIds = (data || []).map((row) => row.id).filter((id) => !liveIds.has(id));
  if (!staleIds.length) return 0;
  const { error: deleteError } = await supabase.from('vacancies').delete().in('id', staleIds);
  if (deleteError) throw deleteError;
  return staleIds.length;
}
export async function runJonssonSync() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const payload = await fetchJobs();
  const jobs = mapJonssonJobs(payload);
  const saved = await upsertJobs(jobs);
  const removed = await removeClosed(new Set(saved.map((job) => job.id)));
  console.log(`[jonsson] received ${payload.jobs.length}, imported ${jobs.length}, upserted ${saved.length}, removed ${removed}`);
  return { received: payload.jobs.length, imported: jobs.length, upserted: saved.length, removed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runJonssonSync().catch((error) => {
    console.error(`[jonsson] sync failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

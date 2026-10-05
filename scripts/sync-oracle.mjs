// ============================================================
//  SA RECRUITERS — scripts/sync-oracle.mjs
// ============================================================
//  Syncs retailer vacancies from Oracle Cloud HCM "Candidate Experience"
//  careers sites into the vacancies table. One script, many employers:
//  add another store by adding an entry to SOURCES below.
//
//  The careers pages are JavaScript shells, so instead of scraping HTML we
//  call the same public JSON REST API the page itself uses:
//    list:   /hcmRestApi/resources/latest/recruitingCEJobRequisitions
//    detail: /hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails
//
//  Vacancies are filed as source_type 'retail' (Retail folder) under the
//  matching employer record, link back to the employer's own apply page, and
//  rows that disappear from a feed are removed so closed jobs don't linger.
//  Each source is isolated: one failing never blocks the others.
//
//  Usage:
//    npm run sync:oracle
//    ORACLE_ONLY=tfg npm run sync:oracle            # just one source
//    DRY_RUN=1 npm run sync:oracle                  # fetch + print, write nothing
//    DEBUG_RAW=1 DRY_RUN=1 npm run sync:oracle      # also dump first raw payloads
// ============================================================

import { pathToFileURL } from 'node:url';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LANG = 'en';
const PAGE_SIZE = Math.min(Math.max(Number.parseInt(process.env.ORACLE_PAGE_SIZE || '24', 10), 1), 50);
const DETAIL_CONCURRENCY = Math.min(Math.max(Number.parseInt(process.env.ORACLE_DETAIL_CONCURRENCY || '3', 10), 1), 6);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.ORACLE_REQUEST_TIMEOUT_MS || '60000', 10);
const FETCH_ATTEMPTS = Number.parseInt(process.env.ORACLE_FETCH_ATTEMPTS || '3', 10);
const MAX_JOBS = Number.parseInt(process.env.ORACLE_MAX_JOBS || '1500', 10);
// Employers may only list their 50 most recent vacancies (see
// scripts/enforce-vacancy-caps.mjs, which enforces this DB-wide as a
// safety net). Sorting + trimming here too means we never fetch job
// details for postings we'd just delete again afterwards.
const MAX_PER_EMPLOYER = Math.max(1, Number.parseInt(process.env.ORACLE_MAX_PER_EMPLOYER || '50', 10));
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const DEBUG_RAW = /^(1|true|yes)$/i.test(process.env.DEBUG_RAW || '');
const USER_AGENT = 'SA-Recruiters-Oracle-Sync/1.0 (+https://sa-recruiters.co.za/)';

// One entry per employer. `employerNames` are matched (case-insensitive,
// contains) against the employers table; the first match gets the vacancies.
// idPrefix must be unique and stable -- it is how closed jobs are cleaned up.
export const SOURCES = {
  mrprice: {
    key: 'mrprice',
    host: 'https://fa-etyi-saasfaprod1.fa.ocs.oraclecloud.com',
    site: 'CX_1001',
    employerNames: ['Mr Price'],
    company: 'Mr Price Group',
    idPrefix: 'retail-mrprice-',
  },
  tfg: {
    key: 'tfg',
    host: 'https://fa-expc-saasfaprod1.fa.ocs.oraclecloud.com',
    site: 'CX_1',
    employerNames: ['TFG', 'Foschini'],
    company: 'TFG',
    idPrefix: 'retail-tfg-',
  },
};

const restBase = (src) => `${src.host}/hcmRestApi/resources/latest`;
const publicJobBase = (src) => `${src.host}/hcmUI/CandidateExperience/${LANG}/sites/${src.site}/job`;

// ---------- helpers (dependency-free so parsers are unit-testable) ----------
function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', bull: '•' };
export function htmlToText(value) {
  return String(value ?? '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// Supabase/PostgREST errors are plain objects ({ message, details, hint, code }),
// not Error instances, so String(error) would print "[object Object]".
export function formatError(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const parts = [error.message, error.details, error.hint, error.code && `code ${error.code}`].filter(Boolean);
  if (parts.length) return parts.join(' | ');
  try { return JSON.stringify(error); } catch (_) { return String(error); }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
export function idForJob(src, reqId) { return `${src.idPrefix}${reqId}`; }
export function publicJobUrl(src, reqId) { return `${publicJobBase(src)}/${encodeURIComponent(reqId)}`; }

// "Cape Town, Western Cape, South Africa" -> "Cape Town, Western Cape"
export function cleanLocation(value) {
  return clean(value).replace(/,?\s*South Africa\s*$/i, '');
}
// Oracle dates come as "2026-09-30", "2026-09-30T00:00:00+00:00" or with a
// time zone suffix. Keep just the calendar date (parseable by the app).
export function toDateOnly(value) {
  const m = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

// ---------- parsers ----------
// The list endpoint nests the requisitions inside items[0].requisitionList.
export function parseSearchPage(payload) {
  const first = payload && Array.isArray(payload.items) ? payload.items[0] : null;
  if (!first) return { total: 0, jobs: [] };
  const list = Array.isArray(first.requisitionList) ? first.requisitionList : [];
  const jobs = list
    .filter((r) => r && r.Id && r.Title)
    .filter((r) => !r.PrimaryLocationCountry || /^(ZA|South Africa)$/i.test(String(r.PrimaryLocationCountry)))
    .map((r) => ({
      reqId: String(r.Id),
      title: clean(r.Title),
      location: cleanLocation(r.PrimaryLocation),
      postedDate: toDateOnly(r.PostedDate),
      family: clean(r.JobFamily || r.JobFunction),
      workplaceType: clean(r.WorkplaceType),
      shortDescription: clean(r.ShortDescriptionStr),
    }));
  return { total: Number(first.TotalJobsCount || 0), rawCount: list.length, jobs };
}

export function parseDetail(payload) {
  const d = payload && Array.isArray(payload.items) ? payload.items[0] : null;
  return d && typeof d === 'object' ? d : null;
}

export function buildVacancy(src, summary, detail, employerId, now = new Date()) {
  if (!summary || !summary.reqId || !summary.title) return null;
  const d = detail || {};
  const sections = [
    d.ExternalDescriptionStr || d.ShortDescriptionStr || summary.shortDescription,
    d.ExternalResponsibilitiesStr ? `Responsibilities\n${htmlToText(d.ExternalResponsibilitiesStr)}` : '',
    d.ExternalQualificationsStr ? `Qualifications\n${htmlToText(d.ExternalQualificationsStr)}` : '',
  ].filter(Boolean);
  // First section may be HTML; the others are already plain text.
  const notes = sections.map((s, i) => (i === 0 ? htmlToText(s) : s)).join('\n\n').slice(0, 20_000);
  const iso = now.toISOString();
  const workplace = clean(d.WorkplaceType || summary.workplaceType).toLowerCase();
  // Production stores workplace as constrained text, not a boolean.
  const remote = workplace.includes('remote') ? 'Remote'
    : workplace.includes('hybrid') ? 'Hybrid'
      : workplace.includes('on-site') || workplace.includes('onsite') ? 'On-site' : null;
  const closingDate = toDateOnly(d.ExternalPostedEndDate);
  // summary.postedDate comes straight from the search API's own PostedDate
  // field (see parseSearchPage) -- always fetched, previously never used
  // for anything. It's a structured, source-provided signal, more reliable
  // than scraping visible "Posted" text off a page.
  const postedText = summary.postedDate || '';
  const stale = isStaleVacancy({ closing_date: closingDate, postedText, source_type: 'retail' }, now);
  if (stale.stale) {
    console.log(`[oracle:${src.key}] skipping ${summary.reqId}: ${stale.reason}`);
    return null;
  }
  return {
    id: idForJob(src, summary.reqId),
    agency_id: employerId ? 'employer' : 'general',
    employer_id: employerId || null,
    title: summary.title,
    company: src.company,
    location: cleanLocation(d.PrimaryLocation) || summary.location,
    closing_date: closingDate,
    notes,
    link: publicJobUrl(src, summary.reqId),
    email: '',
    phone: '',
    remote,
    experience_level: '',
    employment_type: clean(d.JobSchedule || d.ContractType),
    contract_type: clean(d.ContractType),
    work_schedule: '',
    hours: '',
    salary: '',
    start_date: '',
    source_type: 'retail',
    source_checked_at: iso,
    last_verified_at: iso,
    // postedText deliberately omitted because vacancies has no such column;
    // 'vacancies' has no such column and PostgREST rejects the whole
    // upsert batch (PGRST204) if it's present in the payload.
  };
}

// ---------- network ----------
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
      if (attempt < FETCH_ATTEMPTS) await sleep(2000 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

function searchUrl(src, offset) {
  const finder = `findReqs;siteNumber=${src.site},facetsList=LOCATIONS,limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
  return `${restBase(src)}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`;
}
function detailUrl(src, reqId) {
  const finder = `ById;Id="${reqId}",siteNumber=${src.site}`;
  return `${restBase(src)}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`;
}

export async function fetchAllSummaries(src) {
  const tag = `[oracle:${src.key}]`;
  const byId = new Map();
  let expected = 0;
  for (let offset = 0; offset < MAX_JOBS; offset += PAGE_SIZE) {
    const payload = await fetchJson(searchUrl(src, offset));
    if (DEBUG_RAW && offset === 0) console.log(`${tag} RAW search payload:`, JSON.stringify(payload).slice(0, 3000));
    const page = parseSearchPage(payload);
    expected = page.total || expected;
    page.jobs.forEach((job) => byId.set(job.reqId, job));
    console.log(`${tag} search offset ${offset}: ${page.jobs.length} jobs (total reported ${page.total})`);
    if (!page.rawCount || page.rawCount < PAGE_SIZE || byId.size >= expected) break;
    await sleep(400);
  }
  return { summaries: [...byId.values()], expected };
}

async function fetchDetails(src, summaries, employerId) {
  const tag = `[oracle:${src.key}]`;
  const jobs = [];
  let cursor = 0;
  let detailFailures = 0;
  async function worker() {
    while (cursor < summaries.length) {
      const summary = summaries[cursor++];
      let detail = null;
      try {
        const payload = await fetchJson(detailUrl(src, summary.reqId));
        if (DEBUG_RAW && cursor === 1) console.log(`${tag} RAW detail payload:`, JSON.stringify(payload).slice(0, 4000));
        detail = parseDetail(payload);
      } catch (error) {
        detailFailures += 1;
        console.error(`${tag} detail failed for ${summary.reqId}: ${formatError(error)}`);
      }
      // A failed detail call still yields a usable listing from the search data.
      const job = buildVacancy(src, summary, detail, employerId);
      if (job) jobs.push(job);
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, summaries.length) }, worker));
  return { jobs, detailFailures };
}

// ---------- database ----------
async function loadSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function resolveEmployerId(supabase, src) {
  const tag = `[oracle:${src.key}]`;
  for (const name of src.employerNames) {
    try {
      const { data, error } = await supabase.from('employers').select('id,name').ilike('name', `%${name}%`).limit(1);
      if (!error && data && data[0]) { console.log(`${tag} employer: ${data[0].name} (${data[0].id})`); return data[0].id; }
    } catch (_) { /* try next alias */ }
  }
  console.error(`${tag} no employers record matching ${src.employerNames.map((n) => `"${n}"`).join(' / ')} -- vacancies will be filed as general. Add the employer in admin.`);
  return null;
}

// Removes this source's rows that are no longer in the feed (job closed/filled).
// Only runs when we clearly got the whole feed, so a partial/failed fetch can
// never wipe the list.
// Upserts in small batches. If a batch is rejected, retry its rows one by one
// so a single bad row is reported (with its id) instead of losing the batch.
async function upsertJobs(supabase, src, jobs) {
  const tag = `[oracle:${src.key}]`;
  const CHUNK = 40;
  let saved = 0;
  const failures = [];
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const chunk = jobs.slice(i, i + CHUNK);
    const { error } = await supabase.from('vacancies').upsert(chunk, { onConflict: 'id' });
    if (!error) { saved += chunk.length; continue; }
    console.error(`${tag} batch ${i}-${i + chunk.length - 1} rejected: ${formatError(error)} -- retrying row by row`);
    for (const job of chunk) {
      const { error: rowError } = await supabase.from('vacancies').upsert(job, { onConflict: 'id' });
      if (rowError) { failures.push({ id: job.id, error: formatError(rowError) }); if (failures.length <= 5) console.error(`${tag} row ${job.id} failed: ${formatError(rowError)}`); }
      else saved += 1;
    }
  }
  return { saved, failures };
}

async function removeClosed(supabase, src, liveIds) {
  const { data, error } = await supabase.from('vacancies').select('id').like('id', `${src.idPrefix}%`);
  if (error) throw error;
  const stale = (data || []).map((r) => r.id).filter((id) => !liveIds.has(id));
  if (!stale.length) return 0;
  const { error: delError } = await supabase.from('vacancies').delete().in('id', stale);
  if (delError) throw delError;
  return stale.length;
}

export async function runSource(src, supabase) {
  const tag = `[oracle:${src.key}]`;
  const { summaries, expected } = await fetchAllSummaries(src);
  if (!summaries.length) throw new Error('Search returned no jobs -- refusing to continue (API shape may have changed). Re-run with DEBUG_RAW=1 DRY_RUN=1.');
  const employerId = supabase ? await resolveEmployerId(supabase, src) : null;

  // Newest postedDate first, then only take the top MAX_PER_EMPLOYER —
  // removeClosed() below deletes any existing row for this employer that
  // isn't in that set, so this is what actually enforces the 50-latest cap
  // for this source (in addition to the DB-wide safety net script).
  const summariesToFetch = [...summaries]
    .sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''))
    .slice(0, MAX_PER_EMPLOYER);
  if (summariesToFetch.length < summaries.length) {
    console.log(`${tag} ${summaries.length} live postings found; keeping newest ${summariesToFetch.length} (cap ${MAX_PER_EMPLOYER})`);
  }

  const { jobs, detailFailures } = await fetchDetails(src, summariesToFetch, employerId);
  console.log(`${tag} built ${jobs.length} vacancies (${detailFailures} detail fetch failures)`);

  if (DRY_RUN) {
    jobs.slice(0, 3).forEach((j) => console.log(`${tag} sample:`, JSON.stringify({ ...j, notes: j.notes.slice(0, 200) }, null, 2)));
    return { fetched: jobs.length, upserted: 0, removed: 0, dryRun: true };
  }

  const { saved, failures } = await upsertJobs(supabase, src, jobs);
  if (!saved) throw new Error(`no vacancies could be saved (${failures.length} rejected). First error: ${failures[0] ? failures[0].error : 'unknown'}`);
  if (failures.length) console.warn(`${tag} ${failures.length} vacancies were rejected and skipped`);

  let removed = 0;
  const gotWholeFeed = expected > 0 && summaries.length >= Math.floor(expected * 0.9);
  if (gotWholeFeed) removed = await removeClosed(supabase, src, new Set(jobs.map((j) => j.id)));
  else console.warn(`${tag} skipped closed-job cleanup: fetched ${summaries.length} of ${expected} reported`);
  return { fetched: jobs.length, upserted: saved, rejected: failures.length, removed, detailFailures };
}

export function selectSources(only = process.env.ORACLE_ONLY || '') {
  const keys = only.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (!keys.length) return Object.values(SOURCES);
  const unknown = keys.filter((k) => !SOURCES[k]);
  if (unknown.length) throw new Error(`Unknown ORACLE_ONLY source(s): ${unknown.join(', ')}. Known: ${Object.keys(SOURCES).join(', ')}`);
  return keys.map((k) => SOURCES[k]);
}

export async function runOracleSync() {
  const sources = selectSources();
  const supabase = DRY_RUN ? null : await loadSupabase();
  const results = {};
  let failed = 0;
  for (const src of sources) {
    try {
      results[src.key] = await runSource(src, supabase);
    } catch (error) {
      failed += 1;
      results[src.key] = { error: formatError(error) };
      console.error(`[oracle:${src.key}] failed: ${results[src.key].error}`);
    }
  }
  return { results, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { results, failed } = await runOracleSync();
    console.log(`[oracle] completed: ${JSON.stringify(results)}`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`[oracle] failed: ${formatError(error)}`);
    process.exitCode = 1;
  }
}

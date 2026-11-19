import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUCCESSFUL_SOURCES_FILE = process.env.SUCCESSFUL_SOURCES_FILE || 'successful-sources.txt';
const RUN_STARTED_AT = process.env.RUN_STARTED_AT || new Date().toISOString();
const GRACE_HOURS = Math.max(24, Number(process.env.SOURCE_STALE_GRACE_HOURS || 72));
const PAGE_SIZE = 1000;
const DELETE_CHUNK = 200;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const SOURCE_GROUPS = {
  adzuna: ['adzuna'],
  jooble: ['jooble'],
  himalayas: ['himalayas'],
  simplify: ['simplify'],
  learnerships: ['learnerships'],
  government: ['government'],
  careers_page: ['careers_page'],
  // Oracle and the retail scraper share source_type=retail. Reconcile this
  // group only when both jobs completed; otherwise a partial retail refresh
  // could delete valid rows from the other scraper.
  retail: ['retail'],
};

function readLines(path) {
  try {
    return new Set(String(readFileSync(path, 'utf8'))
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function cutoffIso(referenceNow = new Date()) {
  return new Date(referenceNow.getTime() - GRACE_HOURS * 3600000).toISOString();
}

async function loadAllVacancies() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from('vacancies')
      .select('id,title,closing_date,notes,source_type,created_at,updated_at,source_checked_at,last_verified_at')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

function sourceWasSuccessful(successful, source) {
  if (source === 'retail') return successful.has('oracle') && successful.has('retail');
  if (source === 'careers_page') return successful.has('careers-page') || successful.has('careers_page');
  if (source === 'learnerships') return successful.has('graduates24') || successful.has('learnerships');
  return successful.has(source);
}

function collectDeletes(rows, successful, now = new Date()) {
  const cutoff = cutoffIso(now);
  const deleted = [];
  const byReason = {};
  for (const row of rows) {
    const source = String(row.source_type || '');
    const freshness = isStaleVacancy(row, now);
    let reason = freshness.stale ? freshness.reason : '';
    if (!reason && SOURCE_GROUPS[source] && sourceWasSuccessful(successful, source)) {
      const lastSeen = row.source_checked_at || row.last_verified_at || row.updated_at || row.created_at;
      if (!lastSeen || String(lastSeen) < cutoff) reason = `not seen in successful ${source} refresh since ${cutoff}`;
    }
    if (reason) {
      deleted.push(row);
      const key = source || 'unknown';
      byReason[key] = byReason[key] || { count: 0, samples: [] };
      byReason[key].count += 1;
      if (byReason[key].samples.length < 3) byReason[key].samples.push(`${row.title || row.id}: ${reason}`);
    }
  }
  return { deleted, byReason, cutoff };
}

async function deleteRows(rows) {
  let deleted = 0;
  for (let i = 0; i < rows.length; i += DELETE_CHUNK) {
    const ids = rows.slice(i, i + DELETE_CHUNK).map((row) => row.id);
    const { error } = await supabase.from('vacancies').delete().in('id', ids);
    if (error) throw error;
    deleted += ids.length;
  }
  return deleted;
}

export async function reconcileVacancyFreshness({ rows, successfulSources = new Set(), now = new Date() } = {}) {
  const originalRun = RUN_STARTED_AT;
  const result = collectDeletes(rows || [], successfulSources, now);
  return { ...result, total: (rows || []).length, now: now.toISOString(), run_started_at: originalRun };
}

export async function run() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const successful = readLines(SUCCESSFUL_SOURCES_FILE);
  const rows = await loadAllVacancies();
  const result = collectDeletes(rows, successful, new Date());
  console.log(`[reconcile] loaded ${rows.length}; successful sources: ${[...successful].join(', ') || 'none'}; grace: ${GRACE_HOURS}h`);
  for (const [source, info] of Object.entries(result.byReason)) {
    console.log(`[reconcile] ${source}: ${info.count} delete candidate(s)`);
    for (const sample of info.samples) console.log(`  ${sample}`);
  }
  if (!result.deleted.length) {
    console.log('[reconcile] no expired or source-stale vacancies');
    return { ...result, deleted_count: 0 };
  }
  if (process.env.DRY_RUN === '1') {
    console.log(`[reconcile] DRY RUN: would delete ${result.deleted.length}`);
    return { ...result, deleted_count: 0, dry_run: true };
  }
  const deletedCount = await deleteRows(result.deleted);
  console.log(`[reconcile] deleted ${deletedCount}; kept ${rows.length - deletedCount}`);
  return { ...result, deleted_count: deletedCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('[reconcile] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

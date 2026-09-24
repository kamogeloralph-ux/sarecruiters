// ============================================================
//  SA RECRUITERS — scripts/purge-stale-vacancies.mjs
// ============================================================
//  One-off (but safely re-runnable) purge of every stale scraped/synced
//  vacancy in the database, requested after users kept tapping "Apply" on
//  listings whose postings were years old — most visibly the 2021
//  learnerships still listed on Graduates24.
//
// Deletes rows whose explicit closing date has passed, whose posted date in
// notes is older than that source's freshness window, or whose created_at is
// older than the source window when no other date is available. This makes
// the cleanup complete for imported rows that show old July/August dates but
// have no structured closing_date.
//
//  Usage:
//    npm run purge:stale          # delete + print summary
//    DRY_RUN=1 npm run purge:stale   # report only, delete nothing
//
//  Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role, since
//  it deletes across all sources; same secrets the other sync scripts use).
// ============================================================

import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const PAGE_SIZE = 1000;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

async function loadAllVacancies() {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('vacancies')
      .select('id,title,link,notes,closing_date,source_type,created_at')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function run() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  console.log(`[purge] loading vacancies${DRY_RUN ? ' (DRY RUN — nothing will be deleted)' : ''}...`);
  const vacancies = await loadAllVacancies();
  console.log(`[purge] ${vacancies.length} vacancy row(s) in database`);

  const now = new Date();
  const toDelete = [];
  const reasonsBySource = {};

  for (const row of vacancies) {
    const check = isStaleVacancy({
      closing_date: row.closing_date,
      notes: row.notes,
      created_at: row.created_at,
      source_type: row.source_type,
    }, now);
    if (check.stale) {
      toDelete.push({ id: row.id, title: row.title, source: row.source_type || 'unknown', reason: check.reason });
      continue;
    }
  }

  for (const item of toDelete) {
    reasonsBySource[item.source] = reasonsBySource[item.source] || { count: 0, sample: [] };
    reasonsBySource[item.source].count += 1;
    if (reasonsBySource[item.source].sample.length < 3) {
      reasonsBySource[item.source].sample.push(`"${item.title}" — ${item.reason}`);
    }
  }

  console.log('[purge] stale rows by source:');
  for (const [source, info] of Object.entries(reasonsBySource)) {
    console.log(`  ${source}: ${info.count}`);
    for (const line of info.sample) console.log(`    e.g. ${line}`);
  }

  if (!toDelete.length) {
    console.log('[purge] nothing to delete');
    return;
  }
  if (DRY_RUN) {
    console.log(`[purge] DRY RUN: would delete ${toDelete.length} row(s). Re-run without DRY_RUN to apply.`);
    return;
  }

  // Delete in chunks; .in() with thousands of ids can exceed URL limits.
  const CHUNK = 200;
  let deleted = 0, failed = 0;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const ids = toDelete.slice(i, i + CHUNK).map((item) => item.id);
    const { error } = await supabase.from('vacancies').delete().in('id', ids);
    if (error) {
      failed += ids.length;
      console.error(`[purge] chunk delete failed (${ids.length} ids): ${error.message}`);
    } else {
      deleted += ids.length;
    }
  }
  console.log(`[purge] done: ${deleted} deleted, ${failed} failed, ${vacancies.length - toDelete.length} kept`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('[purge] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

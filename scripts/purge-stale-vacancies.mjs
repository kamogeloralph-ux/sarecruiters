// ============================================================
//  SA RECRUITERS — scripts/purge-stale-vacancies.mjs
// ============================================================
//  One-off (but safely re-runnable) purge of every stale scraped/synced
//  vacancy in the database, requested after users kept tapping "Apply" on
//  listings whose postings were years old — most visibly the 2021
//  learnerships still listed on Graduates24.
//
//  Deletes rows where ANY of these hold:
//    1. Stale by the shared freshness rules (scripts/vacancy-freshness.mjs):
//       a parsed closing date in the past, or a posting older than the
//       source's max age (21d jobmail, 30d learnerships/retail, 45d job
//       boards, 90d government).
//    2. Older than the per-source TTL on row age (mirrors
//       delete_expired_vacancies() in 20260919b_per_source_vacancy_ttl.sql)
//       — catches rows whose listing page never showed a parseable date.
//
//  Rows with NO parseable dates anywhere (no closing date, no posted text
//  in notes, created_at missing) are left alone by rule 1 and handled by
//  rule 2 via their row age — deliberately conservative.
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
import { isStaleVacancy, maxAgeDaysForSource } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const PAGE_SIZE = 1000;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function ttlCutoffFor(sourceType) {
  const days = maxAgeDaysForSource(sourceType);
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

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
    // Rule 1: content-based staleness (closing date / posting age).
    const check = isStaleVacancy(row, now);
    if (check.stale) {
      toDelete.push({ id: row.id, title: row.title, source: row.source_type || 'unknown', reason: check.reason });
      continue;
    }
    // Rule 2: row-age TTL fallback (same ceilings as the SQL function).
    const cutoff = ttlCutoffFor(row.source_type);
    if (row.created_at && row.created_at < cutoff) {
      toDelete.push({ id: row.id, title: row.title, source: row.source_type || 'unknown', reason: `row older than ${maxAgeDaysForSource(row.source_type)}d TTL` });
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

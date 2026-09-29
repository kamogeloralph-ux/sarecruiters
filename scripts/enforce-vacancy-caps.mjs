// ============================================================
//  SA RECRUITERS — scripts/enforce-vacancy-caps.mjs
// ============================================================
//  Agencies, companies and employers may only list their MAX_PER_POSTER
//  (default 50) most recent vacancies at a time. This is separate from
//  purge-stale-vacancies.mjs (which removes listings that are individually
//  out of date) — this script instead caps how many a single poster can
//  have live at once, regardless of whether each one is still "fresh".
//
//  Scope: only rows tied to a specific agency or employer are capped —
//    - agency_id set to a real agency UUID (not the 'general' / 'employer'
//      sentinels used by scrapers with no specific poster)
//    - employer_id set to a real employer UUID
//  General/aggregator listings (Adzuna, Himalayas, government, careers-page,
//  etc. with no agency/employer attached) are untouched here; they're
//  already governed by their own per-source freshness window in
//  vacancy-freshness.mjs.
//
//  For each poster with more than the cap, the newest `cap` rows (by
//  created_at) are kept and everything older is deleted. Safe to run
//  repeatedly — posters under the cap are left alone.
//
//  Usage:
//    npm run enforce:vacancy-caps            # delete + print summary
//    DRY_RUN=1 npm run enforce:vacancy-caps  # report only, delete nothing
//    MAX_PER_POSTER=25 npm run enforce:vacancy-caps   # override the cap
//
//  Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same secrets the
//  other sync/purge scripts use).
// ============================================================

import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const PAGE_SIZE = 1000;
const CAP = Math.max(1, Number.parseInt(process.env.MAX_PER_POSTER || '50', 10));

// agency_id values that don't refer to a real agency row — used by
// scrapers/sync scripts when a vacancy has no specific poster.
const AGENCY_SENTINELS = new Set(['general', 'employer']);

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

async function loadAllVacancies() {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('vacancies')
      .select('id,title,agency_id,employer_id,created_at')
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

async function loadNames(table, ids) {
  const names = new Map();
  const idList = [...ids];
  const CHUNK = 200;
  for (let i = 0; i < idList.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(table)
      .select('id,name')
      .in('id', idList.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of data || []) names.set(row.id, row.name);
  }
  return names;
}

// Groups rows by key, keeps the newest `cap` per group (rows already sorted
// created_at DESC), and returns the rest as a flat list to delete.
function collectOverflow(rows, keyFn, cap) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const overflowByKey = new Map();
  for (const [key, group] of groups) {
    if (group.length > cap) overflowByKey.set(key, group.slice(cap));
  }
  return overflowByKey;
}

async function run() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  console.log(`[caps] loading vacancies${DRY_RUN ? ' (DRY RUN — nothing will be deleted)' : ''}...`);
  const vacancies = await loadAllVacancies();
  console.log(`[caps] ${vacancies.length} vacancy row(s) in database, cap = ${CAP} per agency/employer`);

  // vacancies is already created_at DESC from the query above, so within
  // each group below "first CAP" == "newest CAP".
  const overflowByAgency = collectOverflow(
    vacancies,
    (row) => (row.agency_id && !AGENCY_SENTINELS.has(row.agency_id) ? row.agency_id : null),
    CAP,
  );
  const overflowByEmployer = collectOverflow(
    vacancies,
    (row) => row.employer_id || null,
    CAP,
  );

  const toDeleteIds = new Set();
  for (const rows of overflowByAgency.values()) for (const row of rows) toDeleteIds.add(row.id);
  for (const rows of overflowByEmployer.values()) for (const row of rows) toDeleteIds.add(row.id);

  if (!toDeleteIds.size) {
    console.log('[caps] every agency and employer is at or under the cap — nothing to trim');
    return;
  }

  const agencyNames = await loadNames('agencies', overflowByAgency.keys());
  const employerNames = await loadNames('employers', overflowByEmployer.keys());

  console.log('[caps] agencies over the cap:');
  for (const [id, rows] of overflowByAgency) {
    console.log(`  ${agencyNames.get(id) || id}: trimming ${rows.length} oldest (keeping newest ${CAP})`);
  }
  console.log('[caps] employers over the cap:');
  for (const [id, rows] of overflowByEmployer) {
    console.log(`  ${employerNames.get(id) || id}: trimming ${rows.length} oldest (keeping newest ${CAP})`);
  }

  console.log(`[caps] ${toDeleteIds.size} row(s) total to delete`);
  if (DRY_RUN) {
    console.log(`[caps] DRY RUN: would delete ${toDeleteIds.size} row(s). Re-run without DRY_RUN to apply.`);
    return;
  }

  const ids = [...toDeleteIds];
  const CHUNK = 200;
  let deleted = 0, failed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from('vacancies').delete().in('id', chunk);
    if (error) {
      failed += chunk.length;
      console.error(`[caps] chunk delete failed (${chunk.length} ids): ${error.message}`);
    } else {
      deleted += chunk.length;
    }
  }
  console.log(`[caps] done: ${deleted} deleted, ${failed} failed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('[caps] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

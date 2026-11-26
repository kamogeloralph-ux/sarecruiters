// ============================================================
//  SA RECRUITERS — scripts/source-yield-report.mjs
// ============================================================
//  After every refresh, count how many vacancies each source currently holds
//  (Supabase scrapers + the Cloudflare ATS feeds), compare with the previous
//  run, and put the table in the GitHub step summary. A source whose count
//  collapses raises a workflow warning annotation.
//
//  Why: a source can "succeed" (exit 0) while contributing almost nothing:
//  Adzuna held ~150 rows for months and Jooble returned zero with HTTP 200.
//  Nothing alerted because nothing was measuring volume. This is
//  informational only and never fails the refresh.
// ============================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DROP_WARN_RATIO = 0.5;   // warn when a source falls below 50% of last run
export const DROP_WARN_MIN_PREVIOUS = 40; // ...but only if it used to hold at least this many

export function countBySource(rows) {
  const counts = {};
  for (const row of rows || []) {
    const key = String(row?.source_type || '(none)');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function compareYield(previous = {}, current = {}) {
  const sources = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();
  return sources.map((source) => {
    const before = Number(previous[source] || 0);
    const now = Number(current[source] || 0);
    const collapsed = before >= DROP_WARN_MIN_PREVIOUS && now < before * DROP_WARN_RATIO;
    return { source, before, now, delta: now - before, collapsed };
  });
}

export function renderYieldTable(rows, atsFeeds = []) {
  const lines = ['## Vacancy yield by source', '', '| Source | Now | Previous run | Change |', '|---|---:|---:|---:|'];
  for (const r of rows) lines.push(`| ${r.source}${r.collapsed ? ' ⚠️' : ''} | ${r.now} | ${r.before} | ${r.delta >= 0 ? '+' : ''}${r.delta} |`);
  lines.push('', `**Total in Supabase: ${rows.reduce((sum, r) => sum + r.now, 0)}**`);
  if (atsFeeds.length) {
    lines.push('', '## ATS feeds (Cloudflare D1)', '', '| Feed | Mode | Rows held | Last status | Last synced |', '|---|---|---:|---|---|');
    for (const f of atsFeeds) lines.push(`| ${f.id} | ${f.mode} | ${f.rows_held} | ${String(f.last_status || '').replace(/\|/g, '/')} | ${f.last_synced_at || 'never'} |`);
  }
  return lines.join('\n');
}

async function loadSourceTypes(supabase) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('vacancies').select('source_type').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function loadAtsFeeds() {
  const base = process.env.WORKER_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return [];
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/api/ats/status`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return [];
    return (await response.json())?.feeds || [];
  } catch { return []; }
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.log('[yield] Supabase credentials missing; skipping'); return; }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const current = countBySource(await loadSourceTypes(supabase));
  const stateFile = '.scraper-state/source-counts.json';
  let previous = {};
  try { if (existsSync(stateFile)) previous = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { previous = {}; }
  const rows = compareYield(previous, current);
  mkdirSync('.scraper-state', { recursive: true });
  writeFileSync(stateFile, JSON.stringify(current));
  const table = renderYieldTable(rows, await loadAtsFeeds());
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${table}\n`);
  for (const r of rows.filter((x) => x.collapsed)) {
    console.log(`::warning title=Source yield collapsed::${r.source} dropped from ${r.before} to ${r.now} vacancies since the previous refresh`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error('[yield] report failed:', error instanceof Error ? error.message : error); });
}

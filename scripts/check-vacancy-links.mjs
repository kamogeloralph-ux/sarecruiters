import { createClient } from '@supabase/supabase-js';
import { sendOpsEmail } from './send-ops-email.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });

// Only these mean "the job page is really gone". Everything else (403 bot
// blocks, 429 rate limits, 5xx, timeouts, network blips) is inconclusive:
// big job boards block GitHub's servers, which says nothing about the link.
const DEAD_STATUSES = new Set([404, 410]);
const DEAD_ERROR_CODES = new Set(['ENOTFOUND']);
// Consecutive "really gone" checks before a vacancy is flagged and emailed (once).
const REPORT_AT = 3;
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-ZA,en;q=0.9',
};

const result = await db.from('vacancies').select('id,title,link').not('link', 'is', null).neq('link', '').order('updated_at', { ascending: false }).limit(500);
if (result.error) throw result.error;
let dead = 0; let inconclusive = 0; const lines = [];
for (const row of result.data || []) {
  let status = 0; let finalUrl = row.link; let error = ''; let isDead = false;
  try {
    let response = await fetch(row.link, { method: 'HEAD', headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!response.ok) response = await fetch(row.link, { method: 'GET', headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    status = response.status; finalUrl = response.url || row.link;
    if (!response.ok) { error = `HTTP ${response.status}`; isDead = DEAD_STATUSES.has(response.status); }
  } catch (e) {
    error = e.message;
    isDead = DEAD_ERROR_CODES.has(e?.cause?.code || e?.code);
  }
  const old = await db.from('vacancy_link_checks').select('failure_count').eq('vacancy_id', row.id).maybeSingle();
  const previous = old.data?.failure_count || 0;
  // Inconclusive results neither count against the link nor clear earlier evidence.
  const next = !error ? 0 : isDead ? previous + 1 : previous;
  const upsert = await db.from('vacancy_link_checks').upsert({ vacancy_id: row.id, url: row.link, http_status: status || null, final_url: finalUrl, failure_count: next, last_error: error || null, checked_at: new Date().toISOString(), last_success_at: error ? undefined : new Date().toISOString(), action_taken: next >= REPORT_AT ? 'review' : null }, { onConflict: 'vacancy_id' });
  if (upsert.error) throw upsert.error;
  if (error && isDead) { dead++; if (next === REPORT_AT) lines.push(`${row.title}: ${error} (${next} checks in a row)\n  ${row.link}`); }
  else if (error) inconclusive++;
}
console.log(`[links] checked ${(result.data || []).length}; dead ${dead}; inconclusive (blocked/timeouts, ignored) ${inconclusive}; newly reported ${lines.length}`);
if (lines.length) await sendOpsEmail({ subject: `SA Recruiters: ${lines.length} job link${lines.length === 1 ? '' : 's'} confirmed dead`, text: lines.join('\n') });

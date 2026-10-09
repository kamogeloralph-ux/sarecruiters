import { createClient } from '@supabase/supabase-js';
import { sendOpsEmail } from './send-ops-email.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });
const result = await db.from('vacancies').select('id,title,link').not('link', 'is', null).neq('link', '').order('updated_at', { ascending: false }).limit(500);
if (result.error) throw result.error;
let failed = 0; const lines = [];
for (const row of result.data || []) {
  let status = 0; let finalUrl = row.link; let error = '';
  try {
    let response = await fetch(row.link, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if ([403, 405].includes(response.status)) response = await fetch(row.link, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(12000) });
    status = response.status; finalUrl = response.url || row.link;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (e) { error = e.message; }
  const old = await db.from('vacancy_link_checks').select('failure_count').eq('vacancy_id', row.id).maybeSingle();
  const previous = old.data?.failure_count || 0;
  const next = error ? previous + 1 : 0;
  const upsert = await db.from('vacancy_link_checks').upsert({ vacancy_id: row.id, url: row.link, http_status: status || null, final_url: finalUrl, failure_count: next, last_error: error || null, checked_at: new Date().toISOString(), last_success_at: error ? undefined : new Date().toISOString(), action_taken: next >= 2 ? 'review' : null }, { onConflict: 'vacancy_id' });
  if (upsert.error) throw upsert.error;
  if (error) { failed++; if (next >= 2) lines.push(`${row.title}: ${error} (${next} consecutive failures)`); }
}
console.log(`[links] checked ${(result.data || []).length}; failed ${failed}; repeated failures ${lines.length}`);
if (lines.length) await sendOpsEmail({ subject: `SA Recruiters link check: ${lines.length} repeated failures`, text: lines.join('\n') });

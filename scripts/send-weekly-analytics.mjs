import { createClient } from '@supabase/supabase-js';
import { sendOpsEmail } from './send-ops-email.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - 7 * 864e5).toISOString();
const result = await db.from('analytics_events').select('event_name').gte('created_at', since).limit(10000);
if (result.error) throw result.error;
const counts = new Map();
for (const row of result.data || []) counts.set(row.event_name, (counts.get(row.event_name) || 0) + 1);
const lines = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}: ${count}`);
const text = `SA Recruiters weekly analytics\nPeriod start: ${since}\nTotal events: ${(result.data || []).length}\n\n${lines.join('\n') || 'No public events recorded.'}`;
console.log(text);
await sendOpsEmail({ subject: 'SA Recruiters weekly analytics', text });

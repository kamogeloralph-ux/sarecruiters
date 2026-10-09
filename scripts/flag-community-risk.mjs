import { createClient } from '@supabase/supabase-js';
import { sendOpsEmail } from './send-ops-email.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });
const patterns = [
  ['payment_request', /pay\s+(?:a\s+)?(?:fee|deposit|registration|training)|send\s+money|upfront\s+payment/i],
  ['off_platform_contact', /whatsapp|telegram|signal|\+?27\s*\d{2}\s*\d{3}\s*\d{4}/i],
  ['credential_request', /send\s+(?:your\s+)?password|otp|one[- ]time password|banking details/i],
  ['mass_promotion', /guaranteed\s+(?:job|placement)|act\s+now|limited\s+slots|click\s+here/i],
];
const [posts, comments] = await Promise.all([
  db.from('community_posts').select('id,body,status').eq('status', 'pending').order('created_at', { ascending: false }).limit(200),
  db.from('community_comments').select('id,body,status').eq('status', 'pending').order('created_at', { ascending: false }).limit(200),
]);
if (posts.error) throw posts.error;
if (comments.error) throw comments.error;
const flags = [];
for (const [type, rows] of [['post', posts.data || []], ['comment', comments.data || []]]) {
  for (const row of rows) {
    const matched = patterns.filter(([, pattern]) => pattern.test(String(row.body || ''))).map(([name]) => name);
    if (!matched.length) continue;
    const result = await db.from('community_automated_flags').upsert({ content_type: type, content_id: row.id, reasons: matched, matched_terms: matched }, { onConflict: 'content_type,content_id' });
    if (result.error) throw result.error;
    flags.push(`${type} ${row.id}: ${matched.join(', ')}`);
  }
}
console.log(`[moderation] flagged ${flags.length} pending item(s)`);
if (flags.length) await sendOpsEmail({ subject: `SA Recruiters moderation flags: ${flags.length}`, text: flags.join('\n') });

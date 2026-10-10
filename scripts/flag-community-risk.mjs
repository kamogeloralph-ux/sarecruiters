import { sendOpsEmail } from './send-ops-email.mjs';

// TipChat moderation sweep (hourly):
//  1. flags risky pending posts/comments (shown to moderators inside the app), and
//  2. emails the moderator ONE digest of everything newly awaiting review, so nothing
//     sits unseen until somebody happens to open TipChat.
const SITE = process.env.SITE_URL || 'https://sa-recruiters.co.za';
const patterns = [
  ['payment_request', /pay\s+(?:a\s+)?(?:fee|deposit|registration|training)|send\s+money|upfront\s+payment/i],
  // Legitimate vacancy posts almost always carry a WhatsApp/phone contact, so this signal is
  // only applied to discussion posts and comments (see isVacancy below).
  ['off_platform_contact', /whatsapp|telegram|signal|\+?27\s*\d{2}\s*\d{3}\s*\d{4}/i],
  ['credential_request', /send\s+(?:your\s+)?password|otp|one[- ]time password|banking details/i],
  ['mass_promotion', /guaranteed\s+(?:job|placement)|act\s+now|limited\s+slots|click\s+here/i],
];

// When TipChat Autopilot is live it resolves submissions itself (and the Cloudflare watchdog
// sends the daily summary), so the hourly "please review" email would only be noise. In
// 'shadow' or 'off' mode (or if the Autopilot table does not exist yet) humans still
// moderate, so the digest keeps working exactly as before.
export function shouldEmailModeratorDigest(autopilotMode) {
  return autopilotMode !== 'live';
}

export function matchRisk(body, { isVacancy = false } = {}) {
  return patterns
    .filter(([name, pattern]) => !(isVacancy && name === 'off_platform_contact') && pattern.test(String(body || '')))
    .map(([name]) => name);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const autopilot = await db.from('community_automod_settings').select('mode').eq('id', true).maybeSingle();
  const autopilotMode = autopilot.error ? null : (autopilot.data && autopilot.data.mode) || null;
  if (!shouldEmailModeratorDigest(autopilotMode)) {
    console.log('[moderation] TipChat Autopilot is live; skipping the manual-review digest');
    return;
  }
  const [posts, comments] = await Promise.all([
    db.from('community_posts').select('id,body,post_type,vacancy_title,notified_at,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(200),
    db.from('community_comments').select('id,body,notified_at,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(200),
  ]);
  if (posts.error) throw posts.error;
  if (comments.error) throw comments.error;

  const fresh = [];
  let flaggedCount = 0;
  for (const [type, table, rows] of [['post', 'community_posts', posts.data || []], ['comment', 'community_comments', comments.data || []]]) {
    for (const row of rows) {
      const matched = matchRisk(row.body, { isVacancy: type === 'post' && row.post_type === 'vacancy' });
      if (matched.length) {
        const result = await db.from('community_automated_flags').upsert({ content_type: type, content_id: row.id, reasons: matched, matched_terms: matched }, { onConflict: 'content_type,content_id' });
        if (result.error) throw result.error;
        flaggedCount++;
      }
      if (!row.notified_at) fresh.push({ type, table, row, matched });
    }
  }
  console.log(`[moderation] ${flaggedCount} flagged, ${fresh.length} newly awaiting review`);
  if (!fresh.length) return;

  const lines = fresh.map(({ type, row, matched }) => {
    const label = type === 'post' ? (row.post_type === 'vacancy' ? 'Vacancy' : 'Post') : 'Comment';
    const snippet = String(row.body || '').replace(/\s+/g, ' ').slice(0, 140);
    return `${matched.length ? '⚠ ' : ''}${label}: ${snippet}${matched.length ? `  [flag: ${matched.join(', ')}]` : ''}`;
  });
  const flagged = fresh.filter((item) => item.matched.length).length;
  const text = `${fresh.length} new TipChat item(s) are awaiting moderation${flagged ? ` (${flagged} automatically flagged)` : ''}.\n\n${lines.join('\n')}\n\nReview them in the app: ${SITE}/#tipchat → Moderation queue`;
  const sent = await sendOpsEmail({ subject: `TipChat: ${fresh.length} awaiting moderation${flagged ? ` (${flagged} flagged)` : ''}`, text });
  if (!sent.sent) { console.warn('[moderation] email not sent; items stay un-notified and will be retried'); return; }

  const stamp = new Date().toISOString();
  for (const table of ['community_posts', 'community_comments']) {
    const ids = fresh.filter((item) => item.table === table).map((item) => item.row.id);
    if (!ids.length) continue;
    const result = await db.from(table).update({ notified_at: stamp }).in('id', ids);
    if (result.error) throw result.error;
  }
}

// Only run when executed directly, so tests can import matchRisk.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

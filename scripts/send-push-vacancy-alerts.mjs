/* Scheduled Web Push delivery for active saved searches. */
import webpush from 'web-push';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:notifications@sa-recruiters.co.za' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
const get = async (path) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json(); };
const patch = async (path, body) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); };
const matches = (job, search) => {
  const haystack = [job.title, job.description, job.location, job.city, job.province, job.agency_name, job.employer_name, job.source_type].filter(Boolean).join(' ').toLowerCase();
  return (!search.query || haystack.includes(search.query.toLowerCase())) && (!search.location || haystack.includes(search.location.toLowerCase())) && (!search.remote || String(job.remote || '').toLowerCase() === search.remote.toLowerCase()) && (!search.experience || String(job.experience || job.experience_level || '').toLowerCase().includes(search.experience.toLowerCase()));
};
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) { console.log('VAPID keys are not configured; skipping push delivery (email alerts remain active).'); process.exit(0); }
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const now = new Date().toISOString();
const searches = await get('saved_searches?active=eq.true&select=id,user_id,query,location,remote,experience,last_push_checked_at,last_checked_at&limit=2000');
const subs = await get('push_subscriptions?select=id,user_id,endpoint,p256dh,auth&limit=5000');
let sent = 0, removed = 0;
for (const search of searches) {
  const since = search.last_push_checked_at || search.last_checked_at || search.created_at || new Date(Date.now() - 6 * 3600000).toISOString();
  const jobs = await get(`vacancies?created_at=gt.${encodeURIComponent(since)}&select=id,title,location,city,province,agency_name,employer_name,source_type,remote,experience,experience_level,link,created_at&order=created_at.asc&limit=200`);
  const matched = jobs.filter((j) => matches(j, search)).slice(0, 5);
  const recipients = subs.filter((s) => s.user_id === search.user_id);
  for (const sub of recipients) {
    for (const job of matched) {
      const payload = JSON.stringify({ title: 'New job match', body: `${job.title || 'New vacancy'}${job.location ? ` · ${job.location}` : ''}`, url: job.link || 'https://sa-recruiters.co.za/?source=push', tag: `vacancy-${job.id}` });
      try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`, { method: 'DELETE', headers }); removed++; } else console.warn('push delivery failed', e.statusCode || e.message); }
    }
  }
  await patch(`saved_searches?id=eq.${encodeURIComponent(search.id)}`, { last_push_checked_at: now });
}
console.log(JSON.stringify({ searches: searches.length, sent, removed }));

// Emails each user the new vacancies (since their last check) matching their saved searches.
// Runs on a schedule; needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM.
const SITE = 'https://sa-recruiters.co.za';
const norm = (s) => String(s || '').toLowerCase();

export function matchesSearch(search, v) {
  if (v.created_at && search.last_checked_at && !(new Date(v.created_at) > new Date(search.last_checked_at))) return false;
  if (v.closing_date && new Date(v.closing_date) < new Date(new Date().toDateString())) return false;
  const hay = norm([v.title, v.company, v.location, v.notes].join(' '));
  const terms = norm(search.query).split(/\s+/).filter(Boolean);
  if (!terms.every((t) => hay.includes(t))) return false;
  if (search.location && !norm(v.location).includes(norm(search.location))) return false;
  if (search.remote && norm(v.remote) !== norm(search.remote)) return false;
  if (search.experience && norm(v.experience_level) !== norm(search.experience)) return false;
  return true;
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildDigest(search, jobs) {
  const label = [search.query, search.location].filter(Boolean).join(' in ') || 'your saved search';
  const rows = jobs.slice(0, 20).map((v) =>
    `<li><a href="${esc(v.link || SITE + '/?section=vacancies')}"><b>${esc(v.title)}</b></a><br>${esc([v.company, v.location].filter(Boolean).join(' · '))}${v.closing_date ? ' · closes ' + esc(v.closing_date) : ''}</li>`).join('');
  return {
    subject: `${jobs.length} new job${jobs.length === 1 ? '' : 's'} for ${label}`,
    html: `<p>New vacancies matching <b>${esc(label)}</b>:</p><ul>${rows}</ul>` +
      `<p><a href="${SITE}/?section=vacancies">See all vacancies</a></p>` +
      `<p style="color:#888;font-size:12px"><a href="${SITE}/?unsub_search=${search.unsubscribe_token}">Stop this alert</a></p>`,
  };
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY, RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!SUPABASE_URL || !KEY || !RESEND_API_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY');
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (path) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: h }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
  const searches = await get('saved_searches?active=eq.true&select=*&limit=2000');
  if (!searches.length) return console.log('No active saved searches');
  const since = searches.map((s) => s.last_checked_at).sort()[0];
  const vacancies = await get(`vacancies?created_at=gt.${encodeURIComponent(since)}&order=created_at.desc&limit=1000&select=id,title,company,location,notes,link,remote,experience_level,closing_date,created_at`);
  const runStart = new Date().toISOString();
  let sent = 0;
  for (const s of searches) {
    const jobs = vacancies.filter((v) => matchesSearch(s, v));
    if (jobs.length) {
      const { subject, html } = buildDigest(s, jobs);
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM || 'SA Recruiters <notifications@sa-recruiters.co.za>', to: s.email, subject, html }) });
      if (!r.ok) { console.warn('send failed', s.id, r.status); continue; } // keep last_checked_at so it retries
      sent++;
    }
    await fetch(`${SUPABASE_URL}/rest/v1/saved_searches?id=eq.${s.id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ last_checked_at: runStart }) });
  }
  console.log(`Checked ${searches.length} searches, sent ${sent} digests`);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().catch((e) => { console.error(e); process.exit(1); });

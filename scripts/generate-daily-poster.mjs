// ============================================================
//  SA RECRUITERS — scripts/generate-daily-poster.mjs
// ============================================================
//  Picks fresh vacancies that have not been posterised yet, renders a
//  branded poster image (scripts/render-poster.py, Pillow) and publishes it
//  to the Vacancy Posters feed via the Worker (/api/automation/poster).
//
//  Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_URL,
//       POSTER_AUTOMATION_TOKEN
//  Optional: POSTERS_PER_RUN (default 3), DRY_RUN=1 (render only, no upload),
//            OUT_DIR (default ./tmp-posters)
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_URL, POSTER_AUTOMATION_TOKEN } = process.env;
const PER_RUN = Math.max(1, parseInt(process.env.POSTERS_PER_RUN || '3', 10));
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const OUT_DIR = process.env.OUT_DIR || 'tmp-posters';
const SITE = 'sa-recruiters.co.za';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!DRY_RUN && (!WORKER_URL || !POSTER_AUTOMATION_TOKEN)) throw new Error('WORKER_URL and POSTER_AUTOMATION_TOKEN are required');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const captionFor = (v) => clean(v.company ? `${v.title} – ${v.company}` : v.title).slice(0, 120);

async function main() {
  const { data: recent, error: pErr } = await supabase
    .from('employer_posters').select('caption').gt('expires_at', new Date().toISOString());
  if (pErr) throw pErr;
  const posted = new Set((recent || []).map((r) => clean(r.caption).toLowerCase()));

  const { data: vacancies, error: vErr } = await supabase
    .from('vacancies')
    .select('id,title,company,location,notes,link,source_type,closing_date,created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (vErr) throw vErr;

  const now = new Date();
  const picks = [];
  const companies = new Set();
  for (const v of vacancies || []) {
    if (picks.length >= PER_RUN) break;
    if (!clean(v.title) || !clean(v.link)) continue;
    if (isStaleVacancy(v, now).stale) continue;
    if (posted.has(captionFor(v).toLowerCase())) continue;
    const co = clean(v.company).toLowerCase();
    if (co && companies.has(co)) continue; // variety: one poster per company per run
    companies.add(co);
    picks.push(v);
  }
  console.log(`[daily-poster] ${picks.length} vacancy(ies) selected`);
  if (!picks.length) return;

  mkdirSync(OUT_DIR, { recursive: true });
  for (const v of picks) {
    const jsonPath = path.join(OUT_DIR, `${v.id}.json`);
    const jpgPath = path.join(OUT_DIR, `${v.id}.jpg`);
    writeFileSync(jsonPath, JSON.stringify({
      title: clean(v.title), company: clean(v.company), location: clean(v.location),
      closing: clean(v.closing_date), apply: `Apply: ${SITE}`, tag: 'Now hiring',
    }));
    execFileSync('python3', ['scripts/render-poster.py', jsonPath, jpgPath], { stdio: 'inherit' });
    if (DRY_RUN) { console.log(`[daily-poster] DRY_RUN rendered ${jpgPath}`); continue; }

    const res = await fetch(`${WORKER_URL.replace(/\/$/, '')}/api/automation/poster?caption=${encodeURIComponent(captionFor(v))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Automation-Token': POSTER_AUTOMATION_TOKEN },
      body: readFileSync(jpgPath),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Worker rejected poster for ${v.id}: ${res.status} ${body}`);
    console.log(`[daily-poster] published ${v.id}: ${body}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

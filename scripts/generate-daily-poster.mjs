// ============================================================
//  SA RECRUITERS — scripts/generate-daily-poster.mjs
// ============================================================
//  Renders ONE branded "Vacancy Poster of the Day" (scripts/render-poster.py,
//  Pillow) from a fresh vacancy. It does NOT publish to the Vacancy Posters
//  feed any more — the JPEG is written to OUT_DIR and the workflow keeps it as
//  a downloadable build artifact.
//
//  Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//  Optional: OUT_DIR (default ./tmp-posters)
// ============================================================
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const OUT_DIR = process.env.OUT_DIR || 'tmp-posters';
const SITE = 'sa-recruiters.co.za';
const FRESH_MS = 36 * 3600 * 1000; // prefer vacancies added in the last 36h

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

// Pure helper (exported for tests): choose today's vacancy from newest-first rows.
export function pickPosterOfTheDay(vacancies, now = new Date()) {
  const eligible = (vacancies || []).filter((v) =>
    clean(v.title) && clean(v.link) && !isStaleVacancy(v, now).stale);
  if (!eligible.length) return null;
  const fresh = eligible.find((v) => now - new Date(v.created_at) <= FRESH_MS);
  if (fresh) return fresh;
  // Nothing new today: rotate through the 10 newest so it doesn't repeat daily.
  const day = Math.floor(now.getTime() / 86400000);
  const pool = eligible.slice(0, 10);
  return pool[day % pool.length];
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: vacancies, error } = await supabase
    .from('vacancies')
    .select('id,title,company,location,notes,link,source_type,closing_date,created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;

  const now = new Date();
  const v = pickPosterOfTheDay(vacancies, now);
  if (!v) { console.log('[daily-poster] no eligible vacancy today — nothing rendered'); return; }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = now.toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `poster-of-the-day-${stamp}.json`);
  const jpgPath = path.join(OUT_DIR, `poster-of-the-day-${stamp}.jpg`);
  writeFileSync(jsonPath, JSON.stringify({
    title: clean(v.title), company: clean(v.company), location: clean(v.location),
    closing: clean(v.closing_date), apply: `Apply: ${SITE}`, tag: 'Vacancy of the day',
  }));
  execFileSync('python3', ['scripts/render-poster.py', jsonPath, jpgPath], { stdio: 'inherit' });
  console.log(`[daily-poster] rendered poster of the day for ${v.id} → ${jpgPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

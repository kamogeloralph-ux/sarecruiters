// ============================================================
//  SA RECRUITERS — verify-jobmail.mjs (generalized link verifier)
// ============================================================
//  The discovery scrapers only ever see jobs that still appear somewhere
//  in a source's own listing pages, and a source can keep a closed posting
//  listed for a long time (Graduates24 in particular still lists 2021
//  learnerships). Neither is caught by discovery, since neither re-checks
//  the stored link itself.
//
//  This script does the other half for EVERY scraped/synced source that
//  stores a link: pick a batch of stored rows (oldest last_verified_at
//  first, so the whole table cycles through over repeated runs), then:
//    - delete rows that are stale by the shared freshness rules
//      (scripts/vacancy-freshness.mjs) — past closing date or older than
//      the source's max posting age — even if the URL still resolves,
//      because a resolving URL for a 2021 learnership is still wrong
//      information for users.
//    - otherwise fetch each row's link directly, and delete the row if
//      the link is confirmed dead (404/410, a redirect away to a generic
//      listing/search page, or the page body contains a common
//      "closed/filled/expired" phrase)
//    - refresh last_verified_at if the link still looks live
//    - leave last_verified_at untouched on an ambiguous/network-error
//      result, so it's naturally retried on a later run rather than
//      guessed at
//
//  Deliberately conservative: a link is only ever deleted on a clear
//  signal. An inconclusive fetch is treated as "still don't know", not
//  as "assume it's fine" or "assume it's dead" — false deletes are worse
//  than a stale listing surviving a few extra days.
//
//  Requires: npm install @supabase/supabase-js cheerio (already in
//  package.json, shared with the scrapers)
// ============================================================

import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { isStaleVacancy } from './vacancy-freshness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// One JobMail run currently discovers/refreshes ~7,500 rows; re-checking
// every single one's own detail page every run would be a lot of outbound
// requests to a few hundred different third-party sites. Batching by
// "oldest last_verified_at first" means the whole table cycles through
// over several days without any single run taking too long or hammering
// any one site.
const BATCH_SIZE = parsePositiveInt(process.env.JOBMAIL_VERIFY_BATCH, 150);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.JOBMAIL_VERIFY_DELAY_MS, 750);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.JOBMAIL_VERIFY_TIMEOUT_MS, 20_000);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersJobMailScraper/1.0 (+https://sa-recruiters.co.za)';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Generic, site-agnostic phrases worth checking for. job.link is almost
// always a third-party employer/agency site, each with its own wording,
// so this can never be exhaustive — it's one signal among three, not the
// only one. Kept deliberately short/common so it doesn't false-positive
// on legitimate page text (e.g. a "why job postings close" FAQ blurb).
const DEAD_PHRASES = [
  'no longer available',
  'no longer accepting applications',
  'position has been filled',
  'vacancy has closed',
  'vacancy is closed',
  'job has expired',
  'listing has expired',
  'this job is closed',
  'job not found',
  'page not found',
  'position is closed',
];

// A redirect away from the specific job URL to something that looks like
// a generic listing/search/home page is a strong signal the original
// posting is gone, even on a 200 response.
function looksLikeGenericFallbackPath(originalUrl, finalUrl) {
  try {
    const before = new URL(originalUrl);
    const after = new URL(finalUrl);
    if (before.origin !== after.origin) return false; // redirected off-site entirely; too ambiguous to call dead on path shape alone
    if (before.pathname === after.pathname) return false;
    const genericPath = /^\/?(jobs?|vacancies|careers?|search)?\/?$/i;
    return genericPath.test(after.pathname);
  } catch {
    return false;
  }
}

async function checkLink(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
    });
    if (response.status === 404 || response.status === 410) return { status: 'dead', reason: `HTTP ${response.status}` };
    if (!response.ok) return { status: 'unknown', reason: `HTTP ${response.status}` };
    if (looksLikeGenericFallbackPath(url, response.url)) {
      return { status: 'dead', reason: `redirected to ${response.url}` };
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    // Strip script/style before scanning text so a phrase sitting in some
    // unrelated tracking/analytics blob can't trigger a false match.
    $('script, style').remove();
    const text = $('body').text().toLowerCase();
    const matchedPhrase = DEAD_PHRASES.find((phrase) => text.includes(phrase));
    if (matchedPhrase) return { status: 'dead', reason: `page text matched "${matchedPhrase}"` };
    return { status: 'alive' };
  } catch (error) {
    return { status: 'unknown', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadBatch() {
  // Every scraped/synced source is in scope, not just jobmail — the same
  // "closed posting still listed" failure mode applies to retail career
  // pages, learnership aggregators and job boards alike. Manually-posted
  // rows ('agency', employer/agency vacancies) have no meaningful link
  // column value and are managed by the TTL, so they're excluded here.
  const { data, error } = await supabase
    .from('vacancies')
    .select('id,title,link,notes,closing_date,source_type,created_at,last_verified_at')
    .not('source_type', 'in', ['agency', 'employer', 'general'])
    .not('link', 'is', null)
    .order('last_verified_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  return data || [];
}

async function run() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const batch = await loadBatch();
  console.log(`[verify-jobmail] checking ${batch.length} stored link(s)`);
  let dead = 0, alive = 0, unknown = 0, stale = 0;
  for (const [index, row] of batch.entries()) {
    // Freshness first: a posting that is past its closing date or older
    // than its source's max age is deleted without spending a request on
    // its URL — the information is wrong even while the page still loads.
    const staleCheck = isStaleVacancy(row);
    if (staleCheck.stale) {
      stale += 1;
      console.log(`[verify-jobmail] STALE "${row.title}" (${staleCheck.reason}) — deleting ${row.id}`);
      const { error } = await supabase.from('vacancies').delete().eq('id', row.id);
      if (error) console.error(`[verify-jobmail] delete failed for ${row.id}: ${error.message}`);
      continue;
    }
    const result = await checkLink(row.link);
    if (result.status === 'dead') {
      dead += 1;
      console.log(`[verify-jobmail] DEAD  "${row.title}" (${result.reason}) — deleting ${row.id}`);
      const { error } = await supabase.from('vacancies').delete().eq('id', row.id);
      if (error) console.error(`[verify-jobmail] delete failed for ${row.id}: ${error.message}`);
    } else if (result.status === 'alive') {
      alive += 1;
      const { error } = await supabase.from('vacancies').update({ last_verified_at: new Date().toISOString() }).eq('id', row.id);
      if (error) console.error(`[verify-jobmail] last_verified_at update failed for ${row.id}: ${error.message}`);
    } else {
      unknown += 1;
      console.warn(`[verify-jobmail] UNKNOWN "${row.title}" (${result.reason}) — leaving as-is, will retry later`);
    }
    if (index < batch.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  console.log(`[verify-jobmail] done: ${alive} alive, ${dead} dead-link removed, ${stale} stale removed, ${unknown} inconclusive`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('[verify-jobmail] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { checkLink, looksLikeGenericFallbackPath };

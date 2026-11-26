import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { syncOneAtsFeed, syncAtsFeeds, atsFeedFetchUrl, planAtsPrune } from '../Cloudflare-worker/worker.js';

// A D1-shaped adapter over real SQLite so the production SQL (partial-index ON CONFLICT,
// changed-row predicate, IN-list deletes) is actually executed.
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE vacancies (id TEXT PRIMARY KEY, agency_id TEXT, employer_id TEXT, title TEXT, company TEXT, location TEXT,
      closing_date TEXT, notes TEXT, link TEXT, remote INTEGER, employment_type TEXT, salary TEXT, created_at TEXT,
      updated_at TEXT, source_type TEXT, external_ref TEXT, ats_feed_id TEXT);
    CREATE UNIQUE INDEX idx_vacancies_ats_ref ON vacancies(ats_feed_id, external_ref) WHERE external_ref IS NOT NULL;
    CREATE TABLE agency_ats_feeds (id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, agency_name TEXT NOT NULL, feed_url TEXT,
      api_key_hash TEXT, is_active INTEGER NOT NULL DEFAULT 1, last_synced_at TEXT, last_status TEXT,
      include_terms TEXT, exclude_terms TEXT, remote_by_default INTEGER NOT NULL DEFAULT 0);
  `);
  const calls = { prepare: 0, batch: 0, run: 0 };
  const wrap = (sql) => {
    const stmt = db.prepare(sql);
    let values = [];
    const api = {
      bind(...v) { values = v; return api; },
      async run() { calls.run += 1; const r = stmt.run(...values); return { meta: { changes: r.changes } }; },
      async all() { return { results: stmt.all(...values) }; },
      async first() { return stmt.get(...values) ?? null; },
      _exec() { return stmt.run(...values); },
    };
    return api;
  };
  return {
    raw: db, calls,
    prepare(sql) { calls.prepare += 1; return wrap(sql); },
    async batch(statements) { calls.batch += 1; db.exec('BEGIN'); try { for (const s of statements) s._exec(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; },
  };
}

const item = (n, extra = '') => `<item><title>Job ${n}</title><link>https://board.test/job/${n}</link><guid>ref-${n}</guid><description>Role ${n} ${extra}</description></item>`;
const rss = (nums, extra) => `<rss><channel>${nums.map((n) => item(n, extra)).join('')}</channel></rss>`;
function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => handler(String(url));
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}
const ok = (body) => new Response(body, { status: 200 });
const FEED = { id: 'myjobmag', agency_id: 'myjobmag', agency_name: 'MyJobMag', feed_url: 'https://board.test/feed.xml', remote_by_default: 0 };

test('a 600-job feed is written in batches, not one D1 call per job', async () => {
  const env = { DB: makeD1() };
  const nums = Array.from({ length: 600 }, (_, i) => i + 1);
  const result = await withFetch(() => ok(rss(nums)), () => syncOneAtsFeed(env, FEED));
  assert.equal(result.jobs, 600);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM vacancies').get().n, 600);
  assert.ok(env.DB.calls.batch <= 3, `expected <=3 batch calls, got ${env.DB.calls.batch}`);
  assert.ok(env.DB.calls.run <= 2, `per-row run() calls must be gone, got ${env.DB.calls.run}`);
});

test('re-syncing an unchanged feed rewrites nothing; a changed job is updated; created_at is kept', async () => {
  const env = { DB: makeD1() };
  await withFetch(() => ok(rss([1, 2, 3])), () => syncOneAtsFeed(env, FEED));
  const before = env.DB.raw.prepare("SELECT id, created_at, updated_at FROM vacancies WHERE external_ref='ref-1'").get();
  await new Promise((r) => setTimeout(r, 15));
  await withFetch(() => ok(rss([1, 2, 3])), () => syncOneAtsFeed(env, FEED));
  const same = env.DB.raw.prepare("SELECT updated_at FROM vacancies WHERE external_ref='ref-1'").get();
  assert.equal(same.updated_at, before.updated_at, 'unchanged row must not be rewritten (protects the D1 write quota)');
  await withFetch(() => ok(rss([1, 2, 3], 'now with salary')), () => syncOneAtsFeed(env, FEED));
  const changed = env.DB.raw.prepare("SELECT created_at, updated_at, notes FROM vacancies WHERE external_ref='ref-1'").get();
  assert.match(changed.notes, /now with salary/);
  assert.equal(changed.created_at, before.created_at);
  assert.notEqual(changed.updated_at, before.updated_at);
});

test('jobs that leave the feed are removed, including from feeds larger than 100 jobs', async () => {
  const env = { DB: makeD1() };
  await withFetch(() => ok(rss(Array.from({ length: 300 }, (_, i) => i + 1))), () => syncOneAtsFeed(env, FEED));
  const result = await withFetch(() => ok(rss(Array.from({ length: 280 }, (_, i) => i + 1))), () => syncOneAtsFeed(env, FEED));
  assert.equal(result.removed, 20);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM vacancies').get().n, 280);
});

test('an empty or blocked response never wipes the feed', async () => {
  const env = { DB: makeD1() };
  await withFetch(() => ok(rss([1, 2, 3])), () => syncOneAtsFeed(env, FEED));
  const result = await withFetch(() => ok('<html>Just a moment... challenge</html>'), () => syncOneAtsFeed(env, FEED));
  assert.equal(result.removed, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM vacancies').get().n, 3);
});

test('a sizeable feed that suddenly shrinks by more than 80% is reported, not pruned', () => {
  const existing = Array.from({ length: 100 }, (_, i) => `r${i}`);
  assert.equal(planAtsPrune(existing, ['r0', 'r1'], 2).stale.length, 0);
  assert.match(planAtsPrune(existing, ['r0', 'r1'], 2).skipped, /shrank/);
  assert.equal(planAtsPrune(existing, existing.slice(0, 90), 90).stale.length, 10);
  assert.equal(planAtsPrune(existing, [], 0).stale.length, 0);
  assert.equal(planAtsPrune(['a', 'b'], [], 5).stale.length, 2, 'tiny feeds can legitimately empty');
});

test('remote-by-default feeds are filed as remote; board feeds as ats', async () => {
  const env = { DB: makeD1() };
  await withFetch(() => ok(rss([1])), () => syncOneAtsFeed(env, { ...FEED, id: 'weworkremotely', agency_id: 'weworkremotely', remote_by_default: 1 }));
  await withFetch(() => ok(rss([1])), () => syncOneAtsFeed(env, FEED));
  const rows = env.DB.raw.prepare('SELECT ats_feed_id f, source_type t, remote r FROM vacancies ORDER BY f').all();
  assert.deepEqual(rows.map((r) => [r.f, r.t, r.r]), [['myjobmag', 'ats', 0], ['weworkremotely', 'remote', 1]]);
});

test('WP Job Manager feeds get posts_per_page so they return more than 10 jobs', () => {
  const url = atsFeedFetchUrl('https://topjobseeker.com/?feed=job_feed&search_location=South+Africa&search_keywords', {});
  assert.equal(new URL(url).searchParams.get('posts_per_page'), '300');
  assert.equal(new URL(atsFeedFetchUrl('https://x.test/?feed=job_feed&posts_per_page=50', {})).searchParams.get('posts_per_page'), '50');
  assert.equal(atsFeedFetchUrl('https://govposts.co.za/feeds/jobs.xml', {}), 'https://govposts.co.za/feeds/jobs.xml');
});

test('scheduled/maxFeeds sync handles only the least-recently-synced feed; ?feed syncs exactly one', async () => {
  const env = { DB: makeD1() };
  const ins = env.DB.raw.prepare('INSERT INTO agency_ats_feeds (id, agency_id, agency_name, feed_url, last_synced_at) VALUES (?,?,?,?,?)');
  ins.run('a', 'a', 'A', 'https://a.test/f.xml', '2026-11-26T05:00:00Z');
  ins.run('b', 'b', 'B', 'https://b.test/f.xml', '2026-11-25T05:00:00Z');
  ins.run('push', 'push', 'Push only', null, null);
  const seen = [];
  const handler = (url) => { seen.push(url); return ok(rss([1])); };
  const one = await withFetch(handler, () => syncAtsFeeds(env, { maxFeeds: 1 }));
  assert.deepEqual(one.map((r) => r.feed_id), ['b']);
  const exact = await withFetch(handler, () => syncAtsFeeds(env, { feedId: 'a' }));
  assert.deepEqual(exact.map((r) => r.feed_id), ['a']);
});

// ---- Visibility: drive the real /api/vacancies handler ----
function snapshotEnv(rows) {
  return { MEDIA_BUCKET: { get: async () => ({ text: async () => JSON.stringify({ generated_at: new Date().toISOString(), vacancies: rows }) }) } };
}
test('ATS board feeds appear in General, remote feeds in Remote jobs, and nothing is orphaned', async () => {
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };
  const mk = (id, extra) => ({ id, title: id, company: 'X', location: 'Cape Town', closing_date: '', created_at: '2026-11-20T10:00:00Z', employer_id: null, agency_id: 'general', source_type: null, ...extra });
  const rows = [
    mk('adzuna-1', { source_type: 'adzuna' }),
    mk('jooble-1', { source_type: 'jooble' }),
    mk('plain-1', {}),
    mk('ats_topjobseeker-south-africa_1', { source_type: 'ats', agency_id: 'topjobseeker', ats_feed_id: 'topjobseeker-south-africa' }),
    mk('ats_govposts_1', { source_type: 'ats', agency_id: 'govposts', ats_feed_id: 'govposts' }),
    mk('ats_myjobmag_1', { source_type: 'ats', agency_id: 'myjobmag', ats_feed_id: 'myjobmag' }),
    mk('ats_weworkremotely_1', { source_type: 'remote', agency_id: 'weworkremotely', ats_feed_id: 'weworkremotely' }),
  ];
  const ask = async (qs) => (await (await worker.fetch(new Request(`https://w.test/api/vacancies?${qs}`), snapshotEnv(rows), { waitUntil() {} })).json()).vacancies.map((v) => v.id).sort();
  assert.deepEqual(await ask('scope=general&limit=200'), ['ats_govposts_1', 'ats_myjobmag_1', 'ats_topjobseeker-south-africa_1', 'jooble-1', 'plain-1']);
  assert.deepEqual(await ask('source=remotive,realworkfromanywhere,himalayas-rss,weworkremotely,remote&limit=200'), ['ats_weworkremotely_1']);
});

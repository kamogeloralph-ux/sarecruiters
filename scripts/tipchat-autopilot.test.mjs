// Tests for TipChat Autopilot (supabase/migrations/20261013_tipchat_autopilot.sql) and the
// Cloudflare watchdog (Cloudflare-worker/watchdog.js).
//
// NOTE ON SCOPE: the PL/pgSQL itself cannot be executed in this repo's test runner (no
// Postgres). The SQL is covered by (1) structural assertions on the migration text and
// (2) smoke tests that extract the seeded regex rules from the SQL and run realistic
// scam / legitimate ads through them, translating Postgres word-boundary escapes to JS.
// Verify the live behaviour in 'shadow' mode (see the rollout notes in the migration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WORKFLOWS, assessWorkflow, planAlerts, canHeal, renderAlertEmail, renderDigest, digestHasNews, runWatchdog,
} from '../Cloudflare-worker/watchdog.js';
import { shouldEmailModeratorDigest } from './flag-community-risk.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const sql = read('supabase/migrations/20261013_tipchat_autopilot.sql');
const worker = read('Cloudflare-worker/worker.js');
const wrangler = read('Cloudflare-worker/wrangler.toml');

// ---------------------------------------------------------------------------
// SQL: structure
// ---------------------------------------------------------------------------
test('autopilot ships in shadow mode and has an off switch', () => {
  assert.match(sql, /mode text not null default 'shadow' check \(mode in \('off', 'shadow', 'live'\)\)/);
  assert.match(sql, /if not found or s\.mode = 'off' then return null/);
  assert.match(sql, /if s\.mode = 'off' then\s+return jsonb_build_object\('ok', true, 'mode', 'off'\)/);
});

test('decisions are only applied in live mode and only to still-pending rows', () => {
  assert.match(sql, /if s\.mode = 'live' and v_decision in \('approve', 'hide'\) then/);
  const updates = sql.match(/update public\.community_(posts|comments)[^;]*?;/gs) || [];
  assert.ok(updates.length >= 6);
  for (const statement of updates) {
    // every status change must be guarded so a human decision is never overridden
    assert.match(statement, /status = '(pending|approved)'/, statement.slice(0, 120));
  }
  // expiring holds is live-only and requires an explicit live HOLD that is old enough
  assert.match(sql, /l\.mode = 'live' and l\.decision = 'hold'/);
});

test('every function is hardened: security definer + fixed search_path, no public execute', () => {
  const fns = sql.match(/create or replace function public\.[a-z_]+\([^)]*\)[\s\S]*?\n\$\$;/g) || [];
  assert.equal(fns.length, 7, `expected 7 functions, found ${fns.length}`);
  for (const fn of fns) {
    assert.match(fn, /set search_path = public, pg_temp/, fn.slice(0, 80));
  }
  for (const name of ['community_automod_author_tier', 'community_automod_evaluate', 'community_automod_after_insert',
    'community_automod_sweep', 'community_automod_health', 'community_automod_digest', 'community_stamp_moderation']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`), name);
  }
  // callable by the watchdog (service role) and nobody else
  for (const name of ['community_automod_evaluate', 'community_automod_sweep', 'community_automod_health', 'community_automod_digest']) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role`), name);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to (anon|authenticated)`), name);
  }
});

test('new tables are RLS-locked with no client access', () => {
  for (const table of ['community_automod_settings', 'community_automod_rules', 'community_moderation_log']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`), table);
  }
});

test('the insert trigger can never fail a submission', () => {
  const trigger = sql.match(/function public\.community_automod_after_insert\(\)[\s\S]*?\n\$\$;/)[0];
  assert.match(trigger, /exception when others then\s+raise warning/);
  assert.match(sql, /create trigger community_posts_automod\s+after insert on public\.community_posts/);
  assert.match(sql, /create trigger community_comments_automod\s+after insert on public\.community_comments/);
});

test('automated actions are not attributed to the author', () => {
  assert.match(sql, /current_setting\('app\.community_automod', true\)/);
  assert.match(sql, /when coalesce\(current_setting\('app\.community_automod', true\), 'off'\) = 'on' then null/);
  // the flag is turned on only transaction-locally and is switched back off
  assert.match(sql, /set_config\('app\.community_automod', 'on', true\)/);
  assert.match(sql, /set_config\('app\.community_automod', 'off', true\)/);
});

test('sweep is scheduled every 5 minutes with pg_cron and is idempotent to re-run', () => {
  assert.match(sql, /cron\.unschedule\('community-automod-sweep'\)/);
  assert.match(sql, /'community-automod-sweep',\s*'\*\/5 \* \* \* \*'/);
  assert.match(sql, /community_automod_sweep\('cron'\)/);
  assert.match(sql, /on conflict \(key\) do nothing/);          // rule edits survive re-runs
  assert.match(sql, /on conflict \(id\) do nothing/);           // settings survive re-runs
});

test('crowd moderation ignores brand-new accounts and never touches official posts', () => {
  assert.match(sql, /u\.created_at < now\(\) - interval '1 day'/);
  assert.match(sql, /status = 'approved' and not is_official/);
});

test('reasons are appended with array_append (text[] || \'literal\' is parsed as an array literal and errors)', () => {
  assert.doesNotMatch(sql, /v_reasons\s*\|\|/);
  assert.equal((sql.match(/array_append\(v_reasons,/g) || []).length, 6);
});

test('dollar quoting is balanced', () => {
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0);
  assert.equal((sql.match(/\$re\$/g) || []).length % 2, 0);
});

test('settings defaults are consistent with the documented thresholds', () => {
  const grab = (name) => Number(sql.match(new RegExp(`${name} integer not null default (\\d+)`))[1]);
  assert.ok(grab('approve_below_new') <= grab('approve_below_trusted'));
  assert.ok(grab('approve_below_trusted') < grab('hide_at'));
  assert.equal(grab('hold_ttl_hours'), 48);
  assert.equal(grab('report_hide_threshold'), 3);
});

// ---------------------------------------------------------------------------
// SQL: rule smoke tests (patterns extracted from the migration itself)
// ---------------------------------------------------------------------------
const toJs = (pattern) => pattern.replace(/\\m/g, '\\b(?=\\w)').replace(/\\M/g, '\\b(?<=\\w)');
const rules = [...sql.matchAll(/\('([a-z0-9_]+)',\s*\$re\$([\s\S]*?)\$re\$,\s*(\d+),\s*'(all|vacancy|discussion)',\s*(true|false)/g)]
  .map((m) => ({ key: m[1], re: new RegExp(toJs(m[2]), 'i'), weight: Number(m[3]), applies: m[4], critical: m[5] === 'true' }));
const negation = new RegExp(toJs('\\m(no|not|never|without|zero|free\\s+of)\\s+(\\w+\\s+){0,2}(fee|fees|deposit|deposits|payment|payments|charge|charges)\\M'), 'gi');

function scan(text, kind) {
  const scanText = text.toLowerCase().replace(negation, ' ');
  const hits = rules.filter((r) => (r.applies === 'all' || r.applies === kind) && r.re.test(scanText));
  return { keys: hits.map((r) => r.key), score: hits.reduce((n, r) => n + r.weight, 0), critical: hits.some((r) => r.critical) };
}

test('all seeded rules were extracted and compile', () => {
  assert.ok(rules.length >= 12, `found ${rules.length} rules`);
  for (const key of ['payment_request', 'credential_request', 'sa_id_number', 'contact_phone', 'contact_email', 'url_shortener', 'profanity']) {
    assert.ok(rules.some((r) => r.key === key), key);
  }
});

test('classic advance-fee and phishing ads are critical (auto-hide for everyone)', () => {
  const scams = [
    'URGENT vacancy! Pay a registration fee of R350 to secure your spot',
    'Please send us a small deposit to start work on Monday',
    'Training fee R200 payable, deposit required before you start',
    'Reply with your banking details and the OTP we sent you',
    'Send your password so we can create your profile',
    'Congratulations, upfront payment is needed to confirm placement',
  ];
  for (const text of scams) assert.ok(scan(text, 'vacancy').critical, text);
});

test('honest anti-scam wording and ordinary ads are NOT hidden', () => {
  const fine = [
    ['No registration fee. We never charge applicants any fee.', 'vacancy'],
    ['Never pay any fee to get a job — a real employer will not ask.', 'discussion'],
    ['Do not pay a deposit to anyone claiming to recruit for us.', 'discussion'],
    ['Admin clerk needed. Payment processing experience, R12000 per month. Email CV to hr@acme.co.za', 'vacancy'],
    ['General worker, Soweto. Apply in person with certified ID. WhatsApp 082 123 4567 for details', 'vacancy'],
    ['Interview tip: send a short thank-you email the same day.', 'discussion'],
  ];
  for (const [text, kind] of fine) assert.equal(scan(text, kind).critical, false, text);
});

test('a South African ID number is treated as a privacy leak', () => {
  assert.ok(scan('My ID is 9001015009087 please check', 'discussion').critical);
  assert.ok(scan('ID 900101 5009 087', 'discussion').critical);
  assert.equal(scan('Call 0821234567 about the job', 'vacancy').critical, false);   // phone != ID
});

test('contact details are fine in a vacancy but pushed to review in a discussion', () => {
  const ad = 'Cashier needed in Pretoria. WhatsApp or call 082 123 4567, or email jobs@store.co.za';
  assert.equal(scan(ad, 'vacancy').score, 0);
  const chat = scan('Message me on 082 123 4567 or jobs@store.co.za and I will help', 'discussion');
  assert.ok(chat.keys.includes('contact_phone') && chat.keys.includes('contact_email'));
  assert.ok(chat.score >= 50, 'even a trusted author (threshold 50) is held');
});

test('link shorteners and promo language add risk; a plain apply link does not', () => {
  assert.ok(scan('Apply here: https://bit.ly/3xYz now', 'vacancy').keys.includes('url_shortener'));
  assert.ok(scan('GUARANTEED JOB, earn R5000 per week, limited slots', 'vacancy').keys.includes('mass_promotion'));
  assert.equal(scan('Apply at https://careers.shoprite.co.za/job/123', 'vacancy').score, 0);
  assert.ok(scan('Check https://example.com for tips', 'discussion').keys.includes('external_link_discussion'));
});

test('a normal interview-tip comment scores zero', () => {
  assert.equal(scan('Research the company and prepare two questions to ask the panel. Good luck everyone!', 'discussion').score, 0);
});

// ---------------------------------------------------------------------------
// Moderator digest script
// ---------------------------------------------------------------------------
test('the legacy hourly review email stops only when Autopilot is live', () => {
  assert.equal(shouldEmailModeratorDigest('live'), false);
  for (const mode of ['shadow', 'off', null, undefined]) assert.equal(shouldEmailModeratorDigest(mode), true, String(mode));
});

// ---------------------------------------------------------------------------
// Watchdog: pure logic
// ---------------------------------------------------------------------------
const NOW = Date.parse('2026-10-13T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const wf = WORKFLOWS.find((w) => w.file === 'send-saved-search-alerts.yml');           // staleHours 9
const okRun = (hours) => ({ status: 'completed', conclusion: 'success', updated_at: ago(hours), created_at: ago(hours) });
const badRun = (hours) => ({ status: 'completed', conclusion: 'failure', updated_at: ago(hours), created_at: ago(hours) });

test('every monitored workflow exists in the repo and can be started manually', () => {
  for (const item of WORKFLOWS) {
    const file = read(`.github/workflows/${item.file}`);
    assert.match(file, /workflow_dispatch/, `${item.file} needs workflow_dispatch so the watchdog can restart it`);
    assert.ok(item.staleHours > 0);
  }
});

test('a workflow GitHub disabled for inactivity is re-enabled and restarted', () => {
  const result = assessWorkflow(wf, { workflow: { state: 'disabled_inactivity' }, runs: [] }, NOW);
  assert.deepEqual(result.actions, ['enable', 'dispatch']);
  assert.match(result.problems[0].title, /60 days/);
});

test('a workflow a person disabled is reported but never overridden', () => {
  const result = assessWorkflow(wf, { workflow: { state: 'disabled_manually' }, runs: [] }, NOW);
  assert.deepEqual(result.actions, []);
  assert.equal(result.problems.length, 1);
});

test('healthy, stale, in-progress and never-run workflows are classified correctly', () => {
  assert.deepEqual(assessWorkflow(wf, { workflow: { state: 'active' }, runs: [okRun(2)] }, NOW), { problems: [], actions: [] });
  const stale = assessWorkflow(wf, { workflow: { state: 'active' }, runs: [okRun(20)] }, NOW);
  assert.deepEqual(stale.actions, ['dispatch']);
  const running = assessWorkflow(wf, { workflow: { state: 'active' }, runs: [{ status: 'in_progress', created_at: ago(0.2) }, okRun(20)] }, NOW);
  assert.deepEqual(running.actions, [], 'do not double-start a run that is already in progress');
  const never = assessWorkflow(wf, { workflow: { state: 'active' }, runs: [] }, NOW);
  assert.deepEqual(never.actions, ['dispatch']);
});

test('three failures in a row alert but do not restart a fresh-enough workflow', () => {
  const result = assessWorkflow(wf, { workflow: { state: 'active' }, runs: [badRun(1), badRun(2), badRun(3), okRun(4)] }, NOW);
  assert.deepEqual(result.actions, []);
  assert.ok(result.problems.some((p) => p.key.endsWith(':failing')));
});

test('alerts honour grace, de-duplicate for 24h, and announce recovery', () => {
  const problem = { key: 'x', title: 'X is broken', grace: 2 };
  let plan = planAlerts([problem], { problems: {} }, NOW);
  assert.equal(plan.toAlert.length, 0, 'first sighting: give self-healing a cycle');
  plan = planAlerts([problem], { problems: plan.nextProblems }, NOW + 30 * 60e3);
  assert.equal(plan.toAlert.length, 1, 'second sighting: tell a human');
  const afterAlert = plan.nextProblems;
  plan = planAlerts([problem], { problems: afterAlert }, NOW + 2 * 3600e3);
  assert.equal(plan.toAlert.length, 0, 'no repeat within 24h');
  plan = planAlerts([problem], { problems: afterAlert }, NOW + 25 * 3600e3);
  assert.equal(plan.toAlert.length, 1, 'reminder after 24h');
  plan = planAlerts([], { problems: afterAlert }, NOW + 3 * 3600e3);
  assert.deepEqual(plan.recovered.map((r) => r.key), ['x']);
  // a problem that was never alerted about recovers silently
  const quiet = planAlerts([problem], { problems: {} }, NOW);
  assert.deepEqual(planAlerts([], { problems: quiet.nextProblems }, NOW + 1e3).recovered, []);
});

test('heals are rate-limited per target', () => {
  const state = { heals: { a: new Date(NOW - 3600e3).toISOString() } };
  assert.equal(canHeal(state, 'a', NOW), false);
  assert.equal(canHeal(state, 'a', NOW + 6 * 3600e3), true);
  assert.equal(canHeal(state, 'b', NOW), true);
  assert.equal(canHeal({}, 'a', NOW), true);
});

test('digest explains shadow mode and the one-line go-live, and drops it once live', () => {
  const shadow = renderDigest({ mode: 'shadow', counts: { 'approve:insert:shadow': 12, 'hide:insert:shadow': 2, 'hold:insert:shadow': 3 },
    top_reasons: [{ reason: 'payment_request', n: 2 }], samples: [{ decision: 'hide', applied: false, kind: 'post', reasons: ['payment_request'], snippet: 'Pay a fee' }] }, new Date(NOW));
  assert.match(shadow, /Would have approved: 12\s+Would have hidden: 2\s+Would have held: 3/);
  assert.match(shadow, /set mode = 'live'/);
  const live = renderDigest({ mode: 'live', counts: { 'approve:insert': 40, 'hide:ttl': 1, 'hide:reports': 1, 'hide:insert': 2, 'hold:insert': 4 } }, new Date(NOW));
  assert.match(live, /Approved automatically: 40\s+Hidden: 4\s+Held for a closer look: 4/);
  assert.match(live, /1 expired while held, 1 hidden after community reports/);
  assert.doesNotMatch(live, /set mode = 'live'/);
  assert.equal(digestHasNews({ mode: 'live', counts: {} }), false);
  assert.equal(digestHasNews({ mode: 'shadow', counts: {} }), true);
  assert.match(renderAlertEmail({ toAlert: [{ title: 'T', detail: 'D' }], recovered: [{ title: 'R' }] }, new Date(NOW)), /Recovered on their own/);
});

// ---------------------------------------------------------------------------
// Watchdog: end to end with a fake world
// ---------------------------------------------------------------------------
function fakeDb() {
  const store = new Map();
  return {
    store,
    prepare(sqlText) {
      return {
        bind: (...args) => ({
          all: async () => ({ results: /^SELECT/i.test(sqlText) && store.has(args[0]) ? [{ value: store.get(args[0]) }] : [] }),
          run: async () => { store.set(args[0], args[1]); return {}; },
        }),
      };
    },
  };
}

function fakeWorld({ workflowState, autopilot }) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    if (url === 'https://sa-recruiters.co.za') return new Response('<html></html>', { status: 200 });
    if (url.includes('/rpc/community_automod_health')) return json(autopilot);
    if (url.includes('/rpc/community_automod_sweep')) return json({ ok: true });
    if (url.includes('/rpc/community_automod_digest')) return json({ mode: 'live', counts: {}, top_reasons: [], samples: [] });
    if (url.startsWith('https://api.github.com') && url.endsWith('/enable')) return new Response(null, { status: 204 });
    if (url.startsWith('https://api.github.com') && url.endsWith('/dispatches')) return new Response(null, { status: 204 });
    if (url.startsWith('https://api.github.com') && url.includes('/runs?')) return json({ workflow_runs: [] });
    if (url.startsWith('https://api.github.com')) return json({ state: url.includes('refresh-static-data') ? workflowState : 'active' });
    if (url === 'https://api.resend.com/emails') return json({ id: 'email_1' });
    if (url === 'https://hc.example/ping') return new Response('OK');
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

const baseEnv = (db) => ({
  DB: db, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 're_x',
  GITHUB_REPO: 'owner/repo', WATCHDOG_GH_TOKEN: 'ghp_x', HEALTHCHECK_PING_URL: 'https://hc.example/ping',
});

test('end to end: heal first, alert a human only if the heal did not work', async () => {
  const db = fakeDb();
  const world = fakeWorld({
    workflowState: 'disabled_inactivity',
    autopilot: { mode: 'live', last_sweep_at: ago(2), last_cron_sweep_at: ago(2), stuck: 0, pending: 0, hold_ttl_hours: 48 },
  });
  const env = baseEnv(db);

  // Run 1: GitHub switched the scraper workflow off. The watchdog fixes it and stays quiet.
  const first = await runWatchdog(env, { now: NOW, fetchImpl: world.fetchImpl });
  assert.ok(world.calls.includes('PUT https://api.github.com/repos/owner/repo/actions/workflows/refresh-static-data.yml/enable'));
  assert.ok(world.calls.includes('POST https://api.github.com/repos/owner/repo/actions/workflows/refresh-static-data.yml/dispatches'));
  assert.equal(world.calls.filter((c) => c.endsWith('/emails')).length, 0, 'no email on first sighting');
  assert.equal(first.alerted, false);
  assert.ok(world.calls.includes('GET https://hc.example/ping'), 'dead-man switch is pinged');

  // Run 30 minutes later, same problem: still disabled -> heal is on cooldown, human is told once.
  world.calls.length = 0;
  const second = await runWatchdog(env, { now: NOW + 30 * 60e3, fetchImpl: world.fetchImpl });
  assert.equal(world.calls.filter((c) => c.endsWith('/enable')).length, 0, 'does not hammer GitHub');
  assert.equal(world.calls.filter((c) => c.endsWith('/emails')).length, 1);
  assert.equal(second.alerted, true);

  // Run again soon after: no duplicate email.
  world.calls.length = 0;
  await runWatchdog(env, { now: NOW + 60 * 60e3, fetchImpl: world.fetchImpl });
  assert.equal(world.calls.filter((c) => c.endsWith('/emails')).length, 0);
});

test('end to end: the watchdog runs the moderation sweep when pg_cron has stalled', async () => {
  const db = fakeDb();
  const world = fakeWorld({
    workflowState: 'active',
    autopilot: { mode: 'live', last_sweep_at: ago(1), last_cron_sweep_at: ago(1), stuck: 0, pending: 5, hold_ttl_hours: 48 },
  });
  const env = baseEnv(db);
  const result = await runWatchdog(env, { now: NOW, fetchImpl: world.fetchImpl });
  assert.ok(world.calls.some((c) => c.includes('/rpc/community_automod_sweep')), 'sweep executed by the watchdog');
  assert.ok(result.problems.includes('pg-cron-stalled'), 'but the broken scheduler is still reported');
});

test('autopilot health is skipped quietly before the migration exists, and when it is off', async () => {
  const db = fakeDb();
  const noMigration = async (url, init) => {
    if (String(url).includes('/rpc/community_automod_health')) return new Response('{}', { status: 404 });
    if (String(url).includes('api.github.com')) return new Response('{}', { status: 404 });
    if (url === 'https://sa-recruiters.co.za') return new Response('ok');
    return new Response('{}');
  };
  const result = await runWatchdog({ ...baseEnv(db), GITHUB_REPO: '', HEALTHCHECK_PING_URL: '' }, { now: NOW, fetchImpl: noMigration });
  assert.deepEqual(result.problems, []);

  const world = fakeWorld({ workflowState: 'active', autopilot: { mode: 'off' } });
  const off = await runWatchdog({ ...baseEnv(fakeDb()), GITHUB_REPO: '', HEALTHCHECK_PING_URL: '' }, { now: NOW, fetchImpl: world.fetchImpl });
  assert.deepEqual(off.problems, []);
  assert.ok(!world.calls.some((c) => c.includes('community_automod_sweep')));
});

test('the daily digest is emailed only when requested', async () => {
  const world = fakeWorld({ workflowState: 'active', autopilot: { mode: 'shadow', last_sweep_at: ago(0.1), last_cron_sweep_at: ago(0.1), stuck: 0, pending: 0, hold_ttl_hours: 48 } });
  const env = { ...baseEnv(fakeDb()), GITHUB_REPO: '', HEALTHCHECK_PING_URL: '' };
  await runWatchdog(env, { now: NOW, fetchImpl: world.fetchImpl });
  assert.equal(world.calls.filter((c) => c.includes('digest')).length, 0);
  await runWatchdog(env, { now: NOW, digest: true, fetchImpl: world.fetchImpl });
  assert.equal(world.calls.filter((c) => c.includes('digest')).length, 1);
});

// ---------------------------------------------------------------------------
// Worker wiring
// ---------------------------------------------------------------------------
test('worker schedules the watchdog without colliding with the 6-hourly sync', () => {
  assert.match(worker, /^import \{ runWatchdog \} from "\.\/watchdog\.js";/);
  assert.match(worker, /event\.cron === "15,45 \* \* \* \*"/);
  assert.match(wrangler, /crons = \["0 \*\/6 \* \* \*", "15,45 \* \* \* \*"\]/);
  // minute 15/45 can never equal minute 0 of the 6-hourly tick
  assert.match(worker, /getUTCHours\(\) === 6/);
});

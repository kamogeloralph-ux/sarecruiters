// Behavioural + structural tests for the TipChat audit fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchRisk } from './flag-community-risk.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const migration = read('supabase/migrations/20261012_tipchat_audit_fixes.sql');
const identityMigration = read('supabase/migrations/20261011_community_candidate_public_identity.sql');
const appSource = read('app-community.js');
const html = read('index.html');
const worker = read('Cloudflare-worker/worker.js');

// ---- load the real client code in a sandbox with a fake Supabase ----
function makeSandbox({ rpc } = {}) {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, { id, hidden: false, innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, querySelector: () => null, closest: () => null });
    return elements.get(id);
  };
  const toasts = [];
  const calls = [];
  const sandbox = {
    console, URL, Intl, Date, Math, Number, String, Array, Set, Map, JSON, Promise,
    document: {
      getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    },
    location: { hash: '', origin: 'https://x.test', pathname: '/', search: '' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    window: { confirm: () => true },
    setTimeout: () => 0,
    saAuthUser: { id: 'user-1' },
    showToast: (m) => toasts.push(m),
    supabaseClient: {
      auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }) },
      rpc: async (name, args) => { calls.push([name, args]); return rpc(name, args); },
    },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(appSource + '\nthis.__mvp = communityMvp;', sandbox);
  return { sandbox, toasts, calls, el };
}

test('reactions use one atomic RPC and update counts in place (no feed reload)', async () => {
  let serverReaction = null;
  const { sandbox, calls } = makeSandbox({
    rpc: async (name, args) => {
      if (name !== 'community_set_reaction') return { data: null, error: null };
      serverReaction = serverReaction === args.p_reaction ? null : args.p_reaction;
      return { data: serverReaction, error: null };
    },
  });
  const mvp = sandbox.__mvp;
  mvp.joined = true;
  mvp.posts = [{ id: 'p1', likes_count: 3, comments_count: 0 }];
  let reloaded = false;
  sandbox.communityLoadFeed = async () => { reloaded = true; };

  await sandbox.communityToggleReaction('p1', 'like');
  assert.equal(mvp.posts[0].likes_count, 4);
  assert.ok(mvp.liked.has('p1'));

  // switch like -> emoji: like count drops, emoji recorded, NO insert-conflict path
  await sandbox.communityToggleReaction('p1', 'applause');
  assert.equal(mvp.posts[0].likes_count, 3);
  assert.equal(mvp.reactions.get('p1'), 'applause');
  assert.ok(!mvp.liked.has('p1'));

  // emoji -> like works even though the user already has a reaction (old code silently failed)
  await sandbox.communityToggleReaction('p1', 'like');
  assert.equal(mvp.posts[0].likes_count, 4);
  assert.ok(mvp.liked.has('p1') && !mvp.reactions.has('p1'));

  // same again clears it
  await sandbox.communityToggleReaction('p1', 'like');
  assert.equal(mvp.posts[0].likes_count, 3);
  assert.equal(reloaded, false, 'reacting must not reload the whole feed');
  assert.ok(calls.every(([name]) => name === 'community_set_reaction'));
});

test('a failed reaction leaves local state untouched and tells the user', async () => {
  const { sandbox, toasts } = makeSandbox({ rpc: async () => ({ data: null, error: { code: 'XX', message: 'boom' } }) });
  const mvp = sandbox.__mvp;
  mvp.joined = true;
  mvp.posts = [{ id: 'p1', likes_count: 1 }];
  await sandbox.communityToggleReaction('p1', 'like');
  assert.equal(mvp.posts[0].likes_count, 1);
  assert.equal(mvp.liked.size, 0);
  assert.ok(toasts.some((t) => /could not be saved/i.test(t)));
});

test('rapid double-taps on a reaction are ignored while one is in flight', async () => {
  let n = 0;
  const { sandbox } = makeSandbox({ rpc: async () => { n++; await new Promise((r) => setImmediate(r)); return { data: 'like', error: null }; } });
  sandbox.__mvp.joined = true;
  sandbox.__mvp.posts = [{ id: 'p1', likes_count: 0 }];
  await Promise.all([sandbox.communityToggleReaction('p1', 'like'), sandbox.communityToggleReaction('p1', 'like')]);
  assert.equal(n, 1);
});

test('comments open for signed-out visitors without a sign-in prompt', async () => {
  const { sandbox } = makeSandbox({ rpc: async () => ({ data: null, error: null }) });
  sandbox.saAuthUser = null;
  let prompted = false;
  sandbox.communityRequireSignIn = () => { prompted = true; return false; };
  assert.doesNotMatch(appSource.match(/async function communityToggleComments[\s\S]*?\n}\n/)[0], /communityRequireSignIn|communityPromptParticipation/);
  assert.equal(prompted, false);
});

test('post body rendering escapes HTML', () => {
  const { sandbox } = makeSandbox({ rpc: async () => ({}) });
  const out = sandbox.communityRenderBody('<img src=x onerror=alert(1)> [sa-emoji:applause]');
  assert.doesNotMatch(out, /<img src=x/);
  assert.match(out, /community-inline-emoji/);
});

test('client no longer reloads the feed on like/auth refresh and keeps drafts', () => {
  assert.doesNotMatch(appSource.match(/async function communityToggleReaction[\s\S]*?\n}\n/)[0], /communityLoadFeed|communityRenderFeed/);
  assert.match(appSource, /communityMvp\.lastUserId/);
  assert.match(appSource, /communityMvp\.drafts\[/);
  assert.match(appSource, /pendingReload/);
});

test('every id and inline handler added for the fixes exists in index.html / window', () => {
  for (const id of ['community-identity-box', 'community-identity-toggle', 'community-mine', 'community-mine-list', 'community-mine-count']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  for (const fn of ['communitySetIdentityVisibility', 'communityDeleteOwn', 'communityToggleMine', 'communityLoad']) {
    assert.match(appSource, new RegExp(`window\\.${fn} = ${fn}`));
  }
});

test('migration: likes count only likes, atomic reaction RPC, recount', () => {
  assert.match(migration, /reaction_type = 'like'/);
  assert.match(migration, /after insert or update of reaction_type or delete/);
  assert.match(migration, /function public\.community_set_reaction/);
  assert.match(migration, /grant execute on function public\.community_set_reaction\(uuid, text\) to authenticated/);
  assert.match(migration, /update public\.community_posts p\s+set likes_count/);
});

test('migration: identity is opt-in and old content is reset to anonymous', () => {
  assert.match(migration, /create table if not exists public\.community_member_settings/);
  assert.match(migration, /show_profile boolean not null default false/);
  assert.match(migration, /coalesce\(v_show, false\) is not true then return/);
  assert.match(migration, /set author_label = 'Anonymous member', author_photo_url = null/);
  assert.doesNotMatch(identityMigration, /Backfill prior approved/);
  assert.match(migration, /Posts appear as “Anonymous member” unless you choose/);
});

test('migration: identity migration tolerates a missing pool_candidates table', () => {
  assert.match(identityMigration, /to_regclass\('public\.pool_candidates'\) is not null/);
  assert.match(migration, /to_regclass\('public\.pool_candidates'\)/);
});

test('migration: own submissions, own delete, flags, rate limits, poster host, notified_at', () => {
  assert.match(migration, /function public\.community_my_submissions/);
  assert.match(migration, /function public\.community_delete_own/);
  assert.match(migration, /author_id = v_uid and not is_official/);
  assert.match(migration, /function public\.community_admin_flags/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.match(migration, /community_posts_close_flags/);
  for (const t of ['community_posts_rate_limit', 'community_comments_rate_limit', 'community_reports_rate_limit']) assert.match(migration, new RegExp(t));
  assert.match(migration, /pub-911e4cd402674c6f85c747b12212772f/);
  assert.match(migration, /not valid/);
  assert.match(migration, /notified_at timestamptz/);
  assert.match(migration, /community_posts_author_created_idx/);
});

test('all new SECURITY DEFINER functions are locked down', () => {
  const blocks = migration.split(/(?=create or replace function )/).filter((b) => /^create or replace function/.test(b));
  const definers = blocks.filter((b) => /security definer/i.test(b));
  assert.ok(definers.length >= 10);
  for (const block of definers) {
    const name = block.match(/^create or replace function (public\.\w+)/)[1];
    assert.match(migration, new RegExp(`revoke all on function ${name.replace('.', '\\.')}\\(`), `${name} must revoke default execute`);
  }
});

test('risk matcher: vacancy contact details are not flagged, scams still are', () => {
  assert.deepEqual(matchRisk('Apply on WhatsApp 082 123 4567', { isVacancy: true }), []);
  assert.deepEqual(matchRisk('Message me on WhatsApp', { isVacancy: false }), ['off_platform_contact']);
  assert.ok(matchRisk('You must pay a registration fee', { isVacancy: true }).includes('payment_request'));
});

test('moderator digest only marks items notified after the email is really sent', () => {
  const script = read('scripts/flag-community-risk.mjs');
  assert.match(script, /if \(!sent\.sent\)/);
  assert.match(script, /notified_at/);
  assert.match(read('.github/workflows/community-risk.yml'), /cron: "15 \* \* \* \*"/);
});

test('worker: poster upload validates JPEG bytes, rate limits, tags the owner, owner-only delete', () => {
  assert.match(worker, /looksLikeJpeg\(bytes\)/);
  assert.match(worker, /posterUploadAllowed\(posterUserId\)/);
  assert.match(worker, /customMetadata: \{ owner: posterUserId \}/);
  assert.match(worker, /method === "DELETE"/);
  assert.match(worker, /head\.customMetadata\.owner !== deleteUserId/);
  const sandbox = {};
  vm.runInNewContext(worker.match(/function looksLikeJpeg[\s\S]*?\n}\n/)[0] + ';this.f=looksLikeJpeg', sandbox);
  assert.equal(sandbox.f(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer), true);
  assert.equal(sandbox.f(new TextEncoder().encode('<html>').buffer), false);
});

test('poster helper reports unreadable images and unblocks submit', () => {
  const forms = read('app-forms.js');
  assert.match(forms, /img\.onerror = function\(\) \{ finish\(new Error\('decode failed'\)\)/);
  assert.match(forms, /ctx\.fillStyle = '#fff'/);
  assert.match(appSource, /communityPosterPreparing/);
});

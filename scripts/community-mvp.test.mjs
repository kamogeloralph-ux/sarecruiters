import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20261006_community_interview_tips.sql');
const app = read('app-community.js');
const html = read('index.html');
const bundle = read('scripts/bundle-app.js');
const build = read('generate-pages.js');

test('Interview Tips group and official welcome post are seeded once', () => {
  assert.match(migration, /'interview-tips'/);
  assert.match(migration, /on conflict \(slug\) do update/i);
  assert.match(migration, /'interview-tips-welcome-v1'/);
  assert.match(migration, /on conflict \(system_key\) do nothing/i);
});

test('community tables are protected by RLS and public identity columns are not selectable', () => {
  for (const table of ['community_groups', 'community_memberships', 'community_posts', 'community_comments', 'community_post_reactions', 'community_reports']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /grant select \(id, group_id, author_label, body, status, is_official,[\s\S]*?on public\.community_posts to anon, authenticated/i);
  assert.match(migration, /grant select \(id, post_id, author_label, body, status, created_at\)[\s\S]*?on public\.community_comments to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant select\s*\([^)]*\bauthor_id\b/i);
  assert.doesNotMatch(migration, /grant select\s*\([^)]*\breporter_id\b/i);
});

test('member posts and comments default to pending review and fixed pseudonymous labels', () => {
  assert.match(migration, /author_label text not null default 'Anonymous member'/);
  assert.match(migration, /status text not null default 'pending'/);
  assert.match(migration, /community_posts_insert_member[\s\S]*?status = 'pending'/);
  assert.match(migration, /community_comments_insert_member[\s\S]*?status = 'pending'/);
  assert.match(migration, /community_posts_admin_moderate/);
  assert.match(migration, /community_comments_admin_moderate/);
});

test('client uses only approved content for feeds and includes join, report, and moderation flows', () => {
  assert.match(app, /\.eq\('status', 'approved'\)/);
  assert.match(app, /from\('community_memberships'\)/);
  assert.match(app, /from\('community_reports'\)/);
  assert.match(app, /communityModerationQueue|communityLoadModerationQueue/);
  assert.match(app, /rpc\('is_admin'\)/);
  assert.match(app, /if \(!moderated\) return;[\s\S]*?community_reports'\)\.update\(\{ status: 'reviewed' \}\)/);
  assert.doesNotMatch(app, /select\([^)]*author_id|select\([^)]*reporter_id/i);
  assert.match(html, /id="screen-community"/);
  assert.match(html, /onclick="openCommunity\(\)"/);
  assert.match(html, /id="community-report-overlay"/);
});

test('community code and stylesheet participate in normal cache-busted builds', () => {
  assert.match(bundle, /'app-community\.js'/);
  assert.match(html, /community\.css\?v=/);
  assert.match(build, /'community\.css'/);
  assert.match(build, /styles\\\.css\|community\\\.css/);
});

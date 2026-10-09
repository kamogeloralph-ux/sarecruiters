import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20261006_community_interview_tips.sql');
const policyFix = read('supabase/migrations/20261007_community_membership_policy_fix.sql');
const vacancyMigration = read('supabase/migrations/20261010_community_text_vacancies.sql');
const app = read('app-community.js');
const html = read('index.html');
const communityCss = read('community.css');
const sharedCss = read('styles.css');
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

test('participation insert policies use a private current-user membership verifier', () => {
  assert.match(policyFix, /create or replace function public\.community_is_current_member\(p_group_id uuid\)[\s\S]*?security definer/i);
  assert.match(policyFix, /where m\.group_id = p_group_id[\s\S]*?m\.user_id = auth\.uid\(\)/i);
  assert.match(policyFix, /revoke all on function public\.community_is_current_member\(uuid\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(policyFix, /grant execute on function public\.community_is_current_member\(uuid\)[\s\S]*?to authenticated/i);
  for (const name of ['community_posts_insert_member', 'community_comments_insert_member', 'community_reactions_insert_member']) {
    assert.match(policyFix, new RegExp(`drop policy if exists ${name}`));
  }
  const policies = policyFix.slice(policyFix.indexOf('create policy community_posts_insert_member'));
  assert.match(policies, /community_is_current_member/g);
  assert.doesNotMatch(policies, /from public\.community_memberships/i, 'RLS checks must not directly SELECT the private memberships table');
  assert.match(app, /Your draft remains in the box/);
  assert.match(app, /catch \(error\) \{\s*result = \{ error: error \};/);
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

test('Interview Tips keeps all content below its title bar in one scrollable pane', () => {
  const start = html.indexOf('<div class="screen" id="screen-community">');
  const end = html.indexOf('<!-- ============ SMART MANAGER', start);
  const screen = html.slice(start, end);
  const scrollAt = screen.indexOf('<div class="screen-scroll">');
  assert.match(screen, /<div class="screen-fixed">\s*<header class="community-header">[\s\S]*?<\/header>\s*<\/div>\s*<div class="screen-scroll">\s*<section class="community-group-banner"/);
  assert.ok(scrollAt >= 0, 'community screen must expose its scroll region');
  const divTags = /<\/?div\b[^>]*>/gi;
  divTags.lastIndex = scrollAt;
  let depth = 0, scrollEnd = -1, match;
  while ((match = divTags.exec(screen))) {
    if (match[0].startsWith('</')) {
      depth--;
      if (depth === 0) { scrollEnd = match.index; break; }
    } else {
      depth++;
    }
  }
  assert.ok(scrollEnd > scrollAt, 'community scroll region must close after its full contents');
  for (const marker of ['community-group-banner', 'community-safety-note', 'community-compose', 'community-admin-panel', 'community-feed-toolbar', 'community-feed']) {
    const markerAt = screen.indexOf(marker);
    assert.ok(markerAt > scrollAt && markerAt < scrollEnd, `${marker} must remain reachable inside the scroll pane`);
  }
  assert.match(sharedCss, /\.screen-scroll\{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch/);
  assert.match(communityCss, /#screen-community \.screen-scroll\{min-height:0;flex:1 1 auto;overflow-y:auto;padding:0 16px 112px;overscroll-behavior-y:contain\}/);
});

test('community code and stylesheet participate in normal cache-busted builds', () => {
  assert.match(bundle, /'app-community\.js'/);
  assert.match(html, /community\.css\?v=/);
  assert.match(build, /'community\.css'/);
  assert.match(build, /styles\\\.css\|community\\\.css/);
});

test('Tips Chat supports moderated text vacancy posts without exposing private IDs', () => {
  assert.match(vacancyMigration, /add column if not exists post_type text not null default 'discussion'/i);
  assert.match(vacancyMigration, /post_type in \('discussion', 'vacancy'\)/i);
  assert.match(vacancyMigration, /grant insert \([\s\S]*vacancy_title[\s\S]*\) on public\.community_posts to authenticated/i);
  assert.match(app, /communitySetComposerType/);
  assert.match(app, /communityMissingVacancySchema/);
  assert.match(app, /Retry as a normal community post/);
  assert.match(app, /insert\(\{ group_id: communityMvp\.group\.id, body: body \}\)/);
  assert.match(app, /vacancySchemaAvailable/);
  assert.match(app, /post_type: communityComposerType/);
  assert.match(app, /communityVacancyMetaHtml/);
  assert.match(html, /data-community-compose-type="vacancy"/);
  assert.match(html, /id="community-vacancy-title"/);
  assert.match(communityCss, /\.community-vacancy-badge/);
});

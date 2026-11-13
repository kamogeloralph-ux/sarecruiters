import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatVacancyRoundup } from '../Cloudflare-worker/tipchat-publisher.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

test('marketplace migration adds bounded listing metadata and the auto-post kill switch', () => {
  const sql = read('supabase/migrations/20261113_tipchat_marketplace_and_auto_posts.sql');
  for (const column of ['marketplace_title', 'marketplace_price', 'marketplace_category', 'marketplace_condition', 'marketplace_location', 'marketplace_contact']) {
    assert.match(sql, new RegExp(`add column if not exists ${column} text`));
    assert.match(sql, new RegExp(`${column}_check`));
  }
  assert.match(sql, /post_type in \('discussion', 'vacancy', 'marketplace'\)/);
  assert.match(sql, /tipchat_auto_vacancy_posts/);
  assert.match(sql, /grant insert \([\s\S]*marketplace_title[\s\S]*\) on public\.community_posts to authenticated/);
});

test('TipChat UI exposes safe buy-and-sell listing fields', () => {
  const html = read('index.html');
  const app = read('app-community.js');
  assert.match(html, /data-community-compose-type="marketplace"/);
  assert.match(html, /community-marketplace-title/);
  assert.match(html, /Never share a banking password, PIN, OTP/);
  assert.match(app, /post_type: isVacancy \? 'vacancy' : \(isMarketplace \? 'marketplace'/);
  assert.match(app, /communityMarketplaceMetaHtml/);
  assert.match(app, /marketplace_contact/);
});

test('scheduled roundup is deterministic, short and carries a safety reminder', () => {
  const worker = read('Cloudflare-worker/worker.js');
  const publisher = read('Cloudflare-worker/tipchat-publisher.js');
  const text = formatVacancyRoundup([
    { title: 'Admin Clerk', location: 'Pretoria' },
    { title: 'Retail Supervisor', location: 'Johannesburg' }
  ], 'https://sa-recruiters.co.za');
  assert.match(worker, /publishTipchatVacancyRoundup/);
  assert.match(publisher, /tipchat_auto_vacancy_posts/);
  assert.match(publisher, /MAX_VACANCIES_PER_ROUNDUP = 3/);
  assert.match(publisher, /is_official: true/);
  assert.match(publisher, /status: "approved"/);
  assert.match(text, /Admin Clerk — Pretoria/);
  assert.match(text, /closing date and application instructions/);
});

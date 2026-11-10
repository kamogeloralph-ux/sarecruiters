import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { pickPosterOfTheDay } = await import('./generate-daily-poster.mjs');

const now = new Date('2026-11-10T05:00:00Z');
const row = (id, hoursAgo, extra = {}) => ({
  id, title: `Job ${id}`, company: 'Co', link: 'https://example.com/' + id,
  created_at: new Date(now - hoursAgo * 3600e3).toISOString(), ...extra,
});

test('picks the newest fresh vacancy', () => {
  assert.equal(pickPosterOfTheDay([row('a', 2), row('b', 5)], now).id, 'a');
});
test('skips rows without a title or link', () => {
  assert.equal(pickPosterOfTheDay([row('a', 1, { link: '' }), row('b', 3)], now).id, 'b');
});
test('returns null when there is nothing eligible', () => {
  assert.equal(pickPosterOfTheDay([], now), null);
});
test('falls back to a rotating pick when nothing is fresh', () => {
  const rows = [row('a', 100), row('b', 120)];
  assert.ok(['a', 'b'].includes(pickPosterOfTheDay(rows, now).id));
});
test('generator no longer publishes to the posters feed', () => {
  const src = readFileSync(new URL('./generate-daily-poster.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /automation\/poster|employer_posters|fetch\(/);
  const wf = readFileSync(new URL('../.github/workflows/daily-poster.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(wf, /POSTER_AUTOMATION_TOKEN|POSTERS_PER_RUN|WORKER_URL/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, buildDigest } from './send-saved-search-alerts.mjs';

const s = { query: 'forklift driver', location: 'durban', remote: '', experience: '', last_checked_at: '2026-09-28T00:00:00Z', unsubscribe_token: 'tok' };
const v = { title: 'Forklift Driver', company: 'ABC', location: 'Durban, KZN', created_at: '2026-09-29T08:00:00Z' };

test('matches all terms + location, only after last check', () => {
  assert.equal(matchesSearch(s, v), true);
  assert.equal(matchesSearch(s, { ...v, created_at: '2026-09-27T00:00:00Z' }), false);
  assert.equal(matchesSearch(s, { ...v, title: 'Cashier' }), false);
  assert.equal(matchesSearch(s, { ...v, location: 'Cape Town' }), false);
});
test('skips expired vacancies and honours remote filter', () => {
  assert.equal(matchesSearch(s, { ...v, closing_date: '2020-01-01' }), false);
  assert.equal(matchesSearch({ ...s, remote: 'Remote' }, v), false);
});
test('digest escapes HTML and includes unsubscribe link', () => {
  const d = buildDigest(s, [{ ...v, title: '<b>x</b>' }]);
  assert.match(d.subject, /1 new job for forklift driver in durban/);
  assert.ok(!d.html.includes('<b>x</b>'));
  assert.match(d.html, /unsub_search=tok/);
});

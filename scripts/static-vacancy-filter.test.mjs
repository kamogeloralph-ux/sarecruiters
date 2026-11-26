import test from 'node:test';
import assert from 'node:assert/strict';
import { dropExpired, applyPosterCaps, filterLiveVacancies, splitVacancyNotes } from './static-vacancy-filter.mjs';

const row = (id, extra = {}) => ({ id, created_at: `2026-09-${String(10 + (Number(id.replace(/\D/g, '')) % 18)).padStart(2, '0')}`, ...extra });

test('dropExpired removes past closing dates and keeps unparseable/blank ones', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  const rows = [row('a', { closing_date: '2026-09-29' }), row('b', { closing_date: '30 September 2026' }), row('c', { closing_date: 'ASAP' }), row('d', {})];
  assert.deepEqual(dropExpired(rows, now).map((r) => r.id), ['b', 'c', 'd']);
});

test('applyPosterCaps keeps the newest N per unlinked company, case/space-insensitively', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, company: i % 2 ? 'Hire  Resolve' : 'hire resolve', created_at: `2026-09-0${i + 1}` }));
  const kept = applyPosterCaps(rows, 3);
  assert.deepEqual(kept.map((r) => r.id).sort(), ['x5', 'x6', 'x7']);
});

test('applyPosterCaps caps real agencies and employers separately and leaves blank-company rows alone', () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `ag${i}`, agency_id: 'A1', created_at: `2026-09-0${i + 1}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `em${i}`, employer_id: 'E1', created_at: `2026-09-0${i + 1}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `bl${i}`, agency_id: 'general', company: '', created_at: `2026-09-0${i + 1}` })),
  ];
  const kept = applyPosterCaps(rows, 2).map((r) => r.id);
  assert.equal(kept.filter((id) => id.startsWith('ag')).length, 2);
  assert.equal(kept.filter((id) => id.startsWith('em')).length, 2);
  assert.equal(kept.filter((id) => id.startsWith('bl')).length, 4);
});

test('filterLiveVacancies combines expiry and caps', () => {
  const rows = [row('k1', { company: 'Acme', closing_date: '2020-01-01' }), row('k2', { company: 'Acme' }), row('k3', { company: 'Acme' })];
  assert.deepEqual(filterLiveVacancies(rows, { cap: 1, now: new Date('2026-09-30') }).length, 1);
});

test('splitVacancyNotes strips descriptions from rows and returns an id -> notes map', () => {
  const rows = [{ id: 'a', title: 'A', notes: 'Long text' }, { id: 'b', title: 'B', notes: '' }, { id: 'c', title: 'C', notes: null }];
  const { lean, notes } = splitVacancyNotes(rows);
  assert.deepEqual(notes, { a: 'Long text' });
  assert.ok(lean.every((r) => r.notes === null));
  assert.equal(rows[0].notes, 'Long text', 'input rows are not mutated');
});


test('committed startup snapshots exclude candidate profiles', async () => {
  const fs = await import('node:fs');
  const snapshot = JSON.parse(fs.readFileSync(new URL('../data/startup.json', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(snapshot, 'pool_candidates'), false);
  assert.equal(snapshot.counts.candidates, 0);
});

import { isGenericCompanyLabel, posterCapFromEnv, DEFAULT_MAX_PER_POSTER } from './vacancy-policy.mjs';

test('the snapshot filter and the delete job share one default cap (it used to be 50 vs 250-500)', () => {
  assert.equal(DEFAULT_MAX_PER_POSTER, 500);
  assert.deepEqual(posterCapFromEnv({}), { cap: 500, companyCap: 500 });
  assert.deepEqual(posterCapFromEnv({ MAX_PER_POSTER: '1000', MAX_PER_COMPANY: '200' }), { cap: 1000, companyCap: 200 });
  assert.equal(posterCapFromEnv({ MAX_PER_POSTER: 'abc' }).cap, 500);
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, company: 'Big Retailer', created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}` }));
  assert.equal(filterLiveVacancies(rows, { now: new Date('2026-09-30') }).length, 120, 'no longer trimmed to 50');
});

test('placeholder company names are not treated as one employer', () => {
  assert.equal(isGenericCompanyLabel('private advertiser'), true);
  assert.equal(isGenericCompanyLabel('pick n pay'), false);
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, company: 'Private Advertiser', created_at: `2026-09-0${i + 1}` }));
  assert.equal(applyPosterCaps(rows, 2).length, 6);
});

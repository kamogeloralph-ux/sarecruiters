import test from 'node:test';
import assert from 'node:assert/strict';
import { dropExpired, applyPosterCaps, filterLiveVacancies } from './static-vacancy-filter.mjs';

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

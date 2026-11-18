import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileVacancyFreshness } from './reconcile-vacancy-freshness.mjs';

const now = new Date('2026-11-18T10:00:00.000Z');

function row(id, extra = {}) {
  return {
    id,
    title: id,
    source_type: 'adzuna',
    created_at: '2026-11-17T10:00:00.000Z',
    updated_at: '2026-11-17T10:00:00.000Z',
    source_checked_at: '2026-11-17T10:00:00.000Z',
    last_verified_at: '2026-11-17T10:00:00.000Z',
    closing_date: '',
    notes: '',
    ...extra,
  };
}

test('expired vacancies are removed regardless of source health', async () => {
  const result = await reconcileVacancyFreshness({
    now,
    successfulSources: new Set(),
    rows: [row('expired', { closing_date: '2026-11-17' }), row('kept', { closing_date: '2026-11-30' })],
  });
  assert.deepEqual(result.deleted.map((item) => item.id), ['expired']);
});

test('a successful source removes rows not seen within the grace period', async () => {
  const result = await reconcileVacancyFreshness({
    now,
    successfulSources: new Set(['adzuna']),
    rows: [
      row('old', { source_checked_at: '2026-11-10T10:00:00.000Z' }),
      row('recent', { source_checked_at: '2026-11-17T10:00:00.000Z' }),
    ],
  });
  assert.deepEqual(result.deleted.map((item) => item.id), ['old']);
});

test('failed sources are preserved even when their rows are old', async () => {
  const result = await reconcileVacancyFreshness({
    now,
    successfulSources: new Set(),
    rows: [row('old', { source_checked_at: '2026-10-01T10:00:00.000Z' })],
  });
  assert.equal(result.deleted.length, 0);
});

test('retail is reconciled only when both retail scrapers succeed', async () => {
  const old = row('old-retail', { source_type: 'retail', source_checked_at: '2026-10-01T10:00:00.000Z' });
  const oracleOnly = await reconcileVacancyFreshness({ now, successfulSources: new Set(['oracle']), rows: [old] });
  const both = await reconcileVacancyFreshness({ now, successfulSources: new Set(['oracle', 'retail']), rows: [old] });
  assert.equal(oracleOnly.deleted.length, 0);
  assert.equal(both.deleted.length, 1);
});

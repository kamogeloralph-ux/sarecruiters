// Regression guard for the "Talent Pool Candidates card shows 0 until you
// click it" bug.
//
// The home "Candidates" stat card reads poolCandidateCount, which comes from
// counts.candidates in the committed static snapshot (data/startup.json) on
// first paint. That snapshot used to hard-code candidates: 0 and omit the pool
// rows entirely, so the card sat at 0 until the visitor opened the Talent Pool
// screen (which fetches the live count from the Worker).
//
// Two things keep it fixed:
//   1. scripts/export-static-data.mjs now reads pool_candidates_public and
//      ships both counts.candidates and pool_candidates in the snapshot.
//   2. app-data.js backfills the count from the Worker when a (possibly stale)
//      snapshot has no pool_candidates of its own.
// These source-level assertions catch a regression in either half.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const exportSrc = read('./export-static-data.mjs');
const appDataSrc = read('../app-data.js');

test('static export reads the public Talent Pool view', () => {
  assert.ok(
    /readAll\(\s*['"]pool_candidates_public['"]/.test(exportSrc),
    'export-static-data.mjs must read pool_candidates_public'
  );
});

test('static export ships pool_candidates and derives counts.candidates from it', () => {
  assert.ok(
    /pool_candidates:\s*livePoolCandidates/.test(exportSrc),
    'the exported payload must include a pool_candidates array'
  );
  assert.ok(
    /candidates:\s*livePoolCandidates\.length/.test(exportSrc),
    'counts.candidates must be derived from the pool rows, not hard-coded'
  );
  assert.ok(
    /activePoolCandidates\(\s*poolCandidates\s*\)/.test(exportSrc),
    'the export must filter the pool view down to active candidates'
  );
});

test('app-data backfills the pool count when the snapshot has no pool_candidates', () => {
  assert.ok(
    /window\.__saStaticData\s*&&\s*!Array\.isArray\(startup\.pool_candidates\)/.test(appDataSrc),
    'loadAll() must detect a snapshot without pool_candidates'
  );
  assert.ok(
    /getPoolCandidateCount\(\)\.then\(/.test(appDataSrc),
    'loadAll() must backfill the count from the Worker in that case'
  );
});

test('committed snapshot is self-consistent when it carries pool_candidates', () => {
  const d = JSON.parse(read('../data/startup.json'));
  assert.ok(d.counts && typeof d.counts.candidates === 'number', 'snapshot must expose counts.candidates');
  if (Array.isArray(d.pool_candidates)) {
    const active = d.pool_candidates.filter((c) => (c.status || 'pending') === 'active').length;
    assert.equal(
      d.counts.candidates,
      active,
      'counts.candidates must equal the number of active rows in pool_candidates'
    );
  }
});

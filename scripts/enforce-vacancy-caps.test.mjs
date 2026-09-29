import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyName, collectOverflow } from './enforce-vacancy-caps.mjs';

test('normalizeCompanyName trims, lower-cases and collapses whitespace', () => {
  assert.equal(normalizeCompanyName('  Pick n Pay  '), 'pick n pay');
  assert.equal(normalizeCompanyName('Pick   n\tPay'), 'pick n pay');
  assert.equal(normalizeCompanyName('PICK N PAY'), 'pick n pay');
  assert.equal(normalizeCompanyName(null), '');
  assert.equal(normalizeCompanyName(undefined), '');
});

test('normalizeCompanyName does NOT merge genuinely different company names', () => {
  assert.notEqual(normalizeCompanyName('Pick n Pay'), normalizeCompanyName('Pick n Pay Clothing'));
  assert.notEqual(normalizeCompanyName('AGC Recruitment'), normalizeCompanyName('AGC Mining'));
});

// collectOverflow is the shared grouping/trim logic used for agency_id,
// employer_id, AND (the fix this file covers) normalized company name.
test('collectOverflow keeps the newest `cap` rows per group and returns the rest', () => {
  // Rows must already be created_at DESC, as loadAllVacancies() provides.
  const rows = [
    { id: 'a3', created_at: '2026-09-03' },
    { id: 'a2', created_at: '2026-09-02' },
    { id: 'a1', created_at: '2026-09-01' },
    { id: 'b1', created_at: '2026-09-01' },
  ];
  const overflow = collectOverflow(rows, (row) => row.id[0], 2);
  assert.equal(overflow.size, 1);
  assert.deepEqual(overflow.get('a').map((r) => r.id), ['a1']);
  assert.ok(!overflow.has('b'), 'group under the cap is not included at all');
});

test('collectOverflow skips rows whose key function returns a falsy key', () => {
  const rows = [
    { id: '1', created_at: '2026-09-03', agencyId: 'x' },
    { id: '2', created_at: '2026-09-02', agencyId: null },
    { id: '3', created_at: '2026-09-01', agencyId: 'x' },
  ];
  const overflow = collectOverflow(rows, (row) => row.agencyId, 1);
  assert.equal(overflow.size, 1);
  assert.deepEqual(overflow.get('x').map((r) => r.id), ['3']);
});

// This is the actual bug being fixed: scraped rows with no real agency_id
// or employer_id (the sentinel values scrapers use) but the SAME company
// name, in different casing/spacing, must be recognised as one poster and
// capped together -- previously each spelling variant, and any row with no
// agency/employer link at all, was invisible to the cap entirely.
test('unlinked rows sharing a normalized company name are capped together regardless of spelling/casing', () => {
  const AGENCY_SENTINELS = new Set(['general', 'employer']);
  function unlinkedCompanyKey(row) {
    if (row.agency_id && !AGENCY_SENTINELS.has(row.agency_id)) return null;
    if (row.employer_id) return null;
    return normalizeCompanyName(row.company) || null;
  }

  const rows = [
    { id: 'new-1', created_at: '2026-09-10', agency_id: 'general', employer_id: null, company: 'Pick n Pay' },
    { id: 'new-2', created_at: '2026-09-09', agency_id: 'general', employer_id: null, company: 'pick n pay' },
    { id: 'old-1', created_at: '2026-09-08', agency_id: null, employer_id: null, company: 'PICK N PAY' },
    { id: 'old-2', created_at: '2026-09-07', agency_id: 'general', employer_id: null, company: '  Pick n Pay  ' },
    // A row for a DIFFERENT, real agency shouldn't be swept into the same
    // group even if the company text happens to match -- it's governed by
    // the agency_id cap instead, not the unlinked-company cap.
    { id: 'linked-1', created_at: '2026-09-06', agency_id: 'a-real-agency-uuid', employer_id: null, company: 'Pick n Pay' },
    // A row with a real employer_id is likewise excluded from this grouping.
    { id: 'employer-linked-1', created_at: '2026-09-05', agency_id: null, employer_id: 'e-real-employer-uuid', company: 'Pick n Pay' },
    // An unrelated company must never be merged in.
    { id: 'other-1', created_at: '2026-09-04', agency_id: 'general', employer_id: null, company: 'Boxer Superstores' },
  ];

  const overflow = collectOverflow(rows, unlinkedCompanyKey, 2);
  assert.equal(overflow.size, 1, 'only the Pick n Pay group is over the cap of 2');
  const trimmedIds = overflow.get('pick n pay').map((r) => r.id).sort();
  assert.deepEqual(trimmedIds, ['old-1', 'old-2']);
});

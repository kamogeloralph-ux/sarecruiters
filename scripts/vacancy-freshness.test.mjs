import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateString,
  closingDateIsPast,
  postingIsTooOld,
  isStaleVacancy,
  maxAgeDaysForSource,
} from './vacancy-freshness.mjs';

const NOW = new Date('2026-09-19T12:00:00Z');

test('parseDateString handles the formats the sources actually emit', () => {
  assert.equal(parseDateString('17 Sep 2026').toISOString(), '2026-09-17T00:00:00.000Z');
  assert.equal(parseDateString('15 September 2026').toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(parseDateString('Posted: 3 Feb 2021').toISOString(), '2021-02-03T00:00:00.000Z');
  assert.equal(parseDateString('2026-09-17').toISOString(), '2026-09-17T00:00:00.000Z');
  assert.equal(parseDateString('17/09/2026').toISOString(), '2026-09-17T00:00:00.000Z');
  assert.equal(parseDateString('3 March 2027').toISOString(), '2027-03-03T00:00:00.000Z');
});

test('parseDateString returns null for junk or ambiguous junk rather than guessing', () => {
  assert.equal(parseDateString(''), null);
  assert.equal(parseDateString('n/a'), null);
  assert.equal(parseDateString('99/99/2026'), null);
  assert.equal(parseDateString('13 Smarch 2026'), null);
  assert.equal(parseDateString(null), null);
});

test('closingDateIsPast: past dates are stale, recent/future/garbage are not', () => {
  assert.equal(closingDateIsPast('01 Jan 2021', NOW), true);
  assert.equal(closingDateIsPast('17 Sep 2026', NOW), true, '2 days past closing (incl. grace)');
  assert.equal(closingDateIsPast('18 Sep 2026', NOW), false, 'inside the 2-day grace period');
  assert.equal(closingDateIsPast('01 Jan 2027', NOW), false);
  assert.equal(closingDateIsPast('', NOW), false);
  assert.equal(closingDateIsPast('whenever', NOW), false);
});

test('postingIsTooOld: the Graduates24 2021-learnership case is stale', () => {
  assert.equal(
    postingIsTooOld({ postedText: '3 Feb 2021', sourceType: 'learnerships', now: NOW }),
    true,
    '2021 learnership must be flagged',
  );
  assert.equal(
    postingIsTooOld({ postedText: '10 Sep 2026', sourceType: 'learnerships', now: NOW }),
    false,
    '9-day-old learnership is fine',
  );
  assert.equal(
    postingIsTooOld({ postedText: '15 September 2026', sourceType: 'jobmail', now: NOW }),
    false,
    '4-day-old jobmail is fine',
  );
  assert.equal(
    postingIsTooOld({ postedText: 'not a date', fallbackDate: '2020-01-01', sourceType: 'jobmail', now: NOW }),
    true,
    'unparseable posted text falls back to row created_at',
  );
  assert.equal(
    postingIsTooOld({ postedText: '', fallbackDate: null, sourceType: 'jobmail', now: NOW }),
    false,
    'no date signal at all must never be treated as stale',
  );
});

test('maxAgeDaysForSource matches the per-source TTL ceilings', () => {
  assert.equal(maxAgeDaysForSource('jobmail'), 21);
  assert.equal(maxAgeDaysForSource('learnerships'), 30);
  assert.equal(maxAgeDaysForSource('retail'), 30);
  assert.equal(maxAgeDaysForSource('adzuna'), 45);
  assert.equal(maxAgeDaysForSource('government'), 90);
  assert.equal(maxAgeDaysForSource('something-new'), 60);
});

test('isStaleVacancy: closing date wins, then posted text from notes', () => {
  assert.equal(
    isStaleVacancy({ closing_date: '01 Jan 2021', source_type: 'learnerships' }, NOW).stale,
    true,
  );
  assert.equal(
    isStaleVacancy({
      closing_date: '', notes: 'Posted 3 Feb 2021. Some description.',
      source_type: 'learnerships',
    }, NOW).stale,
    true,
    'posted date inside notes is detected',
  );
  assert.equal(
    isStaleVacancy({
      closing_date: '', notes: '15 September 2026', source_type: 'jobmail',
    }, NOW).stale,
    false,
    'fresh jobmail posting with a bare notes date is kept',
  );
  assert.equal(
    isStaleVacancy({ closing_date: '', notes: '', created_at: '2020-01-01T00:00:00Z', source_type: 'learnerships' }, NOW).stale,
    true,
    'old created_at fallback flags a date-less row',
  );
  assert.equal(
    isStaleVacancy({ closing_date: '', notes: '', created_at: null, source_type: 'learnerships' }, NOW).stale,
    false,
    'no signals at all → keep (conservative)',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');

test('restored CV-picture counts must have a recent live-fetch timestamp', () => {
  assert.match(appData, /CV_PIC_COUNT_CACHE_TTL_MS = 60_000/);
  assert.match(appData, /cvPicCountFetchedAt:\s*cvPicCountFetchedAt/);
  assert.match(appData, /d\.cvPicCountFetchedAt <= cacheNow/);
  assert.match(appData, /cacheNow - d\.cvPicCountFetchedAt <= CV_PIC_COUNT_CACHE_TTL_MS/);
  assert.match(appData, /cvPicTotalCount === null \? '…' : cvPicTotalCount/);
});

test('a failed live CV-picture refresh clears and persists the stale count state', () => {
  const start = appData.indexOf('export async function getCvPictures()');
  const end = appData.indexOf('// ----- Vacancies -----', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const fetcher = appData.slice(start, end);
  assert.match(fetcher, /cvPicTotalCount = null/);
  assert.match(fetcher, /cvPicCountFetchedAt = null/);
  assert.match(fetcher, /updateCvPicStat\(\)/);
  assert.match(fetcher, /await saveDataCache\(\)/);
});

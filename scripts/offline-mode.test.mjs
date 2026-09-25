import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const dataSource = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');
const helperStart = dataSource.indexOf('function offlineVacancyRows()');
const helperEnd = dataSource.indexOf('var startupDataPromise', helperStart);
const filterStart = dataSource.indexOf('function filterOfflineVacancies');
const filterEnd = dataSource.indexOf('window.filterOfflineVacancies', filterStart) + 'window.filterOfflineVacancies = filterOfflineVacancies;'.length;
const sandbox = {
  window: {},
  offlineLazyVacancies: {
    general: [{ id: 'general-1', title: 'General role', source_type: null }],
    adzuna: [{ id: 'adzuna-1', title: 'Remote role', source_type: 'adzuna' }]
  },
  vacanciesCache: [{ id: 'agency-1', title: 'Agency role' }],
  filterExpiredVacancies(rows) { return rows; },
  isGeneralDirectoryVacancy(row) { return row.source_type !== 'adzuna'; },
  DEDICATED_VACANCY_FOLDER_SOURCES: { adzuna: ['adzuna'] },
  saveDataCache() {}
};
vm.runInNewContext(`${dataSource.slice(helperStart, helperEnd)}\n${dataSource.slice(filterStart, filterEnd)}\nglobalThis.api = { offlineVacancyRows, filterOfflineVacancies };`, sandbox);
const api = sandbox.api;

test('offline index unions startup and previously visited lazy pages without duplicates', () => {
  sandbox.offlineLazyVacancies.general.push({ id: 'agency-1', title: 'newer copy' });
  const rows = api.offlineVacancyRows();
  assert.equal(JSON.stringify(rows.map((row) => row.id).sort()), JSON.stringify(['adzuna-1', 'agency-1', 'general-1']));
  assert.equal(rows.find((row) => row.id === 'agency-1').title, 'newer copy');
});

test('offline filtering applies text, source folder, remote and experience filters locally', () => {
  const rows = [
    { id: 'a', title: 'Frontend Engineer', company: 'Acme', location: 'Cape Town', notes: '', source_type: 'adzuna', remote: 'yes', experience_level: 'Mid' },
    { id: 'b', title: 'Warehouse Driver', company: 'Beta', location: 'Durban', notes: '', source_type: 'adzuna', remote: 'no', experience_level: 'Entry' }
  ];
  assert.equal(JSON.stringify(api.filterOfflineVacancies(rows, { q: 'frontend', remote: 'yes', exp: 'Mid' }, 'adzuna').map((row) => row.id)), JSON.stringify(['a']));
  assert.equal(JSON.stringify(api.filterOfflineVacancies(rows, { q: 'frontend' }, 'general')), JSON.stringify([]));
});

test('data cache is versioned and persists lazy vacancy pages', () => {
  assert.match(dataSource, /DATA_CACHE_SCHEMA_VERSION = 2/);
  assert.match(dataSource, /schemaVersion: DATA_CACHE_SCHEMA_VERSION/);
  assert.match(dataSource, /lazyVacancies: offlineLazyVacancies/);
  assert.match(dataSource, /indexedDB\.open\(DATA_CACHE_DB, DATA_CACHE_SCHEMA_VERSION\)/);
});

test('offline navigation avoids a network refresh when the browser is offline', () => {
  assert.match(dataSource, /if \(!navigator\.onLine\) \{/);
  assert.match(dataSource, /leaves the cached search index untouched/);
  assert.match(dataSource, /filterAndRenderCached\(\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCircularPage } from './sync-dpsa.mjs';

const pageUrl = 'https://www.dpsa.gov.za/newsroom/psvc/circular-33-of-2026/';
const fixture = `
  <html><head><title>Circular 33 of 2026 - DPSA</title></head><body>
    <h1>Circular 33 of 2026</h1>
    <p>Posting Date: 11 September 2026</p>
    <p>Full Document: <a href="/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2033%20of%202026.pdf">Circular 33</a></p>
    <p><a href="/dpsa2g/documents/vacancies/2026/33/a.pdf">Department A</a></p>
  </body></html>`;

test('parses an official DPSA circular page into a searchable archive record', () => {
  const record = parseCircularPage(fixture, pageUrl);
  assert.equal(record.id, 'dpsa-2026-33');
  assert.equal(record.title, 'DPSA Public Service Vacancy Circular 33 of 2026');
  assert.equal(record.company, 'Department of Public Service and Administration');
  assert.equal(record.source_type, 'dpsa');
  assert.match(record.notes, /11 September 2026/);
  assert.equal(record.link, 'https://www.dpsa.gov.za/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2033%20of%202026.pdf');
});

test('rejects pages without a full circular PDF', () => {
  assert.equal(parseCircularPage('<h1>Circular 33 of 2026</h1>', pageUrl), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCircularPage, parseGovernmentPdfTextForTest } from './sync-government.mjs';

const pageUrl = 'https://www.dpsa.gov.za/newsroom/psvc/circular-33-of-2026/';
const fixture = `
  <html><head><title>Circular 33 of 2026 - DPSA</title></head><body>
    <h1>Circular 33 of 2026</h1>
    <p>Posting Date: 11 September 2026</p>
    <p>Full Document: <a href="/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2033%20of%202026.pdf">Circular 33</a></p>
    <p><a href="/dpsa2g/documents/vacancies/2026/33/a.pdf">Department A</a></p>
  </body></html>`;

test('parses an official DPSA circular into a Government archive record', () => {
  const record = parseCircularPage(fixture, pageUrl);
  assert.equal(record.id, 'government-circular-2026-33');
  assert.equal(record.title, 'Government Public Service Vacancy Circular 33 of 2026');
  assert.equal(record.company, 'South African Government');
  assert.equal(record.source_type, 'government');
  assert.match(record.notes, /11 September 2026/);
  assert.equal(record.departmentPdfs.length, 1);
  assert.equal(record.departmentPdfs[0].url, 'https://www.dpsa.gov.za/dpsa2g/documents/vacancies/2026/33/a.pdf');
});

test('rejects pages without a full circular PDF', () => {
  assert.equal(parseCircularPage('<h1>Circular 33 of 2026</h1>', pageUrl), null);
});

test('extracts every POST block from a Government department PDF text export', () => {
  const text = `ANNEXURE A\nDEPARTMENT OF AGRICULTURE (DOA)\nCLOSING DATE : 28 September 2026 at 16:00\nPOST 33/01 : STATE VETERINARIAN REF NO: 3/3/1/83/2026\nSALARY : R932 292 per annum (Level 11)\nCENTRE : Mpumalanga: Skukuza\nREQUIREMENTS : Veterinary degree and registration.\nDUTIES : Provide veterinary services.\nPOST 33/02 : ASSISTANT DIRECTOR: EMPLOYEE RELATIONS REF NO: 3/3/1/84/2026\nSALARY : R487 197 per annum (Level 09)\nCENTRE : Gauteng: Pretoria\nREQUIREMENTS : Labour relations qualification.`;
  const jobs = parseGovernmentPdfTextForTest(text, { circularNumber: 33, year: 2026, pdfUrl: 'https://example.gov/a.pdf', sourceFile: 'a.pdf' });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].source_type, 'government');
  assert.equal(jobs[0].company, 'DEPARTMENT OF AGRICULTURE (DOA)');
  assert.equal(jobs[0].title, 'STATE VETERINARIAN');
  assert.equal(jobs[0].closing_date, '2026-09-28');
  assert.match(jobs[1].title, /ASSISTANT DIRECTOR/);
});

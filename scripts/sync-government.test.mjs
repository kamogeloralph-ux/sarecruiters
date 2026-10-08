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
  const text = `ANNEXURE A\nDEPARTMENT OF AGRICULTURE (DOA)\nCLOSING DATE : 28 September 2099 at 16:00\nPOST 33/01 : STATE VETERINARIAN REF NO: 3/3/1/83/2026\nSALARY : R932 292 per annum (Level 11)\nCENTRE : Mpumalanga: Skukuza\nREQUIREMENTS : Veterinary degree and registration.\nDUTIES : Provide veterinary services.\nPOST 33/02 : ASSISTANT DIRECTOR: EMPLOYEE RELATIONS REF NO: 3/3/1/84/2026\nSALARY : R487 197 per annum (Level 09)\nCENTRE : Gauteng: Pretoria\nREQUIREMENTS : Labour relations qualification.`;
  const jobs = parseGovernmentPdfTextForTest(text, { circularNumber: 33, year: 2026, pdfUrl: 'https://example.gov/a.pdf', sourceFile: 'a.pdf' });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].source_type, 'government');
  assert.equal(jobs[0].company, 'DEPARTMENT OF AGRICULTURE (DOA)');
  assert.equal(jobs[0].title, 'STATE VETERINARIAN');
  assert.equal(jobs[0].closing_date, '2099-09-28');
  assert.match(jobs[1].title, /ASSISTANT DIRECTOR/);
});

test('skips a POST block whose CLOSING DATE has already passed', () => {
  const text = `ANNEXURE B\nDEPARTMENT OF HEALTH\nCLOSING DATE : 01 January 2026 at 16:00\nPOST 33/09 : LONG-EXPIRED POST REF NO: 3/3/1/99/2026\nSALARY : R300 000 per annum\nCENTRE : Western Cape: Cape Town\nREQUIREMENTS : Grade 12.`;
  const jobs = parseGovernmentPdfTextForTest(text, { circularNumber: 33, year: 2026, pdfUrl: 'https://example.gov/b.pdf', sourceFile: 'b.pdf' });
  assert.equal(jobs.length, 0);
});

// Real-world shape: DPSA's circular page links to exactly ONE PDF -- the
// combined circular -- which itself contains one "ANNEXURE <letter>"
// section per department, each with its own closing date. This is the
// bug that had this scraper producing zero rows since it was written: it
// only ever read circular.departmentPdfs (separate per-department links),
// which the real site never provides, so its inner loop never ran for
// any circular, ever.
test('extracts POST blocks from a COMBINED circular PDF spanning multiple departments/ANNEXUREs, each with its own closing date', () => {
  const text = [
    'PUBLIC SERVICE VACANCY CIRCULAR 33 OF 2026',
    'ANNEXURE A',
    'DEPARTMENT OF AGRICULTURE (DOA)',
    'CLOSING DATE : 28 September 2099 at 16:00',
    'POST 33/01 : STATE VETERINARIAN REF NO: 3/3/1/83/2026',
    'SALARY : R932 292 per annum (Level 11)',
    'CENTRE : Mpumalanga: Skukuza',
    'REQUIREMENTS : Veterinary degree and registration.',
    'DUTIES : Provide veterinary services.',
    'ANNEXURE B',
    'DEPARTMENT OF HEALTH',
    'CLOSING DATE : 05 October 2099 at 16:00',
    'POST 33/45 : MEDICAL OFFICER GRADE 1 REF NO: HLT/2026/45',
    'SALARY : R1 059 285 per annum',
    'CENTRE : Western Cape: Tygerberg Hospital',
    'REQUIREMENTS : MBChB and current HPCSA registration.',
    'DUTIES : Provide clinical care.',
  ].join('\n');
  const jobs = parseGovernmentPdfTextForTest(text, { circularNumber: 33, year: 2026, pdfUrl: 'https://www.dpsa.gov.za/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2033%20of%202026.pdf', sourceFile: 'PSV CIRCULAR 33 of 2026.pdf' });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].company, 'DEPARTMENT OF AGRICULTURE (DOA)');
  assert.equal(jobs[0].title, 'STATE VETERINARIAN');
  assert.equal(jobs[0].closing_date, '2099-09-28');
  assert.equal(jobs[1].company, 'DEPARTMENT OF HEALTH');
  assert.equal(jobs[1].title, 'MEDICAL OFFICER GRADE 1');
  assert.equal(jobs[1].closing_date, '2099-10-05');
  // Different departments/closing dates must not collide on id.
  assert.notEqual(jobs[0].id, jobs[1].id);
});

test('PDF-link detection matches the real DPSA URL-encoded filename ("PSV%20CIRCULAR%2033%20of%202026.pdf"), not just its anchor text', () => {
  const html = `
    <html><head><title>Circular 33 of 2026 - DPSA</title></head><body>
      <h1>Circular 33 of 2026</h1>
      <p>Posting Date: 11 September 2026</p>
      <p><a href="/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2033%20of%202026.pdf">Download</a></p>
    </body></html>`;
  const record = parseCircularPage(html, pageUrl);
  assert.ok(record, 'expected a circular record');
  assert.match(record.link, /PSV%20CIRCULAR%2033%20of%202026\.pdf$/);
  // No separate department links on this page -- exactly the real-world
  // shape -- so departmentPdfs must be empty (discoverGovernmentVacancies
  // is what falls back to the combined PDF itself in that case).
  assert.equal(record.departmentPdfs.length, 0);
});

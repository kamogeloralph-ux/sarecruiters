import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgencySiteJobs } from './scrape-agency-sites.mjs';

const site = { name: 'Test Agency', url: 'https://example.co.za/vacancies/' };

test('tier A: parses a structured .job card', () => {
  const html = `
    <div class="job">
      <h3><a href="/vacancy/123-sales-rep">Sales Representative</a></h3>
      <span class="job-location">Cape Town</span>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Sales Representative');
  assert.equal(jobs[0].location, 'Cape Town');
  assert.equal(jobs[0].link, 'https://example.co.za/vacancy/123-sales-rep');
});

test('tier A: falls back to anchor scan when no card selectors match', () => {
  const html = `
    <div class="listing">
      <a href="/job/warehouse-supervisor-pe">Warehouse Supervisor - Port Elizabeth</a>
      <a href="/about">About us</a>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Warehouse Supervisor - Port Elizabeth');
  assert.equal(jobs[0].link, 'https://example.co.za/job/warehouse-supervisor-pe');
});

test('tier B: parses a Dittojobs-style block layout (title/ref/location as separate elements, no card markup)', () => {
  const html = `
    <body>
      <p>Account Executive</p>
      <p>Reference No: 1976879110</p>
      <p>East London, South Africa</p>
      <p>Some long description text about the role and requirements.</p>
      <p>Salary: Negotiable</p>

      <p>Bookkeeper (Accounting Firm)</p>
      <p>Reference No: 3336856505</p>
      <p>Port Elizabeth, South Africa</p>
      <p>Another description block for this role.</p>
      <p>Salary: R12000 to R18000</p>
    </body>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Account Executive');
  assert.equal(jobs[0].location, 'East London, South Africa');
  assert.equal(jobs[0].link, 'https://example.co.za/vacancies#ref-1976879110');
  assert.equal(jobs[1].title, 'Bookkeeper (Accounting Firm)');
  assert.equal(jobs[1].location, 'Port Elizabeth, South Africa');
});

test('returns nothing for a page with no recognizable jobs (e.g. a JS-rendered shell)', () => {
  const html = '<body><div id="app"></div></body>';
  assert.deepEqual(parseAgencySiteJobs(html, site), []);
});

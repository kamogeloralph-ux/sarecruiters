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

test('buildCandidateUrls: homepage + common paths, cached URL first', async () => {
  const { buildCandidateUrls } = await import('./scrape-agency-sites.mjs');
  const urls = buildCandidateUrls({ website: 'example.co.za', site_vacancy_url: 'https://example.co.za/careers/current' });
  assert.equal(urls[0], 'https://example.co.za/careers/current');
  assert.ok(urls.includes('https://example.co.za/'));
  assert.ok(urls.includes('https://example.co.za/vacancies/'));
  assert.ok(urls.includes('https://example.co.za/jobs/'));
});

test('buildCandidateUrls: adds https scheme when website has none', async () => {
  const { buildCandidateUrls } = await import('./scrape-agency-sites.mjs');
  const urls = buildCandidateUrls({ website: 'example.co.za' });
  assert.ok(urls[0].startsWith('https://example.co.za'));
});

test('buildCandidateUrls: empty for missing/unparseable website', async () => {
  const { buildCandidateUrls } = await import('./scrape-agency-sites.mjs');
  assert.deepEqual(buildCandidateUrls({ website: null }), []);
  assert.deepEqual(buildCandidateUrls({ website: '' }), []);
});

test('classifySite: all robots-blocked candidates -> skipped_robots', async () => {
  const { classifySite } = await import('./scrape-agency-sites.mjs');
  const result = classifySite([
    { url: 'https://a.co.za/', reason: 'blocked by robots.txt' },
    { url: 'https://a.co.za/jobs/', reason: 'blocked by robots.txt' },
  ]);
  assert.equal(result.status, 'skipped_robots');
});

test('classifySite: all unreachable candidates -> skipped_unreachable', async () => {
  const { classifySite } = await import('./scrape-agency-sites.mjs');
  const result = classifySite([
    { url: 'https://a.co.za/', reason: 'unreachable (HTTP 404)' },
    { url: 'https://a.co.za/jobs/', reason: 'unreachable (HTTP 404)' },
  ]);
  assert.equal(result.status, 'skipped_unreachable');
});

test('classifySite: mixed / fetched-but-empty candidates -> skipped_no_jobs', async () => {
  const { classifySite } = await import('./scrape-agency-sites.mjs');
  const result = classifySite([
    { url: 'https://a.co.za/', reason: 'fetched OK but no parseable jobs' },
    { url: 'https://a.co.za/jobs/', reason: 'unreachable (HTTP 404)' },
  ]);
  assert.equal(result.status, 'skipped_no_jobs');
});

test('classifySite: no candidates at all -> skipped_unreachable', async () => {
  const { classifySite } = await import('./scrape-agency-sites.mjs');
  const result = classifySite([]);
  assert.equal(result.status, 'skipped_unreachable');
});

test('tier A: card scan ignores blog/article cards mixed in with real job cards', () => {
  const html = `
    <article>
      <h3><a href="/career-advice/how-to-prepare-for-a-technical-assessment-test">How to Prepare for a Technical Assessment Test?</a></h3>
    </article>
    <div class="job">
      <h3><a href="/vacancies/senior-financial-accountant">Senior Financial Accountant</a></h3>
      <span class="job-location">Cape Town</span>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Senior Financial Accountant');
});

test('tier A: anchor-scan fallback excludes blog/insights/career-advice links even when they mention "career"', () => {
  const html = `
    <div class="listing">
      <a href="/insights/why-cape-town-is-a-fintech-powerhouse">Why Cape Town is a Financial & FinTech Powerhouse</a>
      <a href="/career-advice/top-roles-in-admin-recruitment-today">Top Roles in Admin Recruitment Today</a>
      <a href="/jobs/warehouse-supervisor-pe">Warehouse Supervisor - Port Elizabeth</a>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Warehouse Supervisor - Port Elizabeth');
});

test('tier A: rejects headline-shaped titles (How/Why/Top/question marks) even under a job-like href', () => {
  const html = `
    <div class="job">
      <h3><a href="/jobs/why-you-should-consider-a-career-change">Why You Should Consider a Career Change</a></h3>
    </div>`;
  assert.deepEqual(parseAgencySiteJobs(html, site), []);
});

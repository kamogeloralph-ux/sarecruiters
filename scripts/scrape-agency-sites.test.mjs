import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgencySiteJobs, extractJobDetail } from './scrape-agency-sites.mjs';

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

test('tier A: anchor-scan fallback rejects bare job-section index links (real prod pollution: "Vacancies", "Job Seekers", "Current Vacancies" scraped as jobs pointing at the listing page itself)', () => {
  const html = `
    <nav>
      <a href="/vacancies/">Vacancies</a>
      <a href="/job-seekers/">Job Seekers</a>
      <a href="/current-vacancies/">Current Vacancies</a>
      <a href="/jobs">View all Jobs</a>
    </nav>
    <a href="/vacancies/electrician-cape-town">Electrician - Cape Town, WC</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Electrician - Cape Town, WC');
});

test('tier A: card scan prefers a job-shaped href over the first anchor in the card (real prod pollution: "Engineering Leadership" scraped with a mailto: link because it was the first <a> in the card)', () => {
  const html = `
    <div class="job-item">
      <h3>Engineering Leadership</h3>
      <a href="mailto:sam@example.co.za">Email us</a>
      <a href="/jobs/engineering-leadership-role">View job</a>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].link, 'https://example.co.za/jobs/engineering-leadership-role');
});

test('tier A: rejects generic CTA text as a job title even under a job-shaped href ("Register your CV HERE", "Job Market News", "Submit CV")', () => {
  const html = `
    <div class="listing">
      <a href="/job-seekers/register-your-cv">Register your CV HERE</a>
      <a href="/job-market-news/">Job Market News</a>
      <a href="/jobs/submit-cv">Submit CV</a>
      <a href="/jobs/retail-store-manager-durban">Retail Store Manager - Durban</a>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Retail Store Manager - Durban');
});

test('tier A: rejects newer nav/CTA labels as job titles ("Positions Available", "Find your next role", "More Info", "View all categories", "Job Dashboard", "Find a job now")', () => {
  const html = `
    <div class="listing">
      <a href="/careers/">Positions Available</a>
      <a href="/jobs/">Find your next role</a>
      <a href="/jobs/12345-details">More Info</a>
      <a href="/jobs/categories">View all categories</a>
      <a href="/jobs/dashboard">Job Dashboard</a>
      <a href="/jobs/">Find a job now</a>
      <a href="/jobs/night-shift-picker-jhb">Night Shift Picker - Johannesburg</a>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Night Shift Picker - Johannesburg');
});

test('real prod pollution: card heading vs. separate CTA button -- title comes from the nearby heading, not the "View Details" button text', () => {
  const html = `
    <div class="job-card">
      <h3>Senior Bookkeeper - Sandton</h3>
      <p class="location">Gauteng</p>
      <a href="/vacancies/senior-bookkeeper-sandton">View Details</a>
    </div>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Senior Bookkeeper - Sandton');
});

test('real prod pollution: rejects a link to a different domain that is itself a WordPress theme demo site (Dynamic Labour Solutions -> wordpress-theme.spider-themes.net/jobi/job-list-1/)', () => {
  const html = `<a href="https://wordpress-theme.spider-themes.net/jobi/job-list-1/">Explore all jobs</a>
    <a href="/vacancies/warehouse-supervisor-durban">Warehouse Supervisor - Durban</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Warehouse Supervisor - Durban');
});

test('real prod pollution: rejects blog/tips articles whose URL has no recognized blog keyword but does contain "tips" (Kontak Recruitment -> /jobs-online-search-tips/, /job-market-news/)', () => {
  const html = `
    <a href="/jobs-online-search-tips/">SOCIAL MEDIA IN JOB SEARCH</a>
    <a href="/job-market-news/">READ MORE ARTICLES</a>
    <a href="/vacancies/debtors-clerk-centurion">Debtors Clerk - Centurion</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Debtors Clerk - Centurion');
});

test('real prod pollution: rejects a WP Job Manager taxonomy archive link, same path depth as a real posting (Salt Recruitment -> /job-category/south-africa/ titled "Jobs in SA")', () => {
  const html = `
    <a href="/job-category/south-africa/">Jobs in SA</a>
    <a href="/vacancies/payroll-administrator-cape-town">Payroll Administrator - Cape Town</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Payroll Administrator - Cape Town');
});

test('does NOT reject a real job whose slug happens to contain "resource" mid-word (AGC Recruitment: "Mineral Resource Manager" -> /job/mineral-resource-manager-6017596) -- a regression from broadening BLOG_PATH_RX to catch compound blog paths', () => {
  const html = `<a href="/job/mineral-resource-manager-6017596">Mineral Resource Manager</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Mineral Resource Manager');
});

test('still rejects an actual /resources/ section link', () => {
  const html = `<a href="/resources/interview-tips-for-candidates">Interview Tips For Candidates</a>
    <a href="/vacancies/site-foreman-bloemfontein">Site Foreman - Bloemfontein</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Site Foreman - Bloemfontein');
});

test('real prod pollution: rejects "Save Job" / "Bookmark Job" bookmark-button links (AGC Recruitment, Networkers International -- e.g. .../job/mineral-resource-manager-6017596/save_job)', () => {
  const html = `
    <a href="/job/mineral-resource-manager-6017596">Mineral Resource Manager</a>
    <a href="/job/mineral-resource-manager-6017596/save_job">Save Job</a>`;
  const jobs = parseAgencySiteJobs(html, site);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Mineral Resource Manager');
});

test('extractJobDetail pulls location/salary/closing date/description from a job detail page (known content-area selector present)', () => {
  const html = `
    <html><body>
      <nav>Home | Vacancies | Contact</nav>
      <article class="job-description">
        <h1>Senior Electrician</h1>
        <p>Location: Cape Town, Western Cape</p>
        <p>Salary: R35 000 - R40 000 per month</p>
        <p>Closing Date: 30 October 2026</p>
        <p>We are looking for a qualified electrician with a wireman's licence and at least 5 years experience on industrial sites.</p>
      </article>
      <footer>© 2026 Example Agency</footer>
    </body></html>`;
  const detail = extractJobDetail(html);
  assert.match(detail.location, /Cape Town/);
  assert.match(detail.salary, /R35 000/);
  assert.match(detail.closingDateRaw, /30 October 2026/);
  assert.match(detail.description, /wireman's licence/);
});

test('extractJobDetail falls back to the largest body block when no known content-area selector matches', () => {
  const html = `
    <html><body>
      <div class="header-bar">Example Agency</div>
      <div class="page-body">
        Job Title: Warehouse Supervisor. Location: Durban. Salary: R18 000 per month.
        The successful candidate will manage a team of ten warehouse staff and oversee stock control across two sites, reporting directly to the operations manager on a daily basis.
      </div>
      <div class="tiny-footer">2026</div>
    </body></html>`;
  const detail = extractJobDetail(html);
  assert.match(detail.description, /warehouse staff/);
  assert.match(detail.location, /Durban/);
});

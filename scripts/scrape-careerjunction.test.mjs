import test from 'node:test';
import assert from 'node:assert/strict';
import { agencyIdForCompany, parseCareerJunctionJobs } from './scrape-careerjunction.mjs';

// Fixture modeled on the live CareerJunction "All Jobs" listing markup: an
// <h2> title link, an <h3> company link, a location link, and plain
// salary/type/posted/ref lines, all wrapped in a repeating card container.
// The module validates credentials at import time in production; this fixture
// test is intentionally run through the exported parser only, in CI with
// dummy Supabase values.
test('parses CareerJunction job cards into vacancy records', () => {
  const html = `
    <div class="job-card">
      <a href="/companies/22742/datafin"><img src="logo.png"></a>
      <h2><a href="/systems-engineer-microsoft-365-job-2644718.aspx">Systems Engineer (Microsoft 365 / Azure)</a></h2>
      <h3><a href="/companies/22742/datafin">Datafin</a></h3>
      <div>R Undisclosed</div>
      <div>Permanent Specialist position</div>
      <a href="/jobs/cape-town">Cape Town</a>
      <div>Posted 13 Sep 2026</div>
      <div>Expires in 18 days</div>
      <div>Job 2644718 - Ref 2607416</div>
      <a href="/systems-engineer-microsoft-365-job-2644718.aspx">Show More</a>
    </div>`;
  const [job] = parseCareerJunctionJobs(html, 'https://www.careerjunction.co.za/jobs/results');
  assert.equal(job.id, 'cj-2644718');
  assert.equal(job.title, 'Systems Engineer (Microsoft 365 / Azure)');
  assert.equal(job.company, 'Datafin');
  assert.equal(job.location, 'Cape Town');
  assert.equal(job.link, 'https://www.careerjunction.co.za/systems-engineer-microsoft-365-job-2644718.aspx');
  assert.match(job.notes, /R Undisclosed/);
  assert.match(job.notes, /Permanent Specialist position/);
  assert.match(job.notes, /Posted 13 Sep 2026/);
});

test('deduplicates the title link and the duplicate "Show More" link for the same job', () => {
  const html = `
    <div class="job-card">
      <h2><a href="/driver-job-2644714.aspx">Driver</a></h2>
      <h3><a href="/companies/23095/manpower-sa-pty-ltd">Manpower SA (Pty) Ltd.</a></h3>
      <div>R Undisclosed</div>
      <div>Temporary Junior position</div>
      <a href="/jobs/gqeberha">Gqeberha</a>
      <div>Posted 13 Sep 2026</div>
      <div>Job 2644714 - Ref TCT004591</div>
      <a href="/driver-job-2644714.aspx">Show More</a>
    </div>`;
  const jobs = parseCareerJunctionJobs(html, 'https://www.careerjunction.co.za/jobs/results');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Driver');
});

test('degrades gracefully when no enclosing card can be found', () => {
  const html = `<a href="/some-role-job-9999999.aspx">Some Role</a>`;
  const [job] = parseCareerJunctionJobs(html, 'https://www.careerjunction.co.za/jobs/results');
  assert.equal(job.id, 'cj-9999999');
  assert.equal(job.title, 'Some Role');
  assert.equal(job.company, '');
  assert.equal(job.location, '');
});

test('maps confirmed CareerJunction company names to agency records', () => {
  const agencies = [
    { id: 'stratogo-id', name: 'Stratogo' },
    { id: 'obrien-id', name: "O'Brien Recruitment" },
    { id: 'ultra-id', name: 'Ultra Personnel CC' },
    { id: 'fusion-id', name: 'Fusion Recruitment' },
    { id: 'sabenza-id', name: 'Sabenza IT Recruitment' },
  ];
  assert.equal(agencyIdForCompany('Stratogo', agencies), 'stratogo-id');
  assert.equal(agencyIdForCompany("O'Brien Recruitment", agencies), 'obrien-id');
  assert.equal(agencyIdForCompany('Ultra Personnel cc', agencies), 'ultra-id');
  assert.equal(agencyIdForCompany('Fusion Personnel', agencies), 'fusion-id');
  assert.equal(agencyIdForCompany('DCV Sabenza IT and Recruitment', agencies), 'sabenza-id');
  assert.equal(agencyIdForCompany('Unknown Company', agencies), 'general');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { agencyIdForCompany, parseJobMailJobs } from './scrape-jobmail.mjs';

test('parses Job Mail result cards into vacancy records', () => {
  const html = `
    <div class="results-item tablinks" id="results-item-7579680">
      <div class="job-posted">15 September 2026</div>
      <a id="jobDetailUrl-7579680" href="/jobs/finance/bookkeeping/gauteng/senior-bookkeeper-id-7579680"><h3>Senior Bookkeeper</h3></a>
      <div class="job-location">Pretoria</div>
      <div class="resault-company-name"><span class="company">Goldstone Jewellers</span></div>
    </div>`;
  const [job] = parseJobMailJobs(html, 'https://www.jobmail.co.za/jobs');
  assert.equal(job.id, 'jobmail-7579680');
  assert.equal(job.title, 'Senior Bookkeeper');
  assert.equal(job.company, 'Goldstone Jewellers');
  assert.equal(job.location, 'Pretoria');
  assert.equal(job.link, 'https://www.jobmail.co.za/jobs/finance/bookkeeping/gauteng/senior-bookkeeper-id-7579680');
  assert.match(job.notes, /15 September 2026/);
});

test('deduplicates repeated cards and handles relative links', () => {
  const html = `
    <div class="results-item" id="results-item-123"><a id="jobDetailUrl-123" href="/jobs/a-role-id-123"><h3>A role</h3></a><div class="job-location">Cape Town</div><span class="company">Example</span></div>
    <div class="results-item" id="results-item-123"><a id="jobDetailUrl-123" href="/jobs/a-role-id-123"><h3>A role</h3></a></div>`;
  const jobs = parseJobMailJobs(html);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].link, 'https://www.jobmail.co.za/jobs/a-role-id-123');
});

test('strips a "Recruiter"/"Employer" source label that Job Mail now prefixes to the company name', () => {
  const html = `
    <div class="results-item" id="results-item-7581556">
      <div class="job-posted">17 September 2026</div>
      <a id="jobDetailUrl-7581556" href="/jobs/logistics/procurement/gauteng/qualified-supply-chain-manager-id-7581556"><h3>Qualified Supply Chain Manager</h3></a>
      <div class="job-location">Gauteng</div>
      <div class="resault-company-name"><span class="company">Recruiter CITLAND INTERNATIONAL SA (PTY) LTD</span></div>
    </div>
    <div class="results-item" id="results-item-7579680">
      <div class="job-posted">15 September 2026</div>
      <a id="jobDetailUrl-7579680" href="/jobs/retail/sales-assistant/pretoria/jewellery-sales-assistant-urgently-needed-id-7579680"><h3>Jewellery Sales Assistant</h3></a>
      <div class="job-location">Pretoria</div>
      <div class="resault-company-name"><span class="company">Employer Goldstone Jewellers</span></div>
    </div>`;
  const [recruiterJob, employerJob] = parseJobMailJobs(html, 'https://www.jobmail.co.za/jobs');
  assert.equal(recruiterJob.company, 'CITLAND INTERNATIONAL SA (PTY) LTD');
  assert.equal(employerJob.company, 'Goldstone Jewellers');
});

test('falls back to scanning the card text when .company matches nothing at all', () => {
  const html = `
    <div class="results-item" id="results-item-7580606">
      <div class="job-posted">16 September 2026</div>
      <a id="jobDetailUrl-7580606" href="/jobs/finance-accounting/creditor-debtor/gauteng/debtors-administrator-id-7580606"><h3>DEBTORS ADMINISTRATOR</h3></a>
      <div class="job-location">Gauteng</div>
      <div class="job-source-tag">Employer Rubtrans Logistics</div>
    </div>`;
  const [job] = parseJobMailJobs(html, 'https://www.jobmail.co.za/jobs');
  assert.equal(job.company, 'Rubtrans Logistics');
});

test('maps known Job Mail employers to agency records and defaults safely', () => {
  const agencies = [{ id: 'fusion-id', name: 'Fusion Recruitment' }];
  assert.equal(agencyIdForCompany('Fusion Recruitment', agencies), 'fusion-id');
  assert.equal(agencyIdForCompany('Unknown Company', agencies), 'general');
});

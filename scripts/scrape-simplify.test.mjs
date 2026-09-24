import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSimplifyJobs } from './scrape-simplify.mjs';

const now = new Date('2026-09-24T12:00:00.000Z');

function card({ href, title, company, type, location, industry, posted, closing, description }) {
  return `
    <div class="row job-heading-row">
      <div class="col-md-8"><h2 class="text-wrapper" title="${title}"><a class="job-title" href="${href}">${title}</a></h2></div>
      <div class="col-md-4 job-type-location">
        <span class="job-type text-wrapper">${type}</span>
        <span class="job-location text-wrapper">${location}</span>
      </div>
    </div>
    <div class="row">
      <div class="col-md-2 job-thumbnail"><img class="img-thumbnail-company" alt="${company}" src="/logo.png"></div>
      <div class="col-md-7 margin-top-5">
        <p>${description}</p>
        <div class="row font-size-11"><span>Company Primary Industry: ${industry}</span></div>
        <div class="row font-size-11"><span>Posted Date:</span> ${posted}</div>
        <div class="row font-size-11"><span>Closing Date: </span><b>${closing}</b></div>
      </div>
    </div>`;
}

test('parses a fresh vacancy and preserves its company subdomain', () => {
  const html = card({
    href: 'https://retail.simplify.hr/vacancy/abc123',
    title: 'Cashier - Fourways Mall',
    company: 'Dis-Chem Pharmacies Limited',
    type: 'Permanent',
    location: 'Johannesburg, Gauteng',
    industry: 'Retail',
    posted: '3 hours ago',
    closing: '29 September 2026',
    description: 'Provide excellent customer service and process transactions.',
  });
  const jobs = parseSimplifyJobs(html, 'https://jobs.simplify.hr?Page=1&size=100', now);
  assert.equal(jobs.rawListingCount, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'simplify-retail.simplify.hr-abc123');
  assert.equal(jobs[0].title, 'Cashier - Fourways Mall');
  assert.equal(jobs[0].company, 'Dis-Chem Pharmacies Limited');
  assert.equal(jobs[0].location, 'Johannesburg, Gauteng');
  assert.equal(jobs[0].closing_date, '29 September 2026');
  assert.equal(jobs[0].employment_type, 'Full time');
  assert.equal(jobs[0].agency_id, 'general');
  assert.equal(jobs[0].source_type, 'simplify');
  assert.equal(jobs[0].link, 'https://retail.simplify.hr/vacancy/abc123');
  assert.match(jobs[0].notes, /Simplify Jobs company subdomain: retail\.simplify\.hr/);
});

test('skips a closed vacancy but retains the raw page count', () => {
  const html = card({
    href: 'https://oldcompany.simplify.hr/vacancy/closed1',
    title: 'Closed Role',
    company: 'Old Company',
    type: 'Permanent',
    location: 'Cape Town, Western Cape',
    industry: 'Services',
    posted: '2 days ago',
    closing: '01 September 2026',
    description: 'This role is no longer open.',
  });
  const jobs = parseSimplifyJobs(html, 'https://jobs.simplify.hr', now);
  assert.equal(jobs.rawListingCount, 1);
  assert.equal(jobs.length, 0);
});

test('deduplicates repeated links and rejects non-Simplify vacancy links', () => {
  const one = card({
    href: 'https://homechoice.simplify.hr/vacancy/xyz789',
    title: 'Store Assistant',
    company: 'homechoice',
    type: 'Part-time',
    location: 'Durban, KwaZulu-Natal',
    industry: 'Retail',
    posted: 'today',
    closing: '30 September 2026',
    description: 'Support customers in store.',
  });
  const external = one.replace('https://homechoice.simplify.hr/vacancy/xyz789', 'https://example.com/vacancy/other');
  const jobs = parseSimplifyJobs(one + external, 'https://jobs.simplify.hr', now);
  assert.equal(jobs.rawListingCount, 2);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'homechoice');
});

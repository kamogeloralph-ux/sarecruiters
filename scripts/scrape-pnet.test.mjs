import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePnetJobs } from './scrape-pnet.mjs';

// The module validates credentials at import time in production; this fixture test
// is intentionally run through the exported parser only in CI with dummy values.
test('parses Pnet article cards into vacancy records', () => {
  const html = `
    <article id="job-item-4256616">
      <a href="/jobs--Senior-Legal-Advisor-Johannesburg-Michael-Page--4256616-inline.html">Senior Legal Advisor</a>
      <div>Michael Page</div><div>Johannesburg</div>
      <p>Managing complex legal matters.</p><span>more</span><span>1 week ago</span>
    </article>`;
  const [job] = parsePnetJobs(html, 'https://www.pnet.co.za/cmp/en/michael-page-11243/jobs');
  assert.equal(job.id, 'pnet-4256616');
  assert.equal(job.title, 'Senior Legal Advisor');
  assert.equal(job.company, 'Michael Page');
  assert.equal(job.location, 'Johannesburg');
  assert.equal(job.link, 'https://www.pnet.co.za/jobs--Senior-Legal-Advisor-Johannesburg-Michael-Page--4256616-inline.html');
  assert.match(job.notes, /Managing complex legal matters/);
});

test('parses general Pnet postings without requiring an agency page URL', () => {
  const html = `
    <article id="job-item-4260001">
      <a href="/jobs--Accountant-Stellenbosch-Example-Company--4260001-inline.html">Accountant</a>
      <div>Example Company</div><div>Stellenbosch</div>
      <p>General vacancy description.</p>
    </article>`;
  const [job] = parsePnetJobs(html, 'https://www.pnet.co.za/jobs');
  assert.equal(job.id, 'pnet-4260001');
  assert.equal(job.company, 'Example Company');
  assert.equal(job.location, 'Stellenbosch');
  assert.equal(job.link, 'https://www.pnet.co.za/jobs--Accountant-Stellenbosch-Example-Company--4260001-inline.html');
});

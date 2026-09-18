import test from 'node:test';
import assert from 'node:assert/strict';
import { companyFromTitle, parseGraduates24Jobs } from './scrape-graduates24.mjs';

test('parses a Graduates24 listing card with a closing date', () => {
  const html = `
    <div class="card">
      <a href="/hollard-learnership-programme-2026"><img src="/logo.png" alt=""></a>
      <h2>Hollard: Learnership Programme 2026</h2>
      <p>Posted: 12 Sep 2026  Johannesburg, South Africa  Closes: 18 Sep 2026</p>
      <p>An exciting new opportunity has become available in our IT Division Area. We are looking to recruit an IT Learner.</p>
      <a href="/hollard-learnership-programme-2026">Read More</a>
    </div>`;
  const [job] = parseGraduates24Jobs(html, 'https://www.graduates24.com/learnerships');
  assert.equal(job.id, 'graduates24-hollard-learnership-programme-2026');
  assert.equal(job.title, 'Hollard: Learnership Programme 2026');
  assert.equal(job.company, 'Hollard');
  assert.equal(job.location, 'Johannesburg, South Africa');
  assert.equal(job.closing_date, '18 Sep 2026');
  assert.equal(job.link, 'https://www.graduates24.com/hollard-learnership-programme-2026');
  assert.match(job.notes, /Posted 12 Sep 2026/);
  assert.match(job.notes, /IT Learner/);
  // 'learnerships' is a dedicated source type so every posting lands in its
  // own Learnerships card, and agency_id stays 'general' (not matched to an
  // individual agency) so the card displays the scraped company name.
  assert.equal(job.source_type, 'learnerships');
  assert.equal(job.agency_id, 'general');
});

test('handles listings with no closing date shown', () => {
  const html = `
    <div class="card">
      <a href="/maziv-group-learnership-programme-2026-2027"><img src="/logo.png" alt=""></a>
      <h2>MAZIV Group: Learnership Programme 2026 / 2027</h2>
      <p>Posted: 11 Sep 2026  Gauteng, South Africa</p>
      <p>The MAZIV Group stands at the forefront of South Africa's digital transformation.</p>
      <a href="/maziv-group-learnership-programme-2026-2027">Read More</a>
    </div>`;
  const [job] = parseGraduates24Jobs(html, 'https://www.graduates24.com/learnerships');
  assert.equal(job.location, 'Gauteng, South Africa');
  assert.equal(job.closing_date, '');
  assert.equal(job.company, 'MAZIV Group');
});

test('strips a trailing "New" badge from the title', () => {
  const html = `
    <div class="card">
      <a href="/dis-chem-dispensary-support-learnerships-2026-2027"><img src="/logo.png" alt=""></a>
      <h2>Dis-Chem: Dispensary Support Learnerships 2026 / 2027 New</h2>
      <p>Posted: 17 Sep 2026  South Africa  Closes: 21 Sep 2026</p>
      <p>Dis-Chem Pharmacies has opportunities available for Dispensary Support Learners to join the team.</p>
      <a href="/dis-chem-dispensary-support-learnerships-2026-2027">Read More</a>
    </div>`;
  const [job] = parseGraduates24Jobs(html, 'https://www.graduates24.com/learnerships');
  assert.equal(job.title, 'Dis-Chem: Dispensary Support Learnerships 2026 / 2027');
  assert.equal(job.company, 'Dis-Chem');
});

test('deduplicates a card that has two links to the same slug', () => {
  const html = `
    <div class="card">
      <a href="/some-role"><img src="/logo.png" alt=""></a>
      <h2>Some Role</h2>
      <p>Posted: 01 Sep 2026  Durban, South Africa</p>
      <p>Description text here.</p>
      <a href="/some-role">Read More</a>
    </div>`;
  const jobs = parseGraduates24Jobs(html, 'https://www.graduates24.com/learnerships');
  assert.equal(jobs.length, 1);
});

test('titles without a "Company: Title" pattern have no attributed company', () => {
  assert.equal(companyFromTitle('SA Government Internships 2026 / 2027'), '');
  assert.equal(companyFromTitle('Hollard: Learnership Programme 2026'), 'Hollard');
});

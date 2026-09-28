import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListing, parseJobDetail, SOURCES } from './scrape-careers-page.mjs';

const listing = `<!doctype html><a href="/crew-life-at-sea/job/ABC123">IT Support Specialist</a><a href="/crew-life-at-sea/job/ABC123/apply">Apply</a><a href="/other/job/NOPE">Nope</a>`;
const detail = `<!doctype html><h1>IT Support Specialist</h1><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'JobPosting', title: 'IT Support Specialist',
  description: '<p>Provide technical support.</p><p>Qualifications: experience.</p>',
  hiringOrganization: { '@type': 'Organization', name: 'Crew Life at Sea' },
  jobLocation: { address: { addressLocality: 'Cape Town', addressCountry: 'South Africa' } },
  validThrough: '2027-09-21T00:00:00+00:00', employmentType: 'FULL_TIME'
})}</script>`;

test('extracts only stable public job detail links', () => {
  const rows = parseListing(listing, SOURCES.crew);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link, 'https://careers-page.com/crew-life-at-sea/job/ABC123');
});

test('parses public JobPosting detail data into a vacancy row', () => {
  const summary = { link: 'https://careers-page.com/crew-life-at-sea/job/ABC123', listingTitle: 'IT Support Specialist' };
  const row = parseJobDetail(detail, summary, SOURCES.crew);
  assert.equal(row.source_type, 'careers_page');
  assert.equal(row.company, 'Crew Life at Sea');
  assert.equal(row.location, 'Cape Town, South Africa');
  assert.match(row.notes, /Provide technical support/);
  assert.match(row.id, /^careers-page-crew-life-at-sea-/);
});

test('extracts Waitred jobs from its public site into Careers-Page detail links', () => {
  const waitredListing = '<a href="https://www.careers-page.com/waitred-recruitment/job/L67VR77R">Executive Chef</a><a href="https://www.careers-page.com/waitred-recruitment/job/L67VR77R/apply">Apply</a>';
  const rows = parseListing(waitredListing, SOURCES.waitred);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link, 'https://www.careers-page.com/waitred-recruitment/job/L67VR77R');
});

test('uses Waitred published defaults when detail metadata omits summary fields', () => {
  const summary = { link: 'https://www.careers-page.com/waitred-recruitment/job/L67VR77R', listingTitle: 'Executive Chef' };
  const row = parseJobDetail('<h1>Executive Chef</h1><div class="redactor-styles">Cruise role.</div>', summary, SOURCES.waitred);
  assert.equal(row.location, 'Cape Town, South Africa');
  assert.equal(row.employment_type, 'Contract');
  assert.equal(row.company, "Waitre d' Recruitment");
});

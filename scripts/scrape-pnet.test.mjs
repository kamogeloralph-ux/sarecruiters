import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePnetJobDetail } from './scrape-pnet.mjs';

const agency = { id: 'agency-123', name: 'Fempower Personnel Pty Ltd', photo: null };

function jsonLdPage(posting) {
  return `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body></body></html>`;
}

test('parses a Pnet JobPosting JSON-LD block into a vacancy row', () => {
  const posting = {
    '@type': 'JobPosting',
    title: 'Warehouse Supervisor',
    description: '<p>Manage stock and staff.</p>',
    employmentType: 'FULL_TIME',
    validThrough: '2026-10-01T00:00:00Z',
    jobLocation: { address: { addressLocality: 'Durban' } },
  };
  const job = parsePnetJobDetail(jsonLdPage(posting), { id: '4261314', link: 'https://www.pnet.co.za/jobs--Warehouse-Supervisor-Durban-Fempower--4261314-inline.html', agency });
  assert.equal(job.id, 'pnet-4261314');
  assert.equal(job.agency_id, 'agency-123');
  assert.equal(job.company, 'Fempower Personnel Pty Ltd');
  assert.equal(job.title, 'Warehouse Supervisor');
  assert.equal(job.location, 'Durban');
  assert.equal(job.employment_type, 'Full time');
  assert.equal(job.closing_date, '2026-10-01');
  assert.equal(job.notes, 'Manage stock and staff.');
  assert.equal(job.source_type, 'pnet');
});

test('falls back to an <h1> title when no JobPosting JSON-LD is present', () => {
  const html = '<html><body><h1>Debtors Clerk</h1></body></html>';
  const job = parsePnetJobDetail(html, { id: '999', link: 'https://www.pnet.co.za/jobs--Debtors-Clerk--999-inline.html', agency });
  assert.equal(job.title, 'Debtors Clerk');
  assert.equal(job.employment_type, '');
});

test('returns null when no title can be found at all', () => {
  const job = parsePnetJobDetail('<html><body></body></html>', { id: '1', link: 'https://www.pnet.co.za/x', agency });
  assert.equal(job, null);
});

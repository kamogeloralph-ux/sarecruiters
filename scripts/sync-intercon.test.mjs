import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInterconIndex, parseInterconDetail } from './sync-intercon.mjs';

const index = `<a href="https://www.interconrecruitment.co.za/jobs-2/example-role">View Job</a><a href="/jobs-2/example-role">Duplicate</a><a href="/jobs-2/">Index</a><a href="https://evil.example/jobs-2/fake">External</a>`;
const detail = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Example &amp; Role',
  description: 'A useful description.&#010;Second line.', MinimumRequirements: 'Grade 12',
  'Salary & Benefits': 'R10,000 monthly', 'To Apply': 'Email your CV to cvkznsales@interconrecruitment.co.za.',
  employmentType: 'FULL_TIME', datePosted: '2026-09-15 ', validThrough: '2026-11-15 ',
  jobLocation: { address: { addressLocality: 'Durban', addressRegion: 'KwaZulu-Natal' } },
})}</script><a href="mailto:cvkznsales@interconrecruitment.co.za">Apply Now</a>`;

test('finds unique same-site Intercon vacancy pages', () => {
  assert.deepEqual(parseInterconIndex(index), ['https://www.interconrecruitment.co.za/jobs-2/example-role']);
});

test('maps Intercon JobPosting JSON-LD to a direct detail-page application record', () => {
  const row = parseInterconDetail(detail, 'https://www.interconrecruitment.co.za/jobs-2/example-role', new Date('2026-09-25T00:00:00Z'));
  assert.equal(row.title, 'Example & Role');
  assert.equal(row.location, 'Durban, KwaZulu-Natal');
  assert.equal(row.employment_type, 'FULL TIME');
  assert.equal(row.start_date, '2026-09-15');
  assert.equal(row.closing_date, '2026-11-15');
  assert.equal(row.email, 'cvkznsales@interconrecruitment.co.za');
  assert.match(row.notes, /Second line/);
  assert.match(row.id, /^agency-[a-f0-9]{20}$/);
});

test('skips expired Intercon postings', () => {
  assert.equal(parseInterconDetail(detail.replace('2026-11-15', '2026-09-01'), 'https://www.interconrecruitment.co.za/jobs-2/example-role', new Date('2026-09-25T00:00:00Z')), null);
});

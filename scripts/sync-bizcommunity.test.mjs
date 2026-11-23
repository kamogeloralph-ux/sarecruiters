import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBizcommunityItems } from './sync-bizcommunity.mjs';

const item = ({ id = '123', title = 'Client Success Manager (Johannesburg)', pubDate = 'Fri, 20 Nov 2026 08:00:00 GMT', description = '<p>Posted by: Ornico<br>Province: Gauteng<br>City: Johannesburg<br>Type: Permanent<br>Education level: Degree<br>Transport/travel requirements: None<br>Great role.</p>' } = {}) => `
<item><title>${title}</title><link>https://www.bizcommunity.com/job/${id}</link><description><![CDATA[${description}]]></description><pubDate>${pubDate}</pubDate><guid>https://www.bizcommunity.com/job/${id}</guid></item>`;

test('maps company, province, city, notes, and stable source fields', () => {
  const xml = `<rss><channel>${item()}</channel></rss>`;
  const [job] = mapBizcommunityItems(xml, new Date('2026-11-21T00:00:00Z'));
  const [sameJob] = mapBizcommunityItems(xml, new Date('2026-11-21T00:00:00Z'));
  assert.match(job.id, /^bizcommunity-[a-f0-9]{20}$/);
  assert.equal(job.id, sameJob.id);
  assert.equal(job.title, 'Client Success Manager (Johannesburg)');
  assert.equal(job.company, 'Ornico');
  assert.equal(job.location, 'Johannesburg, Gauteng');
  assert.equal(job.link, 'https://www.bizcommunity.com/job/123');
  assert.equal(job.source_type, 'bizcommunity');
  assert.match(job.notes, /Employment: Permanent/);
  assert.match(job.notes, /Education: Degree/);
  assert.match(job.notes, /Posted Fri, 20 Nov 2026/);
});

test('skips malformed records and duplicate GUID/link records', () => {
  const xml = `<rss><channel>${item()}${item()}<item><title>Missing link</title><description>Posted by: No link</description></item></channel></rss>`;
  assert.equal(mapBizcommunityItems(xml, new Date('2026-11-21T00:00:00Z')).length, 1);
});

test('skips stale feed items', () => {
  const jobs = mapBizcommunityItems(`<rss><channel>${item({ pubDate: 'Fri, 01 Jan 2026 08:00:00 GMT' })}</channel></rss>`, new Date('2026-11-21T00:00:00Z'));
  assert.equal(jobs.length, 0);
});

test('stops at the standardized 500-item cap', () => {
  const xml = `<rss><channel>${Array.from({ length: 550 }, (_, i) => item({ id: String(i + 1), title: `Role ${i + 1}` })).join('')}</channel></rss>`;
  assert.equal(mapBizcommunityItems(xml, new Date('2026-11-21T00:00:00Z')).length, 500);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndeedFeed } from './sync-indeed.mjs';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>Senior Developer</title>
    <link>https://za.indeed.com/viewjob?jk=abc</link>
    <pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate>
    <source url="https://example.com">Example Software</source>
    <description><![CDATA[<p>Location: Cape Town, Western Cape</p><p>Build great products.</p>]]></description>
  </item>
  <item>
    <title>Senior Developer duplicate</title>
    <link>https://za.indeed.com/viewjob?jk=abc</link>
    <pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Old Developer</title>
    <link>https://za.indeed.com/viewjob?jk=old</link>
    <pubDate>Fri, 01 Jan 2020 08:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

test('Indeed RSS maps fresh listings into the shared vacancy shape', () => {
  const jobs = parseIndeedFeed(RSS, new Date('2026-10-10T00:00:00Z'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Senior Developer');
  assert.equal(jobs[0].company, 'Example Software');
  assert.equal(jobs[0].location, 'Cape Town, Western Cape');
  assert.equal(jobs[0].source_type, 'indeed');
  assert.equal(jobs[0].agency_id, 'general');
  assert.match(jobs[0].notes, /Build great products/);
  assert.match(jobs[0].id, /^indeed-/);
});

test('Indeed RSS deduplicates links and excludes old listings', () => {
  const jobs = parseIndeedFeed(RSS, new Date('2026-10-10T00:00:00Z'));
  assert.deepEqual(jobs.map((job) => job.link), ['https://za.indeed.com/viewjob?jk=abc']);
});

test('Indeed RSS accepts Atom-style entries', () => {
  const atom = `<feed><entry><title>Analyst</title><link href="https://za.indeed.com/viewjob?jk=atom"/><published>2026-10-09T08:00:00Z</published><summary>Location: Johannesburg, Gauteng</summary></entry></feed>`;
  const jobs = parseIndeedFeed(atom, new Date('2026-10-10T00:00:00Z'));
  assert.equal(jobs[0].title, 'Analyst');
  assert.equal(jobs[0].link, 'https://za.indeed.com/viewjob?jk=atom');
  assert.equal(jobs[0].location, 'Johannesburg, Gauteng');
});

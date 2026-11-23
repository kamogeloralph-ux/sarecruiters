import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGreenhouseJobs, mergeGreenhouseJobs } from './sync-takealot.mjs';

const job = (overrides = {}) => ({
  id: 12345,
  absolute_url: 'https://job-boards.greenhouse.io/takealotcom/jobs/12345',
  title: 'Warehouse Operations Manager',
  company_name: 'takealot.com',
  location: { name: 'Cape Town' },
  first_published: '2026-11-20T08:00:00-05:00',
  updated_at: '2026-11-20T08:00:00-05:00',
  application_deadline: null,
  content: '&lt;p&gt;Lead &lt;strong&gt;warehouse operations&lt;/strong&gt;.&lt;/p&gt;',
  departments: [{ name: 'Operations' }],
  ...overrides,
});

test('maps Greenhouse Takealot jobs into the shared vacancy shape', () => {
  const [mapped] = mapGreenhouseJobs({ jobs: [job()] }, 'takealotcom', new Date('2026-11-23T00:00:00Z'));
  assert.equal(mapped.id, 'takealot-takealotcom-12345');
  assert.equal(mapped.title, 'Warehouse Operations Manager');
  assert.equal(mapped.company, 'takealot.com');
  assert.equal(mapped.location, 'Cape Town');
  assert.equal(mapped.source_type, 'takealot');
  assert.match(mapped.notes, /Lead warehouse operations/);
  assert.match(mapped.notes, /Department: Operations/);
  assert.equal(mapped.link, 'https://job-boards.greenhouse.io/takealotcom/jobs/12345');
});

test('deduplicates overlapping Greenhouse board links', () => {
  const duplicate = job({ company_name: 'Takealot Group' });
  const merged = mergeGreenhouseJobs([
    { board: 'takealotcom', payload: { jobs: [job()] } },
    { board: 'takealotgroup', payload: { jobs: [duplicate, { ...job(), id: 67890, absolute_url: 'https://job-boards.greenhouse.io/takealotgroup/jobs/67890', title: 'Product Analyst' }] } },
  ], new Date('2026-11-23T00:00:00Z'));
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((item) => item.link)).size, 2);
});

test('skips malformed Greenhouse jobs', () => {
  assert.deepEqual(mapGreenhouseJobs({ jobs: [{ title: 'Missing ID' }, { id: 2, absolute_url: '', title: 'Missing link' }] }, 'takealotcom'), []);
});

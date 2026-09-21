import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchPage, parseDetail, buildVacancy, htmlToText, cleanLocation, toDateOnly, publicJobUrl, idForJob, SOURCES, selectSources, formatError } from './sync-oracle.mjs';

const MRP = SOURCES.mrprice;
const TFG = SOURCES.tfg;

const searchPayload = {
  items: [{
    TotalJobsCount: 2,
    requisitionList: [
      { Id: '30001', Title: 'Sales Associate', PostedDate: '2026-09-15', PrimaryLocation: 'Cape Town, Western Cape, South Africa', PrimaryLocationCountry: 'ZA', JobFamily: 'Retail', WorkplaceType: 'On-site', ShortDescriptionStr: 'Sell fashion.' },
      { Id: '30002', Title: 'Store Manager', PostedDate: '2026-09-10T00:00:00+00:00', PrimaryLocation: 'Windhoek, Namibia', PrimaryLocationCountry: 'NA' },
    ],
  }],
};

test('parses the nested requisition list and drops non-South-African jobs', () => {
  const page = parseSearchPage(searchPayload);
  assert.equal(page.total, 2);
  assert.equal(page.rawCount, 2);
  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0].reqId, '30001');
  assert.equal(page.jobs[0].location, 'Cape Town, Western Cape');
  assert.equal(page.jobs[0].postedDate, '2026-09-15');
});

test('returns nothing for malformed responses', () => {
  assert.deepEqual(parseSearchPage(null).jobs, []);
  assert.deepEqual(parseSearchPage({ items: [] }).jobs, []);
  assert.equal(parseDetail({}), null);
  assert.equal(buildVacancy(MRP, null, null, null), null);
});

test('builds a retail vacancy linked to the employer and Mr Price apply page', () => {
  const summary = parseSearchPage(searchPayload).jobs[0];
  const detail = parseDetail({ items: [{
    ExternalDescriptionStr: '<p>Help customers &amp; keep the floor tidy.</p><ul><li>Friendly</li></ul>',
    ExternalResponsibilitiesStr: '<p>Merchandising</p>',
    ExternalQualificationsStr: '<p>Matric</p>',
    ExternalPostedEndDate: '2026-10-05T00:00:00+00:00',
    PrimaryLocation: 'Cape Town, Western Cape, South Africa',
    JobSchedule: 'Full time',
  }] });
  const job = buildVacancy(MRP, summary, detail, 'emp-mrp', new Date('2026-09-21T00:00:00Z'));
  assert.equal(job.id, 'retail-mrprice-30001');
  assert.equal(job.source_type, 'retail');
  assert.equal(job.company, 'Mr Price Group');
  assert.equal(job.employer_id, 'emp-mrp');
  assert.equal(job.agency_id, 'employer');
  assert.equal(job.closing_date, '2026-10-05');
  assert.equal(job.employment_type, 'Full time');
  assert.equal(job.link, 'https://fa-etyi-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/30001');
  assert.match(job.notes, /Help customers & keep the floor tidy\./);
  assert.match(job.notes, /• Friendly/);
  assert.match(job.notes, /Qualifications\nMatric/);
  assert.equal(job.remote, false); // 'On-site' workplace type
});

test('still produces a listing from search data when the detail call failed', () => {
  const summary = parseSearchPage(searchPayload).jobs[0];
  const job = buildVacancy(MRP, summary, null, null);
  assert.equal(job.agency_id, 'general');
  assert.equal(job.employer_id, null);
  assert.equal(job.notes, 'Sell fashion.');
  assert.equal(job.location, 'Cape Town, Western Cape');
});

test('small helpers behave', () => {
  assert.equal(cleanLocation('Durban, KwaZulu-Natal, South Africa'), 'Durban, KwaZulu-Natal');
  assert.equal(toDateOnly('2026-09-30T00:00:00+00:00'), '2026-09-30');
  assert.equal(toDateOnly(null), '');
  assert.equal(htmlToText('<p>a&nbsp;b</p><p>c</p>'), 'a b\nc');
  assert.equal(idForJob(MRP, '9'), 'retail-mrprice-9');
  assert.ok(publicJobUrl(MRP, '9').endsWith('/sites/CX_1001/job/9'));
});

test('TFG source builds its own ids, company and apply link', () => {
  const summary = parseSearchPage({ items: [{ TotalJobsCount: 1, requisitionList: [
    { Id: '55501', Title: 'Store Manager (45hr) - Foschini Jubilee Mall', PostedDate: '2026-09-18', PrimaryLocation: 'Gauteng, South Africa', PrimaryLocationCountry: 'ZA' },
  ] }] }).jobs[0];
  const job = buildVacancy(TFG, summary, null, 'emp-tfg', new Date('2026-09-21T00:00:00Z'));
  assert.equal(job.id, 'retail-tfg-55501');
  assert.equal(job.company, 'TFG');
  assert.equal(job.source_type, 'retail');
  assert.equal(job.employer_id, 'emp-tfg');
  assert.equal(job.link, 'https://fa-expc-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/55501');
});

test('source id prefixes are unique so cleanup never crosses employers', () => {
  const prefixes = Object.values(SOURCES).map((s) => s.idPrefix);
  assert.equal(new Set(prefixes).size, prefixes.length);
  prefixes.forEach((p, i) => prefixes.forEach((q, j) => { if (i !== j) assert.ok(!q.startsWith(p)); }));
});

test('selectSources filters by key and rejects unknown names', () => {
  assert.equal(selectSources('').length, Object.keys(SOURCES).length);
  assert.deepEqual(selectSources('tfg').map((s) => s.key), ['tfg']);
  assert.throws(() => selectSources('nope'), /Unknown ORACLE_ONLY/);
});

test('formatError makes Supabase error objects readable', () => {
  assert.equal(formatError({ message: 'bad', details: 'col x', code: '23502' }), 'bad | col x | code 23502');
  assert.equal(formatError(new Error('boom')), 'boom');
  assert.equal(formatError('plain'), 'plain');
});

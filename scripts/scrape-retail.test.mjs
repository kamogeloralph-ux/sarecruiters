import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePickNPaySearch, parsePickNPayDetail, parseBoxerCategoryLinks, parseBoxerSearch, parseBoxerDetail } from './scrape-retail.mjs';

test('parses Pick n Pay Workday search results into retail summaries', () => {
  const jobs = parsePickNPaySearch({ total: 1, jobPostings: [{ title: 'Cashier', locationsText: 'Cape Town - Western Cape', externalPath: '/job/Cape-Town/Cashier_JR123' }] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Cashier');
  assert.equal(jobs[0].location, 'Cape Town - Western Cape');
  assert.equal(jobs[0].link, 'https://picknpay.wd3.myworkdayjobs.com/PNP_Careers/job/Cape-Town/Cashier_JR123');
});

test('normalizes Pick n Pay detail data as a retail vacancy', () => {
  const job = parsePickNPayDetail({ jobPostingInfo: {
    title: 'Shelfpacker', jobReqId: 'JR123', location: 'Durban - KwaZulu-Natal',
    jobDescription: '<p>Keep shelves stocked.</p>', timeType: 'Full time', startDate: '2026-09-15',
  } }, { link: 'https://picknpay.wd3.myworkdayjobs.com/PNP_Careers/job/Durban/Shelfpacker_JR123', externalPath: '/job/Durban/Shelfpacker_JR123', location: 'Durban - KwaZulu-Natal' });
  assert.equal(job.id, 'retail-pnp-JR123');
  assert.equal(job.company, 'Pick n Pay');
  assert.equal(job.source_type, 'retail');
  assert.equal(job.remote, null);
  assert.equal(job.notes, 'Keep shelves stocked.');
  assert.equal(job.location, 'Durban - KwaZulu-Natal');
});

test('returns no jobs for malformed retailer responses', () => {
  assert.deepEqual(parsePickNPaySearch(null), []);
  assert.equal(parsePickNPayDetail({}, { link: 'https://example.com/job' }), null);
});

test('parses Boxer eRecruit category links and job rows', () => {
  const categories = parseBoxerCategoryLinks('<a href="/candidateapp/Jobs/Categories/Stores/abc">Stores</a><a href="/candidateapp/Jobs/Categories/Stores/abc">Stores</a>');
  assert.deepEqual(categories, ['https://boxer.erecruit.co/candidateapp/Jobs/Categories/Stores/abc']);
  const jobs = parseBoxerSearch('<table><tr class="item" onclick="window.location=\'/candidateapp/Jobs/View/BOX260910-1\';"><td>HOD: Logistics</td><td>Westville</td><td>2026/09/28</td></tr></table>');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, 'BOX260910-1');
  assert.equal(jobs[0].link, 'https://boxer.erecruit.co/candidateapp/Jobs/View/BOX260910-1');
});

test('normalizes Boxer JSON-LD detail data as a retail vacancy', () => {
  const html = '<script type="application/ld+json">{"@type":"JobPosting","title":"HOD: Logistics","description":"<p>Lead logistics.</p>","validThrough":"2026-09-28","identifier":{"value":"BOX260910-1"},"jobLocation":{"address":{"addressLocality":"Westville","addressRegion":"KwaZulu-Natal"}}}</script>';
  const job = parseBoxerDetail(html, { externalId: 'BOX260910-1', link: 'https://boxer.erecruit.co/candidateapp/Jobs/View/BOX260910-1', location: 'Westville', closingDate: '' });
  assert.equal(job.id, 'retail-boxer-BOX260910-1');
  assert.equal(job.company, 'Boxer Superstores');
  assert.equal(job.location, 'Westville, KwaZulu-Natal');
  assert.equal(job.closing_date, '2026-09-28');
  assert.equal(job.notes, 'Lead logistics.');
});

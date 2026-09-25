import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const start = worker.indexOf('const WHATSAPP_SITE_URL');
const end = worker.indexOf('async function serviceJson', start);
const sandbox = { Math, Date, Map, Set, String, Number, JSON, __name() {} };
vm.runInNewContext(`${worker.slice(start, end)}\nglobalThis.api = { waExpired, waPublicUrls, whatsappPostText };`, sandbox);
const api = sandbox.api;

const rows = [
  { id: 'abc12345', title: 'Forklift Driver', company: 'Example Logistics', location: 'Durban', closing_date: '', link: 'https://example.test/apply' },
  { id: 'def67890', title: 'Forklift Driver', company: 'Other Logistics', location: 'Cape Town', closing_date: '', link: '' }
];

test('expired vacancies are excluded by the same date conventions as public pages', () => {
  assert.equal(api.waExpired('2020-01-01'), true);
  assert.equal(api.waExpired('01/01/2020'), true);
  assert.equal(api.waExpired('31/12/2099'), false);
  assert.equal(api.waExpired('ASAP'), false);
});

test('public URLs preserve duplicate-title collision suffixes', () => {
  const urls = api.waPublicUrls(rows);
  assert.equal(urls[0].public_url, 'https://sa-recruiters.co.za/vacancy/forklift-driver-abc123/');
  assert.equal(urls[1].public_url, 'https://sa-recruiters.co.za/vacancy/forklift-driver-def678/');
});

test('post text includes a direct public link and prefers the original application link', () => {
  const [first] = api.waPublicUrls(rows);
  const text = api.whatsappPostText([
    { ...first, application_url: first.link },
    { ...first, title: 'No Link Role', application_url: '' }
  ]);
  assert.match(text, /NEW JOBS — SA RECRUITERS/);
  assert.match(text, /Apply: https:\/\/example\.test\/apply/);
  assert.match(text, /View and apply: https:\/\/sa-recruiters\.co\.za\/vacancy\/forklift-driver-abc123\//);
  assert.match(text, /Browse all vacancies/);
});

test('admin dashboard exposes the protected queue controls', () => {
  const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="sec-whatsappqueue"/);
  assert.match(html, /\/api\/admin\/whatsapp-queue/);
  assert.match(html, /Generate now/);
  assert.match(html, /whatsapp\.com\/channel\/0029Vb3CYEGDuMRdY5Mlrx3E/);
});

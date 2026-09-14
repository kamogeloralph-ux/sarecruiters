import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEmployerCandidates, normalizeCompanyName, scoreCompanyMatch } from './map-pnet-agencies.mjs';

test('normalizes common company suffixes before comparing names', () => {
  assert.equal(normalizeCompanyName('Example Recruitment (Pty) Ltd.'), 'example recruitment');
  assert.equal(scoreCompanyMatch('Example Recruitment', 'Example Recruitment (Pty) Ltd'), 1);
});

test('extracts canonical Pnet employer jobs URLs and ignores job links', () => {
  const html = `
    <a href="/cmp/en/example-recruitment-12345/jobs">Example Recruitment</a>
    <a href="/jobs--Accountant-Cape-Town-Example--4260001-inline.html">Accountant</a>
    <a href="https://www.pnet.co.za/cmp/en/other-agency-99/jobs/in-cape-town">Other Agency</a>`;
  const candidates = extractEmployerCandidates(html);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].name, 'Example Recruitment');
  assert.equal(candidates[0].url, 'https://www.pnet.co.za/cmp/en/example-recruitment-12345/jobs');
  assert.equal(candidates[1].url, 'https://www.pnet.co.za/cmp/en/other-agency-99/jobs');
});

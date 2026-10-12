import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('worker submission/enquiry/poster routes accept uuid ids (not digits only)', () => {
  assert.doesNotMatch(worker, /submissions\\\/\(report\|suggestion\)\\\/\(\\d\+\)/);
  for (const route of ['submissions', 'job-enquiries', 'posters']) {
    assert.match(worker, new RegExp(`admin\\\\/${route}`), route);
  }
  assert.match(worker, /\[A-Za-z0-9_-\]\{1,64\}/);
});

test('admin inline handlers always quote record ids', () => {
  assert.doesNotMatch(admin, /onclick="(?:resolveReport|reopenReport|delReport|delSuggestion)\('\+/);
  assert.match(admin, /resolveReport\(\\''\+jsq\(r\.id\)/);
  assert.match(admin, /delSuggestion\(\\''\+jsq\(s\.id\)/);
});

test('poster actions stay visible on phones and go through the Worker', () => {
  assert.match(admin, /\.row-actions-inline\.always\{display:flex !important\}/);
  assert.match(admin, /class="row-actions-inline always"/);
  assert.match(admin, /adminApi\('DELETE', '\/api\/admin\/posters\//);
  assert.doesNotMatch(admin, /supabaseClient\.from\('employer_posters'\)\.delete\(\)/);
});

test('approving a job enquiry publishes a vacancy and resolves the enquiry only after it saved', () => {
  assert.match(admin, /function publishJobEnquiry\(id\)/);
  assert.match(admin, /if \(vacancySaved === false\) return;/);
  assert.match(admin, /if \(fromEnquiry\) await resolveEnquiryAfterPublish\(title\)/);
  assert.match(admin, /updateJobEnquiryStatus\(enquiryId,'resolved'\)/);
});

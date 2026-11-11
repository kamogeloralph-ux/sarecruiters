import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261110_candidate_cv_profiles.sql');
const sheets = read('../app-sheets.js');
const forms = read('../app-forms.js');
const html = read('../index.html');

test('generated candidate CVs are private to the owning signed-in account', () => {
  assert.match(migration, /user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.candidate_cv_profiles FROM PUBLIC, anon/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.doesNotMatch(migration, /raw_input|raw_notes/i, 'raw AI notes are not persisted');
});

test('Career Profile aggregates the signed-in CV Box row, private request, and saved CV', () => {
  assert.match(sheets, /export async function openCandidateProfileHub\(\)/);
  assert.match(sheets, /pool_candidates'\)\.select\('id,full_name,contact_phone,contact_email,position,location,status/);
  assert.match(sheets, /job_seeker_requests'\)\.select\('id,full_name,phone,email,location,looking_for/);
  assert.match(sheets, /candidate_cv_profiles'\)\.select\('generated_cv,target_role,updated_at'/);
  assert.match(sheets, /cvError: results\[2\]\.error \|\| null/);
  assert.match(sheets, /data\.cvError[\s\S]*?Saved CV status unavailable/);
  assert.match(sheets, /data\.poolError[\s\S]*?Could not load your CV Box status/);
  assert.match(sheets, /data\.requestError[\s\S]*?Could not load your request status/);
  assert.match(sheets, /CV scan &amp; screening/);
  assert.match(sheets, /openCandidateProfileHub,/);
  assert.match(html, /onclick="openCandidateProfileHub\(\)"/);
  assert.match(html, /id="candidate-profile-content"/);
});

test('CV Builder restores and saves generated output by user ID, never the raw prompt', () => {
  assert.match(forms, /from\('candidate_cv_profiles'\)\.select\('generated_cv,target_role'\)\.eq\('user_id', saAuthUser\.id\)/);
  assert.match(forms, /from\('candidate_cv_profiles'\)\.upsert\(\{[\s\S]*?user_id: saAuthUser\.id,[\s\S]*?generated_cv: result\.data\.cv/);
  const start = forms.indexOf("from('candidate_cv_profiles').upsert(");
  const end = forms.indexOf("}, { onConflict: 'user_id' })", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(forms.slice(start, end), /rawInput|raw_input/);
});

test('signed-in job-seeker form reuses profile/request basics but still requires fresh consent', () => {
  assert.match(sheets, /export async function openJobSeekerSheet\(\)/);
  assert.match(sheets, /setIfBlank\('js-name', p\.full_name \|\| r\.full_name/);
  assert.match(sheets, /setIfBlank\('js-looking', p\.position \|\| r\.looking_for/);
  assert.match(sheets, /if \(consent\) consent\.checked = false/);
  assert.match(sheets, /if \(!payload\.consent\) return fail\('Please tick the consent box to continue\.'\)/);
});

test('a new CV Box profile reuses saved generated-CV and private-request identity fields', () => {
  assert.match(sheets, /poolField\('pool-name', request\.full_name \|\| generatedCv\.fullName\)/);
  assert.match(sheets, /poolField\('pool-position', request\.looking_for \|\| \(own\.cv && own\.cv\.target_role\) \|\| generatedCv\.jobTitle\)/);
  assert.match(sheets, /poolField\('pool-qualification', request\.qualification \|\| \(education\[0\] && education\[0\]\.qualification\)\)/);
});

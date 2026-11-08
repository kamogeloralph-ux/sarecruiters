import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateCvScan, mergePositions, namesMatch, normalizeScan, candidateCvKey, cvScanModels, scanCvWithGemini } from '../Cloudflare-worker/cv-scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');

const goodProfile = {
  full_name: 'Nonjabulo Millicent Maseko', position: 'Cashier', location: 'Durban, KwaZulu-Natal', experience_years: 4,
  availability: 'Immediately', photo_url: 'https://media.example/candidate-photos/a.jpg', contact_phone: '0710000000', contact_email: '',
  cv_link: 'https://media.example/candidate-cvs/x.pdf'
};
const goodScan = normalizeScan({
  is_cv: true, readable: true, confidence: 0.93, full_name: 'Nonjabulo Millicent Maseko', positions: ['Cashier', 'Sales Assistant'],
  has_experience_section: true, has_education_section: true, has_contact_details: true
});

test('positions on the CV are added to the ones the user already entered, without duplicates', () => {
  const m = mergePositions('Cashier', ['cashier', 'Sales Assistant', 'Senior Cashier', 'Admin Clerk']);
  assert.deepEqual(m.list, ['Cashier', 'Sales Assistant', 'Admin Clerk']);
  assert.deepEqual(m.added, ['Sales Assistant', 'Admin Clerk']);
  assert.equal(m.text, 'Cashier, Sales Assistant, Admin Clerk');
  assert.equal(mergePositions('', ['General Worker']).text, 'General Worker');
  assert.equal(mergePositions('A one, B two, C three, D four', ['E five']).added.length, 0, 'capped at four positions');
});

test('the name on the CV must match the profile name, tolerating middle names and accents', () => {
  assert.ok(namesMatch('Nonjabulo Maseko', 'Nonjabulo Millicent Maseko'));
  assert.ok(namesMatch('Nonjabulo Millicent Maseko', 'NONJABULO MILLICENT MASEKO'));
  assert.ok(namesMatch('Zoë Nkosi', 'Zoe Nkosi'));
  assert.ok(!namesMatch('Thabo Mokoena', 'Nonjabulo Millicent Maseko'));
  assert.ok(!namesMatch('Maseko', 'Nonjabulo Millicent Maseko'.split(' ')[0]));
});

test('a complete, readable CV whose name matches is approved and verified automatically', () => {
  const v = evaluateCvScan(goodScan, { ...goodProfile, position: 'Cashier, Sales Assistant' }, { contentType: 'application/pdf' });
  assert.deepEqual(v.reasons, []);
  assert.equal(v.autoApprove, true);
});

test('anything missing, unreadable, mismatched or in the wrong format blocks auto-approval and says why', () => {
  const run = (scan, cand, type) => evaluateCvScan(normalizeScan({ ...goodScan, ...scan }), { ...goodProfile, ...cand }, { contentType: type || 'application/pdf' });
  assert.match(run({}, { photo_url: '' }).reasons.join(), /photo/i);
  assert.match(run({}, { location: '' }).reasons.join(), /Location/);
  assert.match(run({}, { experience_years: null }).reasons.join(), /experience/i);
  assert.match(run({}, { contact_phone: '', contact_email: '' }).reasons.join(), /phone number or email/);
  assert.match(run({ readable: false }).reasons.join(), /clearly readable/);
  assert.match(run({ confidence: 0.4 }).reasons.join(), /confident/);
  assert.match(run({ is_cv: false }).reasons.join(), /does not look like a CV/);
  assert.match(run({ full_name: 'Someone Else' }).reasons.join(), /does not match/);
  assert.match(run({ has_contact_details: false }).reasons.join(), /contact details/);
  assert.match(run({ has_experience_section: false, has_education_section: false }).reasons.join(), /experience or education/);
  assert.match(run({}, {}, 'application/msword').reasons.join(), /PDF, PNG or JPG/);
  assert.equal(run({ readable: false }).autoApprove, false);
});

test('only CVs stored in our own bucket can be scanned', () => {
  const env = { R2_PUBLIC_BASE_URL: 'https://media.example' };
  assert.equal(candidateCvKey('https://media.example/candidate-cvs/x.pdf', env), 'candidate-cvs/x.pdf');
  assert.equal(candidateCvKey('https://evil.example/candidate-cvs/x.pdf', env), null);
  assert.equal(candidateCvKey('https://media.example/candidate-photos/x.jpg', env), null);
  assert.equal(candidateCvKey('https://media.example/candidate-cvs/../secret', env), null);
});

test('admin CV Box scans pending CVs automatically through the admin-only worker route', () => {
  const admin = read('admin.html');
  const worker = read('Cloudflare-worker/worker.js');
  assert.match(worker, /path === "\/api\/admin\/cv-scan"/);
  const route = worker.slice(worker.indexOf('"/api/admin/cv-scan"'), worker.indexOf('"/api/generate-cv"'));
  assert.match(route, /isAdminRequest\(request, env\)/);
  assert.match(admin, /function runAutoCvScan\(/);
  assert.match(admin, /runAutoCvScan\(\);\n\}\nfunction openPoolSheet/);
  assert.match(admin, /patch\.verified = true;/);
  assert.match(admin, /patch\.status = 'active'/);
  assert.match(admin, /id="cv-auto-approve"/);
  assert.match(admin, /scanPoolCvFromSheet/);
});

test('CV Box cards shorten long names so the verified seal stays on the same line, with no badge background', () => {
  const sheets = read('app-sheets.js');
  const css = read('styles.css');
  assert.match(sheets, /class="manager-item-title pool-mini-name"><span class="pool-mini-name-text"/);
  assert.match(sheets, /<span class="pool-mini-seal">' \+ verifiedBadge\(/);
  assert.doesNotMatch(sheets, /pool-mini-badge/);
  assert.match(css, /\.pool-mini-name\{display:flex;align-items:center;gap:5px;min-width:0;white-space:nowrap/);
  assert.match(css, /\.pool-mini-name-text\{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  assert.match(css, /\.pool-mini-seal\{flex:none/);
  // mono.css styles every class containing "-badge" with a box; the seal must never use one
  assert.doesNotMatch(css.slice(css.indexOf('.pool-mini-card .pool-mini-copy .manager-item-title.pool-mini-name{')), /-badge/);
});

test('CV scan uses the same stable Gemini alias as the CV Builder and falls back when a model is missing', async () => {
  assert.equal(cvScanModels({})[0], 'gemini-flash-latest');
  assert.equal(cvScanModels({ GEMINI_MODEL: 'pinned-model' })[0], 'pinned-model');
  const realFetch = globalThis.fetch;
  const tried = [];
  globalThis.fetch = async (url) => {
    tried.push(String(url).match(/models\/([^:]+):/)[1]);
    if (tried.length < 3) return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ is_cv: true, readable: true, confidence: 0.9, full_name: 'A B', positions: ['Cashier'], has_experience_section: true, has_education_section: false, has_contact_details: true }) }] } }] }), { status: 200 });
  };
  try {
    const ok = await scanCvWithGemini({ GEMINI_API_KEY: 'k' }, new Uint8Array([1, 2, 3]).buffer, 'application/pdf');
    assert.equal(ok.ok, true);
    assert.equal(ok.scan.positions[0], 'Cashier');
    assert.deepEqual(tried, ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
    const bad = await scanCvWithGemini({ GEMINI_API_KEY: 'k' }, new Uint8Array([1]).buffer, 'application/pdf');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /\(400\): API key not valid/);
  } finally { globalThis.fetch = realFetch; }
});

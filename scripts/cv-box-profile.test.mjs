import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const appCore = read('app-core.js');
const appData = read('app-data.js');
const appCards = read('app-cards.js');
const appSheets = read('app-sheets.js');
const appUi = read('app-ui.js');
const appForms = read('app-forms.js');
const worker = read('Cloudflare-worker/worker.js');
const html = read('index.html');
const admin = read('admin.html');
const css = read('styles.css');
const vacancyCss = read('vacancy-v2.css');
const content = read('content.js');
const cvBoxMigration = read('supabase/migrations/20261112_cv_box_refresh_and_eligibility.sql');

test('employer directory and vacancies have no membership lock UI or card state', () => {
  for (const source of [appCards, appSheets, appUi, appData, html]) {
    assert.doesNotMatch(source, /requireEmployerDirectoryAccess|employerAccessLocked|hasTalentPoolAccess|employer-directory-locked-overlay/);
  }
  assert.doesNotMatch(css, /access-lock|access-verify-fields|access-register-link|vac-card-locked/);
  assert.doesNotMatch(vacancyCss, /vx-card--locked/);
  assert.match(html, /id="screen-allemployers"/);
});

test('public posting and employer registration remain fixed closed without startup toggle reads', () => {
  assert.match(appCore, /publicVacancyPostingOpen = false/);
  assert.match(appCore, /publicEmployerRegistrationOpen = false/);
  assert.doesNotMatch(appData, /publicVacancyPostingOpen|publicEmployerRegistrationOpen|publicEmployerDirectoryOpen/);
  const d1Start = worker.indexOf('async function loadStartupDataFromD1');
  assert.ok(d1Start >= 0);
  const d1End = worker.indexOf('\nasync function ', d1Start + 12);
  const d1Startup = worker.slice(d1Start, d1End < 0 ? undefined : d1End);
  assert.doesNotMatch(d1Startup, /SELECT key, value FROM app_settings/);
  const supabaseStart = worker.indexOf('async function loadStartupData(');
  assert.ok(supabaseStart >= 0);
  const supabaseEnd = worker.indexOf('\nasync function ', supabaseStart + 12);
  const supabaseStartup = worker.slice(supabaseStart, supabaseEnd < 0 ? undefined : supabaseEnd);
  assert.doesNotMatch(supabaseStartup, /supabaseGet\(env,\s*"app_settings"/);
  assert.match(worker, /public_vacancy_posting: "false"/);
  assert.match(worker, /public_employer_registration: "false"/);
  assert.match(admin, /CV Box/);
  assert.doesNotMatch(admin, /Public vacancy posting|Public employer registration|R20\/year/);
});

test('CV Box terminology is consistent while existing database names and deep-link alias stay intact', () => {
  assert.match(content, /id: 'faq-cv-box'/);
  assert.match(appCards, /rpc\('verify_talent_pool_access'/);
  assert.match(worker, /body\.talent_pool_id/);
  assert.match(appUi, /section === 'talent-pool'\) section = 'candidates'/);
  assert.match(appUi, /function openHomeCvBoxProfile\(/);
  assert.match(appSheets, /function openMyCvBoxProfile\(/);
  assert.match(appSheets, /function enforceCvBoxProfile\(/);
  assert.match(appForms, /function sendCvBoxVacancyAlerts\(/);
  assert.match(appUi, /function closeCvBox\(/);
  assert.match(html, /shareSectionLink\('candidates'\)/);
});

test('CV Box back action restores the exact originating screen and active tab', () => {
  assert.match(appSheets, /var activeScreen = document\.querySelector\('\.screen\.active'\)/);
  assert.match(appSheets, /poolReturnScreen = activeScreen && activeScreen\.id !== 'screen-pool'/);
  assert.match(appSheets, /poolReturnNavTab = activeNav && activeNav\.dataset\.tab/);
  assert.match(appSheets, /activeNav\.dataset\.tab === 'menu'\) activeNav = null/);
  assert.match(appUi, /var targetId = document\.getElementById\(poolReturnScreen\) && poolReturnScreen !== 'screen-pool'/);
  assert.match(appUi, /b\.dataset\.tab === poolReturnNavTab/);
  assert.match(html, /<path d="M15 18l-6-6 6-6"\/>/);
});

test('saved CV is viewable by its signed-in owner but private in public listings', () => {
  assert.match(html, /id="pool-cv-current-link"[^>]*hidden/);
  assert.match(appSheets, /var currentCvLink = document\.getElementById\('pool-cv-current-link'\)/);
  assert.match(appSheets, /parsedCvUrl\.protocol === 'https:'\) safeCvUrl = parsedCvUrl\.href/);
  assert.match(appSheets, /currentCvLink\.href = safeCvUrl/);
  assert.match(appSheets, /currentCvLink\.hidden = true; currentCvLink\.removeAttribute\('href'\)/);
  assert.match(appSheets, /\.eq\('user_id', saAuthUser\.id\)/);
  const start = worker.indexOf('async function cvBoxResponse(');
  const end = worker.indexOf('function yocoSecretKey(', start);
  const publicBox = worker.slice(start, end);
  assert.match(publicBox, /select:\s*"id,full_name,position,sector,location,experience_years,about_you,photo_url,verified,status,created_at"/);
  assert.doesNotMatch(publicBox, /cv_link/);
  assert.match(appSheets, /Unlock full CV/);
  assert.doesNotMatch(appSheets, /pool-cv-price|Unlock full CV for R49/); // price stays hidden until Unlock is pressed
  assert.doesNotMatch(appSheets, /pool-contact-row|pool-whatsapp-btn/);
});

test('guest CV Box registrations can link to a Google account later without creating a directory gate', () => {
  assert.match(appCards, /function autoClaimCvBoxRegistration\(/);
  assert.match(appCards, /candidate_claim_profile/);
  assert.match(appCore, /window\.autoClaimCvBoxRegistration\(\)/);
  assert.match(appSheets, /await autoClaimCvBoxRegistration\(\)/);
  assert.match(appSheets, /saAuthUser \? 'linked' : 'pending'/);
  assert.doesNotMatch(appCards, /requireEmployerDirectoryAccess|employerAccessLocked/);
});

test('guest Profile cards, contact details, help action, and account headings remain accessible and legible', () => {
  assert.match(html, /id="account-signin-card"[^>]*aria-hidden="false"/);
  assert.match(html, /id="account-settings-label" hidden>Profile settings/);
  assert.match(html, /id="account-signout-label" hidden>Account/);
  assert.match(html, /class="account-help-action"[^>]*onclick="openCvBoxApplication\(\)"/);
  assert.match(appUi, /if \(settingsLabel\) settingsLabel\.hidden = isGuest/);
  assert.match(appUi, /if \(signoutLabel\) signoutLabel\.hidden = isGuest/);
  assert.match(css, /\.contact-value\{[^}]*color:var\(--text\)/);
  assert.match(css, /\.contact-row:not\(\.contact-row-static\) \.contact-value\{color:var\(--accent\)\}/);
  assert.match(css, /#screen-account \.account-hero,[\s\S]*?#screen-account \.account-quota-card\{[\s\S]*?width:min\(100%,420px\)[\s\S]*?border-radius:16px!important/);
  assert.match(css, /#screen-account \.account-avatar\.account-avatar-btn:disabled::after\{display:none\}/);
  assert.match(appCore, /tap “Try Google sign-in again” to retry/);
  assert.match(appCore, /error: 'Try Google sign-in again'/);
});

test('CV Box upload form requires a profile photo for every new upload', () => {
  assert.match(html, /<label>Profile photo \*<\/label><input id="pool-photo" type="file"[^>]*onchange="handlePoolPhoto\(event\)"/);
  const submit = appSheets.slice(appSheets.indexOf('export async function submitPoolRegistration'), appSheets.indexOf('export function copyText'));
  // The photo check runs before the CV and terms checks and before any upload/insert.
  const photoCheck = submit.indexOf('window.pendingPoolPhotoBlob && !window.currentPoolPhotoUrl');
  assert.ok(photoCheck > 0, 'photo requirement present');
  assert.ok(photoCheck < submit.indexOf('Please upload your CV before submitting.'));
  assert.ok(photoCheck < submit.indexOf("from('pool_candidates').insert"));
  // A failed photo upload must stop a new registration instead of inserting a photo-less row.
  assert.match(submit, /if \(!photoUrl\) \{[\s\S]*?profile photo could not be uploaded[\s\S]*?return; \}/);
  assert.match(submit, /payload\.photo_url = photoUrl;/);
  // Editing keeps the existing photo when no new one is chosen.
  assert.match(submit, /window\.currentPoolPhotoUrl \|\| null/);
});

test('CV Box no longer collects or shows Mini-CV details publicly', () => {
  assert.doesNotMatch(html, /Mini-CV/);
  assert.doesNotMatch(appUi, /Mini-CV/);
  assert.doesNotMatch(appSheets, /pool-minicv-details|pool-finish-later-note|mini-cv-pitch/);
  const list = appSheets.slice(appSheets.indexOf('export function renderPoolList'), appSheets.indexOf('export function poolCandidateWhatsAppLink'));
  assert.doesNotMatch(list, /about_you|experience_years|detailBits|frontBits|pool-mini-details|View profile/);
  assert.match(list, /openCvDownloadRequestById/);
});

test('admin CV Box keeps only approve, edit and a slim uploader form', () => {
  const sheet = admin.slice(admin.indexOf('id="pool-overlay"'), admin.indexOf('CONTENT ARTICLE SHEET'));
  for (const id of ['pc-name', 'pc-photo', 'pc-position', 'pc-sector', 'pc-email', 'pc-cv', 'pc-status', 'pc-location', 'pc-experience', 'pc-availability', 'pc-phone']) assert.match(sheet, new RegExp(`id="${id}"`));
  for (const id of ['pc-gender', 'pc-grade12', 'pc-criminal', 'pc-qualification', 'pc-drivers-license', 'pc-transport', 'pc-relocate', 'pc-employment', 'pc-salary', 'pc-work-authorized', 'pc-about', 'pc-payref', 'pc-paiduntil', 'pc-notes']) {
    assert.doesNotMatch(sheet, new RegExp(`id="${id}"`), `${id} removed`);
  }
  assert.doesNotMatch(sheet, /Mini CV questions/);
  const list = admin.slice(admin.indexOf('function renderPoolCandidates'), admin.indexOf('function openPoolSheet'));
  assert.doesNotMatch(list, /det-row|det-label|about_you|contact_phone|screenBits|contact_email/);
  assert.match(list, /toggleRow\(this\)/);
  assert.match(list, /row-expanded-actions/);
  assert.match(list, /approvePoolCandidate/);
  assert.match(list, /openPoolSheet/);
  // New admin uploads need a photo too.
  const save = admin.slice(admin.indexOf('async function savePoolCandidate'), admin.indexOf('async function approvePoolCandidate'));
  assert.match(save, /profile photo is required/);
});

test('CV Box cards show location, experience and availability before payment, and the form collects them', () => {
  assert.match(appSheets, /pool-mini-facts/);
  assert.match(appSheets, /poolFactExperience\(c\)/);
  assert.match(appSheets, /poolFactAvailability\(c\)/);
  assert.doesNotMatch(appSheets, /pool-mini-facts[^;]*contact_(phone|email)/);
  for (const id of ['pool-location', 'pool-experience', 'pool-availability', 'pool-phone']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears exactly once`);
  }
  assert.match(worker, /select: "id,availability"/);
});

test('admin CV Box sheet edits location, experience, availability and phone', () => {
  for (const id of ['pc-location', 'pc-experience', 'pc-availability', 'pc-phone', 'pc-sector']) {
    assert.equal((admin.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
  }
  assert.match(admin, /location:location,\s*experience_years:parseInt\(experience, 10\),\s*availability:availability/);
  assert.match(admin, /contact_phone:document\.getElementById\('pc-phone'\)\.value\.trim\(\)/);
  assert.match(admin, /sector:sector/);
  assert.match(admin, /Choose a sector from the standardized list/);
});

test('admin CV Box shows profile activity and reconfirmation status using the public sector taxonomy', () => {
  const adminSectors = admin.match(/var ADMIN_CV_BOX_SECTORS = \[([\s\S]*?)\];/);
  const publicSectors = appSheets.match(/export var CV_BOX_SECTORS = \[([\s\S]*?)\];/);
  assert.ok(adminSectors && publicSectors, 'both CV Box sector catalogs exist');
  const values = (body) => Array.from(body.matchAll(/'([^']+)'/g), (match) => match[1]);
  assert.deepEqual(values(adminSectors[1]), values(publicSectors[1]));
  assert.match(admin, /availability_confirmed_at,availability_expires_at,profile_updated_at/);
  assert.match(admin, /function poolAdminActivityLabel\(candidate\)/);
  assert.match(admin, /function poolAdminAvailabilityStatus\(candidate\)/);
  assert.match(admin, /Needs reconfirmation · expired/);
  assert.match(admin, /select\.value = mapped \|\| \(raw \? 'Other' : ''\)/);
  assert.match(admin, /id="pc-activity-summary" hidden/);
  assert.match(admin, /id="pc-profile-updated"/);
  assert.match(admin, /id="pc-availability-status"/);
  assert.match(admin, /class="pool-admin-meta"/);
});

test('in-app browsers (Facebook) ignore the safe-area inset so the bottom nav is not stretched', () => {
  assert.match(html, /setAttribute\('data-inapp','1'\)/);
  assert.match(html, /FBAN\|FBAV/);
  assert.match(css, /html\[data-inapp\] \.bottom-nav[^\{]*\{height:68px!important;padding:7px 8px!important/);
});

test('CV Box renews Immediately availability for 14 or 30 days through an owner-scoped RPC', () => {
  assert.match(html, /id="pool-still-looking-panel"/);
  assert.match(html, /id="pool-still-looking-btn"[^>]*>Still Looking/);
  assert.match(html, /<option value="30" selected>30 days<\/option><option value="14">14 days<\/option>/);
  assert.match(appSheets, /rpc\('candidate_confirm_still_looking'/);
  assert.match(appSheets, /poolCurrentProfileStatus === 'active'/);
  assert.match(appSheets, /Only an active CV Box profile can confirm availability/);
  assert.match(appSheets, /p_candidate_id: String\(editingPoolCandidateId\)/);
  assert.match(appSheets, /p_days: days/);
  assert.match(cvBoxMigration, /p_days NOT IN \(14, 30\)/);
  assert.match(cvBoxMigration, /user_id = auth\.uid\(\)/);
  assert.match(cvBoxMigration, /REVOKE ALL ON FUNCTION public\.candidate_confirm_still_looking\(text, integer\) FROM PUBLIC, anon/);
  assert.match(cvBoxMigration, /GRANT EXECUTE ON FUNCTION public\.candidate_confirm_still_looking\(text, integer\) TO authenticated/);
  assert.match(cvBoxMigration, /NEW\.availability_expires_at - NEW\.availability_confirmed_at = interval '14 days'/);
  assert.match(cvBoxMigration, /NEW\.availability_expires_at - NEW\.availability_confirmed_at = interval '30 days'/);
  assert.match(cvBoxMigration, /OLD\.cv_link, OLD\.availability/);
});

test('CV Box feed only shows complete standardized profiles and prioritizes verified, current, fresh, photo-complete profiles', () => {
  assert.match(html, /<select id="pool-sector"><option value="">Choose a sector/);
  assert.doesNotMatch(html, /<input id="pool-sector"/);
  assert.match(appSheets, /CV_BOX_SECTORS = \[/);
  assert.match(appSheets, /CV_BOX_SECTORS\.indexOf\(sector\) === -1/);
  assert.match(appSheets, /isCompletePublicPoolCandidate\(c\)/);
  assert.match(appSheets, /comparePoolCandidates/);
  assert.match(appSheets, /availability_current/);
  assert.match(appSheets, /poolActivityLabel\(c\)/);
  assert.match(worker, /cvBoxCandidateIsComplete/);
  assert.match(worker, /candidate\.experience_years !== null/);
  assert.match(worker, /Needs reconfirmation/);
  assert.match(worker, /profile_updated_at,availability_confirmed_at,availability_expires_at/);
  assert.match(appSheets, /pool-mini-activity/);
  assert.match(css, /\.pool-mini-activity/);
});

test('legacy CV Box sector records remain visible as Other and prefill the standardized edit option', () => {
  assert.match(worker, /function cvBoxPublicSector\(value\)/);
  assert.match(worker, /sector\.toLowerCase\(\) === "cv box" \? "Other" : sector/);
  assert.match(worker, /map\(\(row\) => \(\{ \.\.\.row, sector: cvBoxPublicSector\(row\.sector\) \}\)\)/);
  assert.match(appSheets, /sector\.toLowerCase\(\) === 'cv box' \? 'Other' : sector/);
});

test('CV Box upload entry is a compact top line above search and hides for recruiter or employer sessions', () => {
  assert.ok(html.indexOf('id="cv-box-actions"') < html.indexOf('id="pool-filters"'));
  assert.match(appSheets, /function syncCvBoxActionsVisibility\(/);
  assert.match(appSheets, /employerManagerMode/);
  assert.match(appSheets, /employer\|recruiter\|agency/);
  assert.match(css, /#cv-box-actions\{[^}]*flex-direction:row/);
  assert.match(css, /#cv-box-actions button\{[^}]*min-height:24px[^}]*white-space:nowrap/);
  assert.match(css, /#cv-box-actions\[hidden\]\{display:none!important\}/);
});

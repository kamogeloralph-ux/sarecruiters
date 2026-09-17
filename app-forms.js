/*
 * SA Recruiters -- app.js split 4/8: app-forms.js
 * Agency/employer/branch/vacancy forms (create, edit, save, delete)
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

// ===== Agency form =====
function openForm(id) {
  editingId = id || null;
  var a = id ? agenciesCache.find(function(x){ return x.id === id; }) : null;
  document.getElementById('form-title').textContent = id ? 'Edit agency' : 'Add agency';
  document.getElementById('f-name').value = a ? a.name : '';
  document.getElementById('f-website').value = a ? a.website : '';
  document.getElementById('f-contact').value = a ? a.contact : '';
  document.getElementById('f-email').value = a ? a.email : '';
  document.getElementById('f-location').value = a ? a.location : '';
  document.getElementById('f-address').value = a ? (a.address || '') : '';
  document.getElementById('f-cvpref').value = a ? a.cvpref : 'Email';
  document.getElementById('f-companies').value = a ? (a.companies || '') : '';
  document.getElementById('f-trades').value = a ? (a.trades || '') : '';
  document.getElementById('f-verified').checked = a ? !!a.verified : false;
  document.getElementById('verified-toggle-row').style.display = isAdmin ? 'flex' : 'none';
  window.pendingPhoto = a ? a.photo : null;
  var preview = document.getElementById('photo-preview');
  var fallback = document.getElementById('photo-fallback');
  if (a && a.photo) { preview.src = a.photo; preview.style.display='block'; fallback.style.display='none'; }
  else { preview.style.display='none'; fallback.style.display='flex'; }
  document.getElementById('hub-list') && document.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  document.getElementById('form-overlay').classList.add('open');
}
function handlePhoto(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxDim = 480;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      window.pendingPhoto = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('photo-preview').src = window.pendingPhoto;
      document.getElementById('photo-preview').style.display = 'block';
      document.getElementById('photo-fallback').style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
// Talent Pool candidate photos go into Supabase Storage (not the DB row)
// so thousands of registrations don't eat into the 500MB database cap —
// only a short URL is stored on the candidate record.
// Photos are centre-cropped to a fixed 512x512 square so every candidate's
// photo is a consistent, predictable size wherever it's used — the pool
// list avatar, their expanded card, and the home screen candidate spotlight.
function handlePoolPhoto(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  var preview = document.getElementById('pool-photo-preview');
  var fallback = document.getElementById('pool-photo-fallback');
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = function() {
      var SIZE = 512;
      var side = Math.min(img.width, img.height);
      var sx = (img.width - side) / 2;
      var sy = (img.height - side) / 2;
      var canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      canvas.toBlob(function(blob) {
        window.pendingPoolPhotoBlob = blob;
        var url = URL.createObjectURL(blob);
        if (preview) { preview.src = url; preview.style.display = 'block'; }
        if (fallback) fallback.style.display = 'none';
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
// Uploads the compressed pool photo (if one was chosen) to the
// candidate-photos bucket and returns its public URL, or null if no
// photo was selected or the bucket/policies haven't been set up yet
// (registration still succeeds without a photo either way).
async function uploadPoolPhotoIfAny() {
  if (!window.pendingPoolPhotoBlob) return null;
  try {
    var res = await fetch(R2_WORKER_URL + '/api/upload/candidate-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: window.pendingPoolPhotoBlob
    });
    var data = await res.json();
    if (!res.ok) { console.error('pool photo upload', data && data.error); return null; }
    return data.url || null;
  } catch(e) { console.error('pool photo upload', e); return null; }
}
async function saveAgency() {
  var name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Add at least the agency name.'); return; }
  var id = editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var payload = {
    id: id,
    name: name,
    website: document.getElementById('f-website').value.trim(),
    contact: document.getElementById('f-contact').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    cvpref: document.getElementById('f-cvpref').value,
    companies: document.getElementById('f-companies').value.trim(),
    trades: document.getElementById('f-trades').value.trim(),
    photo: window.pendingPhoto
  };
  if (isAdmin) payload.verified = document.getElementById('f-verified').checked;
  await upsertAgency(payload);
  // Auto-generate a SMART MANAGER token for new agencies
  if (!editingId) {
    var token = genToken();
    setManagerToken(id, token);
  }
  closeSheet('form-overlay');
  showToast(editingId ? 'Agency updated' : 'Agency added — SMART MANAGER link created');
  editingId = null;
  await loadAll();
}
async function deleteAgencyById(id) {
  if (!confirm('Delete this agency? This cannot be undone.')) return;
  await removeAgency(id);
  showToast('Agency deleted');
  await loadAll();
}

// ===== Employer form =====
var editingEmployerId = null;
function openEmployerForm(id) {
  if (!id && !isAdmin && !publicEmployerRegistrationOpen) { openEmployerLockedSheet(); return; }
  editingEmployerId = id || null;
  var e = id ? employersCache.find(function(x){ return x.id === id; }) : null;
  document.getElementById('employer-form-title').textContent = id ? 'Edit employer' : 'Register your company';
  document.getElementById('e-name').value = e ? e.name : '';
  document.getElementById('e-industry').value = e ? (e.industry || '') : '';
  document.getElementById('e-website').value = e ? (e.website || '') : '';
  document.getElementById('e-contact').value = e ? (e.contact || '') : '';
  document.getElementById('e-email').value = e ? (e.email || '') : '';
  document.getElementById('e-location').value = e ? (e.location || '') : '';
  document.getElementById('e-address').value = e ? (e.address || '') : '';
  document.getElementById('e-verified').checked = e ? !!e.verified : false;
  document.getElementById('employer-verified-toggle-row').style.display = isAdmin ? 'flex' : 'none';
  window.pendingEmployerPhoto = e ? e.photo : null;
  var preview = document.getElementById('emp-photo-preview');
  var fallback = document.getElementById('emp-photo-fallback');
  if (e && e.photo) { preview.src = e.photo; preview.style.display='block'; fallback.style.display='none'; }
  else { preview.style.display='none'; fallback.style.display='flex'; }
  document.getElementById('employer-form-overlay').classList.add('open');
}
function handleEmployerPhoto(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxDim = 480;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      window.pendingEmployerPhoto = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('emp-photo-preview').src = window.pendingEmployerPhoto;
      document.getElementById('emp-photo-preview').style.display = 'block';
      document.getElementById('emp-photo-fallback').style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function saveEmployer() {
  var name = document.getElementById('e-name').value.trim();
  if (!name) { alert('Add at least the company name.'); return; }
  var id = editingEmployerId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var payload = {
    id: id,
    name: name,
    industry: document.getElementById('e-industry').value.trim(),
    website: document.getElementById('e-website').value.trim(),
    contact: document.getElementById('e-contact').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    location: document.getElementById('e-location').value.trim(),
    address: document.getElementById('e-address').value.trim(),
    photo: window.pendingEmployerPhoto
  };
  if (isAdmin) payload.verified = document.getElementById('e-verified').checked;
  var live = await upsertEmployer(payload);
  closeSheet('employer-form-overlay');
  showToast(editingEmployerId ? 'Employer updated' : (live ? 'Company registered — you can now post vacancies' : '⚠ Only saved on THIS device — run CREATE_EMPLOYERS_TABLE.sql so it shows for everyone.'));
  editingEmployerId = null;
  await loadAll();
  if (document.getElementById('screen-allemployers').classList.contains('active')) renderAllEmployersList();
}
async function deleteEmployerById(id) {
  if (!confirm('Delete this employer? Their posted vacancies will remain listed as unattributed unless you also remove them.')) return;
  await removeEmployer(id);
  showToast('Employer deleted');
  await loadAll();
  if (document.getElementById('screen-allemployers').classList.contains('active')) renderAllEmployersList();
}

// ===== Branch form =====
var pendingBranchAgency = null;
var pendingBranchId = null; // set when EDITING an existing branch; null when adding
function openBranchSheet(agencyId, branchId) {
  pendingBranchAgency = agencyId;
  pendingBranchId = branchId || null;
  // Find existing branch (for editing) — looks in both cache and localStorage fallback
  var existing = null;
  if (branchId) {
    existing = branchesCache.find(function(x){ return x.id === branchId; });
    if (!existing) {
      var local = readLocal('branches');
      existing = local.find(function(x){ return x.id === branchId; });
    }
  }
  // Update sheet title
  var titleEl = document.querySelector('#branch-overlay .sheet h3');
  if (titleEl) titleEl.textContent = existing ? 'Edit branch' : 'Add branch';
  // Populate fields
  document.getElementById('b-name').value = existing ? (existing.name || '') : '';
  document.getElementById('b-location').value = existing ? (existing.location || '') : '';
  document.getElementById('b-phone').value = existing ? (existing.phone || '') : '';
  document.getElementById('b-email').value = existing ? (existing.email || '') : '';
  document.getElementById('branch-overlay').classList.add('open');
}
async function saveBranch() {
  var name = document.getElementById('b-name').value.trim();
  if (!name) { alert('Add a branch name.'); return; }
  // Reuse existing id when editing; generate a new one only when adding
  var id = pendingBranchId || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var live = await upsertBranch({ id: id, agency_id: pendingBranchAgency, name: name, location: document.getElementById('b-location').value.trim(), phone: document.getElementById('b-phone').value.trim(), email: document.getElementById('b-email').value.trim() });
  var editing = !!pendingBranchId;
  pendingBranchId = null; // reset
  closeSheet('branch-overlay');
  showToast(live ? (editing ? 'Branch updated' : 'Branch added') : (editing ? 'Branch updated (saved on this device)' : 'Branch added (saved on this device)'));
  await loadAll();
  if (managerMode) { renderManagerMode(); return; }
  var card = document.getElementById('hub-' + pendingBranchAgency);
  if (card) { card.classList.add('open'); switchHubTab(card.querySelector('.hub-tab'), pendingBranchAgency, 'branches'); }
}
async function deleteBranch(id, agencyId) {
  if (!confirm('Delete this branch?')) return;
  await removeBranch(id);
  await loadAll();
  var card = document.getElementById('hub-' + agencyId);
  if (card) card.classList.add('open');
}

// ===== Vacancy form =====
var MANAGER_TERMS_VERSION = '1.1';
var MANAGER_TERMS_PDF = 'terms/vacancy-posting-terms.pdf';
function resetVacancyTermsAcceptance() {
  ['vacancy-terms-accept', 'general-vacancy-terms-accept'].forEach(function(id) {
    var input = document.getElementById(id);
    if (input) input.checked = false;
  });
}
function requireVacancyTermsAcceptance(inputId) {
  var input = document.getElementById(inputId);
  if (!input || !input.checked) {
    alert('Please read the SA Recruiters Vacancy Posting Terms & Conditions and tick the agreement box before publishing.');
    if (input) input.focus();
    return false;
  }
  return true;
}
function currentTermsManagerType() {
  if (managerMode) return 'agency';
  if (employerManagerMode) return 'employer';
  return 'public';
}
async function recordVacancyTermsAcceptance(vacancyId, agencyId, employerId) {
  try {
    var result = await supabaseClient.from('manager_terms_acceptances').insert({
      manager_type: currentTermsManagerType(),
      agency_id: agencyId || null,
      employer_id: employerId || null,
      vacancy_id: vacancyId || null,
      terms_version: MANAGER_TERMS_VERSION,
      accepted_at: new Date().toISOString(),
      user_agent: navigator.userAgent || null
    });
    if (result.error) { console.warn('terms acceptance record unavailable', result.error); return false; }
    return true;
  } catch (e) { console.warn('terms acceptance record failed', e); return false; }
}
var pendingVacancyAgency = null;
function openVacancySheet(agencyId) {
  pendingVacancyAgency = agencyId;
  document.getElementById('v-title').value = '';
  document.getElementById('v-location').value = '';
  document.getElementById('v-etype').value = '';
  document.getElementById('v-contract').value = '';
  document.getElementById('v-salary').value = '';
  document.getElementById('v-hours').value = '';
  document.getElementById('v-schedule').value = '';
  document.getElementById('v-start').value = '';
  document.getElementById('v-closing').value = '';
  document.getElementById('v-notes').value = '';
  document.getElementById('v-link').value = '';
  resetVacancyTermsAcceptance();
  document.getElementById('vacancy-overlay').classList.add('open');
}
function normalizeVacancyLink(value) {
  var link = (value || '').trim();
  if (!link || /^https?:\/\//i.test(link)) return link;
  return /^[^\s/]+\.[^\s/]+/.test(link) ? 'https://' + link : link;
}
function setVacancySaveBusy(busy) {
  document.querySelectorAll('#vacancy-overlay .sheet-submit,#general-vacancy-overlay .sheet-submit').forEach(function(btn) {
    btn.disabled = !!busy;
    if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  });
}

async function saveVacancy() {
  var title = document.getElementById('v-title').value.trim();
  if (!title) { alert('Add a role/title.'); return; }
  if (!isAdmin && !requireVacancyTermsAcceptance('vacancy-terms-accept')) return;
  setVacancySaveBusy(true);
  try {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    var vacancyManageToken = (managerMode && managerAgency && managerAgency.id === pendingVacancyAgency) ? getManagerToken(pendingVacancyAgency) : null;
    var live = await upsertVacancy({
      id: id, agency_id: pendingVacancyAgency, title: title,
      location: document.getElementById('v-location').value.trim(),
      employment_type: document.getElementById('v-etype').value.trim(),
      contract_type: document.getElementById('v-contract').value.trim(),
      salary: document.getElementById('v-salary').value.trim(),
      hours: document.getElementById('v-hours').value.trim(),
      work_schedule: document.getElementById('v-schedule').value.trim(),
      start_date: document.getElementById('v-start').value.trim(),
      closing_date: document.getElementById('v-closing').value.trim(),
      notes: document.getElementById('v-notes').value.trim(),
      link: normalizeVacancyLink(document.getElementById('v-link').value)
    }, vacancyManageToken);
    var termsRecorded = live ? await recordVacancyTermsAcceptance(id, managerMode && managerAgency ? managerAgency.id : pendingVacancyAgency, null) : false;
    closeSheet('vacancy-overlay');
    showToast(live ? (termsRecorded ? 'Vacancy published' : 'Vacancy published — terms acceptance could not be recorded') : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
    await loadAll();
    if (managerMode) { renderManagerMode(); return; }
    var card = document.getElementById('hub-' + pendingVacancyAgency);
    if (card) { card.classList.add('open'); switchHubTab(card.querySelector('.hub-tab'), pendingVacancyAgency, 'vacancies'); }
  } catch (error) {
    console.error('[SA Recruiters] Vacancy save failed', error);
    showToast('Could not save the vacancy. Please try again.');
  } finally {
    setVacancySaveBusy(false);
  }
}
async function deleteVacancy(id, agencyId) {
  if (!confirm('Delete this vacancy?')) return;
  var vacancyManageToken = (managerMode && managerAgency && managerAgency.id === agencyId) ? getManagerToken(agencyId) : null;
  await removeVacancy(id, vacancyManageToken);
  await loadAll();
  var card = document.getElementById('hub-' + agencyId);
  if (card) card.classList.add('open');
}

// ===== General vacancy posting (profile section, admin) =====
var editingGeneralVacancyId = null;
var pendingVacancyEmployer = null; // set when posting/editing a vacancy from an employer's profile
function openGeneralVacancySheet() {
  if (!isAdmin && !publicVacancyPostingOpen) { openVacancyLockedSheet(); return; }
  editingGeneralVacancyId = null;
  pendingVacancyEmployer = null;
  document.getElementById('gv-title').textContent = 'Post a vacancy';
  document.getElementById('gv-submit-btn').textContent = 'Publish vacancy';
  document.getElementById('gv-role').value = '';
  document.getElementById('gv-company').value = '';
  document.getElementById('gv-location').value = '';
  document.getElementById('gv-remote').value = '';
  document.getElementById('gv-etype').value = '';
  document.getElementById('gv-exp').value = '';
  document.getElementById('gv-contract').value = '';
  document.getElementById('gv-salary').value = '';
  document.getElementById('gv-hours').value = '';
  document.getElementById('gv-schedule').value = '';
  document.getElementById('gv-start').value = '';
  document.getElementById('gv-closing').value = '';
  document.getElementById('gv-notes').value = '';
  document.getElementById('gv-link').value = '';
  document.getElementById('gv-email').value = '';
  document.getElementById('gv-phone').value = '';
  resetVacancyTermsAcceptance();
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
// Post a vacancy as a specific registered employer — same form, but the
// company field is locked to the employer's name and the saved vacancy is
// tagged with employer_id so it shows the employer's logo/verified badge
// and appears in both the employer's profile AND the main Vacancies list.
function openEmployerVacancySheet(employerId) {
  var isSelfManaging = employerManagerMode && managerEmployer && managerEmployer.id === employerId;
  if (!isAdmin && !isSelfManaging) { showToast('Vacancy posting for employers is managed by the admin.'); return; }
  var emp = employersCache.find(function(x){ return x.id === employerId; });
  if (!emp) { showToast('Employer not found'); return; }
  editingGeneralVacancyId = null;
  pendingVacancyEmployer = employerId;
  document.getElementById('gv-title').textContent = 'Post a vacancy — ' + emp.name;
  document.getElementById('gv-submit-btn').textContent = 'Publish vacancy';
  document.getElementById('gv-role').value = '';
  document.getElementById('gv-company').value = emp.name || '';
  document.getElementById('gv-location').value = emp.location || '';
  document.getElementById('gv-remote').value = '';
  document.getElementById('gv-etype').value = '';
  document.getElementById('gv-exp').value = '';
  document.getElementById('gv-contract').value = '';
  document.getElementById('gv-salary').value = '';
  document.getElementById('gv-hours').value = '';
  document.getElementById('gv-schedule').value = '';
  document.getElementById('gv-start').value = '';
  document.getElementById('gv-closing').value = '';
  document.getElementById('gv-notes').value = '';
  document.getElementById('gv-link').value = '';
  document.getElementById('gv-email').value = emp.email || '';
  document.getElementById('gv-phone').value = emp.contact || '';
  resetVacancyTermsAcceptance();
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
function openEditGeneralVacancySheet(id) {
  var v = vacanciesCache.find(function(x) { return x.id === id; });
  if (!v) { showToast('Vacancy not found'); return; }
  editingGeneralVacancyId = id;
  pendingVacancyEmployer = v.employer_id || null;
  document.getElementById('gv-title').textContent = 'Edit vacancy';
  document.getElementById('gv-submit-btn').textContent = 'Save changes';
  document.getElementById('gv-role').value = v.title || '';
  document.getElementById('gv-company').value = v.company || '';
  document.getElementById('gv-location').value = v.location || '';
  document.getElementById('gv-remote').value = v.remote || '';
  document.getElementById('gv-etype').value = v.employment_type || '';
  document.getElementById('gv-exp').value = v.experience_level || '';
  document.getElementById('gv-contract').value = v.contract_type || '';
  document.getElementById('gv-salary').value = v.salary || '';
  document.getElementById('gv-hours').value = v.hours || '';
  document.getElementById('gv-schedule').value = v.work_schedule || '';
  document.getElementById('gv-start').value = v.start_date || '';
  document.getElementById('gv-closing').value = v.closing_date || '';
  document.getElementById('gv-notes').value = v.notes || '';
  document.getElementById('gv-link').value = v.link || '';
  document.getElementById('gv-email').value = v.email || '';
  document.getElementById('gv-phone').value = v.phone || '';
  resetVacancyTermsAcceptance();
  document.getElementById('general-vacancy-overlay').classList.add('open');
}
async function saveGeneralVacancy() {
  var title = document.getElementById('gv-role').value.trim();
  if (!title) { alert('Add a role/title.'); return; }
  if (!isAdmin && !requireVacancyTermsAcceptance('general-vacancy-terms-accept')) return;
  setVacancySaveBusy(true);
  try {
    var data = {
      title: title,
      company: document.getElementById('gv-company').value.trim(),
      location: document.getElementById('gv-location').value.trim(),
      // The vacancies table's CHECK constraint only allows NULL, 'On-site',
      // 'Remote', or 'Hybrid' — an empty string (the dropdown's default
      // "— Not specified —" option) violates it and silently fails the
      // whole save. Send null instead whenever it's left unset.
      remote: document.getElementById('gv-remote').value || null,
      employment_type: document.getElementById('gv-etype').value.trim(),
      experience_level: document.getElementById('gv-exp').value,
      contract_type: document.getElementById('gv-contract').value.trim(),
      salary: document.getElementById('gv-salary').value.trim(),
      hours: document.getElementById('gv-hours').value.trim(),
      work_schedule: document.getElementById('gv-schedule').value.trim(),
      start_date: document.getElementById('gv-start').value.trim(),
      closing_date: document.getElementById('gv-closing').value.trim(),
      notes: document.getElementById('gv-notes').value.trim(),
      link: normalizeVacancyLink(document.getElementById('gv-link').value),
      email: document.getElementById('gv-email').value.trim(),
      phone: document.getElementById('gv-phone').value.trim(),
      agency_id: pendingVacancyEmployer ? 'employer' : 'general'
    };
    if (pendingVacancyEmployer) data.employer_id = pendingVacancyEmployer;
    var wasEmployerPost = !!pendingVacancyEmployer;
    var employerIdForRefresh = pendingVacancyEmployer;
    var generalVacancyManageToken = (pendingVacancyEmployer && employerManagerMode && managerEmployer && managerEmployer.id === pendingVacancyEmployer) ? getEmployerManagerToken(pendingVacancyEmployer) : null;
    var termsRecordedGeneral = false;
    if (editingGeneralVacancyId) {
      data.id = editingGeneralVacancyId;
      var live2 = await upsertVacancy(data, generalVacancyManageToken);
      termsRecordedGeneral = live2 ? await recordVacancyTermsAcceptance(data.id, null, pendingVacancyEmployer || (employerManagerMode && managerEmployer ? managerEmployer.id : null)) : false;
      closeSheet('general-vacancy-overlay');
      showToast(live2 ? (termsRecordedGeneral ? 'Vacancy updated' : 'Vacancy updated — terms acceptance could not be recorded') : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
    } else {
      data.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      var live3 = await upsertVacancy(data, generalVacancyManageToken);
      termsRecordedGeneral = live3 ? await recordVacancyTermsAcceptance(data.id, null, pendingVacancyEmployer || (employerManagerMode && managerEmployer ? managerEmployer.id : null)) : false;
      closeSheet('general-vacancy-overlay');
      showToast(live3 ? (termsRecordedGeneral ? 'Vacancy published' : 'Vacancy published — terms acceptance could not be recorded') : '⚠ Only saved on THIS device — other users will NOT see it. The Supabase vacancies table is missing (see CREATE_VACANCIES_TABLE.sql).');
    }
    editingGeneralVacancyId = null;
    pendingVacancyEmployer = null;
    await loadAll();
    if (document.getElementById('screen-allvacancies').classList.contains('active')) renderAllVacanciesList();
    if (wasEmployerPost && employerIdForRefresh && document.getElementById('screen-allemployers').classList.contains('active')) {
      renderAllEmployersList();
      var empCard = document.getElementById('emphub-' + employerIdForRefresh);
      if (empCard) empCard.classList.add('open');
    }
  } catch (error) {
    console.error('[SA Recruiters] General vacancy save failed', error);
    showToast('Could not save the vacancy. Please try again.');
  } finally {
    setVacancySaveBusy(false);
  }
}
async function deleteGeneralVacancy(id) {
  if (!confirm('Delete this vacancy?')) return;
  var vac = vacanciesCache.find(function(x){ return x.id === id; });
  var generalVacancyManageToken = (vac && vac.employer_id && employerManagerMode && managerEmployer && managerEmployer.id === vac.employer_id) ? getEmployerManagerToken(vac.employer_id) : null;
  await removeVacancy(id, generalVacancyManageToken);
  showToast('Vacancy deleted');
  await loadAll();
  if (document.getElementById('screen-allvacancies').classList.contains('active')) {
    renderAllVacanciesList();
  }
  if (document.getElementById('screen-allemployers').classList.contains('active')) {
    renderAllEmployersList();
  }
}

// ===== Sheets / misc =====

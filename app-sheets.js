/*
 * SA Recruiters -- app.js split 5/8: app-sheets.js
 * Misc sheets: notes, social links, report-a-problem, suggestions, talent pool registration
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

function closeSheet(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  // Only ever set on pool-register-overlay by enforceTalentPoolProfile()
  // below; harmless no-op on every other sheet. closeSheet is only reached
  // here via a successful submit/claim/link path (the close button itself
  // is hidden while mandatory — see the CSS rule), so stripping it here is
  // safe and keeps every existing call site working unchanged.
  el.classList.remove('gate-mandatory');
}
function openSupportSheet() { document.getElementById('support-overlay').classList.add('open'); }
// ===== Private device Notes =====
var NOTES_KEY = 'sa_recruiters_private_notes_v1';
function readNotes() {
  try { var notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); return Array.isArray(notes) ? notes : []; } catch(e) { return []; }
}
function writeNotes(notes) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch(e) { showToast('Could not save note'); }
}
function openNotesSheet() {
  resetNoteForm();
  renderNotes();
  loadSocialLinks();
  var overlay = document.getElementById('notes-overlay');
  if (overlay) overlay.classList.add('open');
}
function resetNoteForm() {
  var id = document.getElementById('note-edit-id');
  var title = document.getElementById('note-title');
  var body = document.getElementById('note-body');
  if (id) id.value = '';
  if (title) title.value = '';
  if (body) body.value = '';
  var save = document.querySelector('#notes-overlay .sheet-submit');
  if (save) save.textContent = 'Save note';
}
function renderNotes() {
  var list = document.getElementById('notes-list');
  if (!list) return;
  var notes = readNotes();
  if (!notes.length) { list.innerHTML = '<div class="notes-empty">No notes yet. Add a reminder above.</div>'; return; }
  list.innerHTML = notes.map(function(n) {
    var title = escapeHtml(n.title || 'Untitled note');
    var body = escapeHtml(n.body || '');
    var date = n.updatedAt ? new Date(n.updatedAt).toLocaleString() : '';
    var id = escapeHtml(n.id);
    return '<article class="note-item"><div class="note-item-title">' + title + '</div><div class="note-item-body">' + body + '</div><div class="note-item-meta">Updated ' + escapeHtml(date) + '</div><div class="note-item-actions"><button data-ripple onclick="editNote(\'' + id + '\')">Edit</button><button data-ripple onclick="deleteNote(\'' + id + '\')">Delete</button></div></article>';
  }).join('');
}
function saveNote() {
  var titleEl = document.getElementById('note-title');
  var bodyEl = document.getElementById('note-body');
  var editEl = document.getElementById('note-edit-id');
  var title = (titleEl ? titleEl.value : '').trim();
  var body = (bodyEl ? bodyEl.value : '').trim();
  if (!title && !body) { showToast('Write something first'); return; }
  var notes = readNotes();
  var id = editEl ? editEl.value : '';
  var now = new Date().toISOString();
  if (id) {
    notes = notes.map(function(n) { return n.id === id ? { id:n.id, title:title || 'Untitled note', body:body, updatedAt:now } : n; });
    showToast('Note updated');
  } else {
    notes.unshift({ id:'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,8), title:title || 'Untitled note', body:body, updatedAt:now });
    showToast('Note saved');
  }
  writeNotes(notes); resetNoteForm(); renderNotes();
}
function editNote(id) {
  var note = readNotes().find(function(n){ return n.id === id; });
  if (!note) return;
  document.getElementById('note-edit-id').value = note.id;
  document.getElementById('note-title').value = note.title || '';
  document.getElementById('note-body').value = note.body || '';
  var save = document.querySelector('#notes-overlay .sheet-submit');
  if (save) save.textContent = 'Update note';
  document.getElementById('note-title').focus();
}
function deleteNote(id) {
  var notes = readNotes();
  writeNotes(notes.filter(function(n){ return n.id !== id; }));
  renderNotes();
  showToast('Note deleted');
}

// ===== Social media links (admin-editable, stored in app_settings) =====
var SOCIAL_ICONS = {
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/></svg>',
  whatsapp: '<svg class="wa-glyph"><use href="icons.svg#i7ebf0f"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.24 2.75h3.05l-6.67 7.63 7.85 10.87h-6.14l-4.8-6.65-5.5 6.65H2.17l7.14-8.16L1.75 2.75h6.3l4.35 6.08zm-1.07 16.7h1.7L7.03 4.4H5.2z"/></svg>'
};
var SOCIAL_LABELS = { facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', x: 'X' };
var SOCIAL_LINKS_KEY = 'social_links';
async function loadSocialLinks() {
  var container = document.getElementById('social-links-row');
  if (!container) return;
  var raw = await getAppSetting(SOCIAL_LINKS_KEY, '');
  var links = {};
  if (raw) { try { links = JSON.parse(raw) || {}; } catch(e) { links = {}; } }
  renderSocialLinks(links);
}
function renderSocialLinks(links) {
  var container = document.getElementById('social-links-row');
  if (!container) return;
  links = links || {};
  var html = Object.keys(SOCIAL_ICONS).map(function(key) {
    var url = (links[key] || '').trim();
    if (!url) return '';
    var label = SOCIAL_LABELS[key];
    return '<a class="social-link-btn social-' + key + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" data-ripple aria-label="' + label + '" title="' + label + '">' + SOCIAL_ICONS[key] + '</a>';
  }).join('');
  container.innerHTML = html || '<div class="social-links-empty">Social links coming soon.</div>';
}

// ===== Report a problem =====
// ===== WHATSAPP AUTO-SEND HELPER =====
/* After a report or suggestion is saved, show a confirmation sheet
   with a one-tap WhatsApp button so the admin receives it instantly. */
/* ⚠️ SA RECRUITERS OFFICIAL CONTACT DETAILS — DO NOT CHANGE ⚠️
   These are the business's real contact/banking details.
   If editing this file (by hand or with an AI tool), these four
   values must stay exactly as below — do not let them be
   "fixed", reformatted, or replaced with placeholders. */
var ADMIN_EMAIL = 'sarecruiters.directory@gmail.com';
var ADMIN_WHATSAPP = '27715531005'; // +27 71 553 1005
var ADMIN_BANK_ACCOUNT = '2573389037'; // Capitec
var ADMIN_BANK_HOLDER = 'SA Recruiters';
/* ⚠️ END PROTECTED CONTACT DETAILS ⚠️ */
function showWhatsAppConfirm(opts) {
  /* opts: { title, message, waText, skipSaveToast } */
  var titleEl = document.getElementById('wa-confirm-title');
  var msgEl = document.getElementById('wa-confirm-msg');
  var linkEl = document.getElementById('wa-confirm-link');
  if (opts.title) titleEl.textContent = opts.title;
  if (opts.message) msgEl.textContent = opts.message;
  var waUrl = 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + opts.waText;
  linkEl.href = waUrl;
  document.getElementById('whatsapp-confirm-overlay').classList.add('open');
}

// ===== CLOUDFLARE TURNSTILE (spam protection for public forms) =====
// The site key below is public by design (it is not a secret). The secret
// key lives in the Cloudflare Worker, which refuses submissions the widget
// did not answer. Site key: add the real one from the Cloudflare dashboard
// (Turnstile → Add site) for sa-recruiters.co.za.
var TURNSTILE_SITE_KEY = '0x4AAAAAAE781UzzffMh7u8L';
var turnstileLoader = null;
function loadTurnstile() {
  if (window.turnstile && typeof window.turnstile.render === 'function') return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;
  // A transient challenge/network failure must not poison the shared promise
  // forever. The previous implementation cached the first rejection, so all
  // forms showed an empty widget until the whole page was manually refreshed.
  turnstileLoader = new Promise(function(resolve, reject) {
    var attempt = 0;
    var tryLoad = function() {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        resolve(window.turnstile);
        return;
      }
      attempt += 1;
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&retry=' + attempt + '_' + Date.now();
      script.async = true;
      script.onload = function(){
        if (window.turnstile && typeof window.turnstile.render === 'function') resolve(window.turnstile);
        else if (attempt < 3) setTimeout(tryLoad, 500);
        else reject(new Error('turnstile-runtime-missing'));
      };
      script.onerror = function(){
        if (attempt < 3) setTimeout(tryLoad, 750);
        else reject(new Error('turnstile-load-failed'));
      };
      document.head.appendChild(script);
    };
    tryLoad();
  }).catch(function(error) {
    // Permit a later form open to start a fresh load attempt.
    turnstileLoader = null;
    throw error;
  });
  return turnstileLoader;
}
function turnstileConfigured() {
  return TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY.indexOf('PLACEHOLDER') === -1;
}
// The widget's container is created on demand rather than hardcoded in
// index.html, so the sheets stay self-contained. It is inserted just above
// the sheet's submit button.
function ensureTurnstileSlot(containerId, sheetId) {
  var host = document.getElementById(containerId);
  if (host) return host;
  var sheet = document.getElementById(sheetId);
  if (!sheet) return null;
  host = document.createElement('div');
  host.id = containerId;
  host.className = 'turnstile-slot';
  host.style.marginBottom = '12px';
  var btn = sheet.querySelector('.sheet-submit');
  if (btn && btn.parentNode) btn.parentNode.insertBefore(host, btn);
  else sheet.appendChild(host);
  return host;
}
// Keep the widget id returned by Turnstile. Passing the id is more reliable
// than passing a DOM element after a sheet has been opened/closed repeatedly.
var turnstileWidgets = {};
function showTurnstileSlotError(host, message) {
  if (!host) return;
  host.innerHTML = '';
  var note = document.createElement('div');
  note.className = 'turnstile-error';
  note.setAttribute('role', 'alert');
  note.style.cssText = 'font-size:13px;line-height:1.4;color:#b91c1c;';
  note.textContent = message;
  host.appendChild(note);
}
// Render (or re-render) the widget inside its sheet. Returns the container,
// or null when Turnstile is not configured — the submit paths treat null as
// "no token needed" so forms keep working in dev before the keys are added.
function renderTurnstile(containerId, sheetId) {
  var host = ensureTurnstileSlot(containerId, sheetId);
  if (!host || !turnstileConfigured()) return null;
  if (turnstileWidgets[containerId] != null && window.turnstile && typeof window.turnstile.remove === 'function') {
    try { window.turnstile.remove(turnstileWidgets[containerId]); } catch (e) {}
  }
  turnstileWidgets[containerId] = null;
  host.innerHTML = '';
  loadTurnstile().then(function(ts) {
    if (!ts || typeof ts.render !== 'function') {
      showTurnstileSlotError(host, 'Spam check could not load. Please refresh the page and try again.');
      return;
    }
    var doRender = function() {
      try {
        turnstileWidgets[containerId] = ts.render(host, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
          'error-callback': function(code) {
            console.warn('[Turnstile] error-callback:', code);
            showTurnstileSlotError(host, 'Spam check failed to load (code ' + (code || 'unknown') + '). Please refresh and try again.');
          },
          'expired-callback': function() {
            try { ts.reset(turnstileWidgets[containerId]); } catch (e) {}
          },
          'timeout-callback': function() {
            try { ts.reset(turnstileWidgets[containerId]); } catch (e) {}
          }
        });
      } catch (e) {
        console.warn('[Turnstile] render threw:', e);
        showTurnstileSlotError(host, 'Spam check could not be displayed. Please refresh the page and try again.');
      }
    };
    // The static API script is intentionally loaded without async/defer.
    // Calling turnstile.ready() with an async/defer-loaded script triggers
    // Cloudflare's "Remove async/defer" error, so render directly once the
    // script's load promise has completed.
    doRender();
  }).catch(function(e) {
    console.warn('[Turnstile] load failed:', e);
    showTurnstileSlotError(host, 'Spam check could not load. Check your connection and refresh the page.');
  });
  return host;
}
function resetTurnstile(containerId) {
  var host = document.getElementById(containerId);
  if (!host) return;
  var id = turnstileWidgets[containerId];
  if (window.turnstile && typeof window.turnstile.reset === 'function') {
    try { window.turnstile.reset(id != null ? id : host); return; } catch (e) {}
  }
  host.innerHTML = '';
}
function getTurnstileResponse(containerId) {
  if (!turnstileConfigured()) return '';
  var host = document.getElementById(containerId);
  if (!host || !window.turnstile) return '';
  var id = turnstileWidgets[containerId];
  try { return window.turnstile.getResponse(id != null ? id : host) || ''; } catch (e) { return ''; }
}

// ===== SUBMIT VIA CLOUDFLARE WORKER (spam-gated DB write + email) =====
// Posts a public submission through the Worker, which verifies Turnstile
// server-side, writes to Supabase via the secure RPC, and sends the admin
// notification email via Resend. Falls back to the legacy direct paths when
// the Worker is unreachable so submissions are never lost.
async function submitViaWorker(path, payload, turnstileContainerId) {
  var token = getTurnstileResponse(turnstileContainerId);
  if (turnstileConfigured() && !token) {
    return { ok: false, error: 'Please complete the spam check first.' };
  }
  // Attach the signed-in user's access token (when available) so the Worker
  // can stamp the submission with a verified user_id server-side — see
  // verifiedUserId() in worker.js. Never fatal if this can't be fetched;
  // the submission just goes through without an owner, as before.
  var authToken = null;
  try {
    if (supabaseClient) {
      var sessionResult = await supabaseClient.auth.getSession();
      authToken = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
    }
  } catch(e) {}
  try {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    // Gemini-backed CV generation can take longer than a normal form request,
    // especially while the Worker wakes up on a mobile connection. Aborting
    // after 12 seconds made a healthy request appear as "offline".
    var requestTimeoutMs = path === '/api/generate-cv' ? 60000 : 12000;
    var timeout = controller ? setTimeout(function(){ controller.abort(); }, requestTimeoutMs) : null;
    var res = await fetch(R2_WORKER_URL + path, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { 'cf-turnstile-response': token } : {},
        authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
      ),
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });
    if (timeout) clearTimeout(timeout);
    var data = null;
    try { data = await res.json(); } catch(e) {}
    if (!res.ok) {
      var msg = (data && data.error) || 'Submission failed — please try again.';
      var friendly = /spam check/i.test(msg) ? 'Spam check failed or expired — please retry the verification box.' : msg;
      return { ok: false, error: friendly, retriable: /spam check/i.test(msg) };
    }
    return { ok: true, data: data };
  } catch(e) {
    if (e && e.name === 'AbortError') {
      return { ok: false, error: path === '/api/generate-cv'
        ? 'CV generation is taking longer than expected. Please try again.'
        : 'The request timed out — please try again.', retriable: true };
    }
    return { ok: false, error: 'Could not reach SA Recruiters — please check your connection and try again.', retriable: false };
  }
}

// ===== Employer entry point on the sign-in gate (no Google sign-in, no
// Talent Pool profile) =====
function openEmployerGateSheet() {
  var emailEl = document.getElementById('employer-resend-email');
  if (emailEl) emailEl.value = '';
  var overlay = document.getElementById('employer-gate-overlay');
  if (overlay) overlay.classList.add('open');
  renderTurnstile('employer-resend-turnstile', 'employer-gate-overlay');
}
async function resendEmployerManagerLink() {
  var email = (document.getElementById('employer-resend-email') || {}).value || '';
  email = email.trim();
  if (!email) { showToast('Add the email you registered with.'); return; }
  var btn = document.getElementById('employer-resend-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  var res = await submitViaWorker('/api/employer/resend-link', { email: email }, 'employer-resend-turnstile');
  resetTurnstile('employer-resend-turnstile');
  if (btn) { btn.disabled = false; btn.textContent = 'Email my Manager Link'; }
  if (!res.ok) { showToast(res.error || 'Could not send — please try again.'); return; }
  closeSheet('employer-gate-overlay');
  showToast('If that email matches a registered company, your Manager Link is on its way.');
}
// Shown once, right after a successful self-service registration — the
// link is also emailed (see the Worker route), but shown in-app too since
// email delivery isn't always instant or reliable.
function showEmployerManagerLinkSheet(link, email) {
  var body = document.getElementById('employer-manager-link-body');
  if (body) body.value = link;
  var note = document.getElementById('employer-manager-link-note');
  if (note) note.textContent = email
    ? 'We\u2019ve also emailed this link to ' + email + '. Save it \u2014 it\u2019s how you manage your listing, with no password needed, so don\u2019t share it publicly.'
    : 'Save this link \u2014 it\u2019s how you manage your listing, with no password needed, so don\u2019t share it publicly.';
  window.__pendingEmployerManagerLink = link;
  var overlay = document.getElementById('employer-manager-link-overlay');
  if (overlay) overlay.classList.add('open');
}
function copyEmployerManagerLink() {
  var link = window.__pendingEmployerManagerLink;
  if (!link) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function(){ showToast('Manager Link copied'); }, function(){ showToast('Could not copy \u2014 select and copy the link manually.'); });
  } else { showToast('Select and copy the link manually.'); }
}

function openReportSheet(presetAgency) {
  // Populate agency suggestions
  var dl = document.getElementById('r-agency-list');
  if (dl) dl.innerHTML = agenciesCache.map(function(a){ return '<option value="' + escapeHtml(a.name||'') + '">'; }).join('');
  document.getElementById('r-agency').value = presetAgency || '';
  document.getElementById('r-reason').selectedIndex = 0;
  document.getElementById('r-details').value = '';
  document.getElementById('r-contact').value = '';
  var err = document.getElementById('report-error');
  err.style.display = 'none'; err.textContent = '';
  document.getElementById('report-overlay').classList.add('open');
  renderTurnstile('report-turnstile', 'report-overlay');
}
async function submitReport() {
  var agencyName = document.getElementById('r-agency').value.trim();
  var reason = document.getElementById('r-reason').value;
  var details = document.getElementById('r-details').value.trim();
  var contact = document.getElementById('r-contact').value.trim();
  var err = document.getElementById('report-error');
  err.style.display = 'none'; err.textContent = '';
  if (!agencyName && !details) {
    err.textContent = 'Please tell us which agency or add some details.'; err.style.display = 'block'; return;
  }
  // Match agency to an id if possible
  var matched = agenciesCache.find(function(a){ return (a.name||'').toLowerCase() === agencyName.toLowerCase(); });
  var payload = {
    agency_name: agencyName,
    agency_id: matched ? matched.id : null,
    reason: reason,
    details: (details ? details : '') + (contact ? ' | Reporter contact: ' + contact : ''),
    status: 'open',
    user_id: saAuthUser ? saAuthUser.id : null
  };
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  // Primary path: Worker (Turnstile-gated DB insert + Resend email).
  var workerRes = await submitViaWorker('/api/submit/report', {
    agency_name: payload.agency_name,
    agency_id: payload.agency_id,
    reason: payload.reason,
    details: payload.details
  }, 'report-turnstile');
  var savedToDatabase = !!workerRes.ok;
  if (workerRes.ok) {
    console.log('report submitted via worker', workerRes.data && workerRes.data.email);
  } else {
    // Fallback: preserve the database submission if the Worker is unavailable.
    // Email notifications stay server-side through Resend only; never send
    // from the browser or fall back to a second email provider.
    var res = await submitReportToSupabase(payload);
    savedToDatabase = !!res.ok;
    if (!res.ok && !/row-level security|permission denied/i.test((res.error && res.error.message) || '')) {
      console.warn('report fallback also failed', res.error);
    }
  }
  // Local backup only when BOTH paths failed — otherwise the entry would
  // show up twice in My submissions (the Supabase row with its real status
  // plus this local copy marked Pending forever, since the created_at of
  // the DB row never matches this string exactly).
  if (!savedToDatabase) {
    var local = readLocalReports();
    payload.created_at = new Date().toISOString();
    payload._localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    local.push(payload);
    writeLocalReports(local);
  }
  resetTurnstile('report-turnstile');
  if (btn) { btn.disabled = false; btn.textContent = 'Submit report'; }
  closeSheet('report-overlay');
  // Build WhatsApp message and show confirmation sheet
  var waMsg = 'SA Recruiters — REPORT%0A%0A' +
    'Agency: ' + encodeURIComponent(payload.agency_name || '-') + '%0A' +
    'Reason: ' + encodeURIComponent(payload.reason || '-') + '%0A' +
    'Details: ' + encodeURIComponent(payload.details || '-');
  showWhatsAppConfirm(savedToDatabase ? {
    title: 'Report submitted \u2713',
    message: 'Your report has been saved. Tap below to send it to the admin on WhatsApp so it can be reviewed quickly.',
    waText: waMsg
  } : {
    // Neither the Worker nor the fallback reached the database — say so
    // instead of pretending it was saved. The copy stays on this device
    // (marked Pending in My submissions) and is retried automatically on
    // the next app load, but WhatsApp remains the fastest way through.
    title: 'Could not reach the admin',
    message: 'The report was not delivered just now (it stays saved on this device as Pending and will be retried automatically). Tap below to send it to the admin on WhatsApp so it isn\'t lost.',
    waText: waMsg
  });
}
// ===== MY SUBMISSIONS (read-only, signed-in user's own reports + suggestions) =====
// Mirrors openMyPoolProfile()'s pattern: query by the signed-in user's id and
// rely on the reports_select_own / suggestions_select_own RLS policies
// (added alongside user_id ownership — see the 20260919 migration) to scope
// the rows. Unlike the admin Submissions screen this has no status-toggle or
// delete controls — it's just visibility into what happened to what you sent.
async function openMySubmissions() {
  if (!saAuthUser) { showToast('Please sign in to view your submissions.'); return; }
  var list = document.getElementById('my-submissions-list');
  if (list) list.innerHTML = '<div class="empty-state"><h3>Loading your submissions…</h3></div>';
  document.getElementById('my-submissions-overlay').classList.add('open');
  var reportsRes, suggestionsRes;
  try {
    reportsRes = await supabaseClient.from('reports').select('*').eq('user_id', saAuthUser.id).order('created_at', { ascending: false });
    suggestionsRes = await supabaseClient.from('suggestions').select('*').eq('user_id', saAuthUser.id).order('created_at', { ascending: false });
  } catch(e) {
    console.error('my submissions load', e);
    if (list) list.innerHTML = '<div class="empty-state"><h3>Could not load your submissions</h3><p>Please try again.</p></div>';
    return;
  }
  var reports = (reportsRes && !reportsRes.error) ? (reportsRes.data || []).map(function(r){ return Object.assign({}, r, { _kind: 'report' }); }) : [];
  var suggestions = (suggestionsRes && !suggestionsRes.error) ? (suggestionsRes.data || []).map(function(s){ return Object.assign({}, s, { _kind: 'suggestion' }); }) : [];
  // Local-only backups (this browser's own submissions saved in case the
  // Supabase insert failed) — same composite-key dedup as the admin panel
  // (loadReportsFromSupabase/loadSuggestionsFromSupabase), since local
  // entries never carry the row's real id to compare directly. Only ones
  // NOT already reflected in the Supabase rows above are shown, flagged
  // "Pending" rather than silently duplicated or dropped.
  var seenKeys = {};
  reports.forEach(function(r){ seenKeys['r|' + (r.agency_name||'') + '|' + (r.reason||'') + '|' + (r.details||'') + '|' + (r.created_at||'')] = true; });
  suggestions.forEach(function(s){ seenKeys['s|' + (s.agency_name||'') + '|' + (s.type||'') + '|' + (s.details||'') + '|' + (s.created_at||'')] = true; });
  var localReports = readLocalReports().filter(function(r){
    var key = 'r|' + (r.agency_name||'') + '|' + (r.reason||'') + '|' + (r.details||'') + '|' + (r.created_at||'');
    return !seenKeys[key];
  }).map(function(r){ return Object.assign({}, r, { _kind: 'report', _pending: true }); });
  var localSuggestions = [];
  try {
    localSuggestions = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]').filter(function(s){
      var key = 's|' + (s.agency_name||'') + '|' + (s.type||'') + '|' + (s.details||'') + '|' + (s.created_at||'');
      return !seenKeys[key];
    }).map(function(s){ return Object.assign({}, s, { _kind: 'suggestion', _pending: true }); });
  } catch(e){}
  var all = reports.concat(suggestions, localReports, localSuggestions).sort(function(a, b) {
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  if (!list) return;
  if (!all.length) {
    list.innerHTML = '<div class="empty-state"><h3>No submissions yet</h3><p>Reports and suggestions you send will show up here.</p></div>';
    return;
  }
  list.innerHTML = all.map(function(item) {
    var isReport = item._kind === 'report';
    var iconClass = isReport ? 'report' : 'suggestion';
    var iconEmoji = isReport ? '⚠️' : '💡';
    var title = isReport ? (item.reason || 'Report') : (item.type || 'Suggestion');
    var agency = item.agency_name ? escapeHtml(item.agency_name) : '';
    var details = escapeHtml(item.details || '');
    var dateStr = item.created_at ? new Date(item.created_at).toLocaleString('en-ZA', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    var status = item.status || 'open';
    var statusClass = item._pending ? 'open' : (status === 'resolved' || status === 'closed' ? 'resolved' : 'open');
    var statusLabel = item._pending ? 'Pending' : (status === 'resolved' ? '✓ Resolved' : (status === 'closed' ? 'Closed' : 'Open'));
    var metaLine = agency ? 'Agency: ' + agency : '';
    if (dateStr) metaLine += (metaLine ? ' · ' : '') + dateStr;
    return '<div class="sub-card">' +
      '<div class="sub-card-head">' +
        '<div class="sub-card-icon ' + iconClass + '">' + iconEmoji + '</div>' +
        '<div class="sub-card-title">' + escapeHtml(title) + (metaLine ? '<div class="sub-card-meta">' + metaLine + '</div>' : '') + '</div>' +
      '</div>' +
      (details ? '<div class="sub-card-body">' + details + '</div>' : '') +
      '<div class="sub-card-actions"><span class="sub-status-pill ' + statusClass + '" style="cursor:default;">' + statusLabel + '</span></div>' +
    '</div>';
  }).join('');
}

function reportWhatsAppLink(p) {
  var msg = 'SA Recruiters report:%0A' +
    'Agency: ' + encodeURIComponent(p.agency_name || '-') + '%0A' +
    'Reason: ' + encodeURIComponent(p.reason || '-') + '%0A' +
    'Details: ' + encodeURIComponent(p.details || '-');
  return 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + msg;
}
function reportEmailLink(p) {
  var subj = encodeURIComponent('SA Recruiters report: ' + (p.agency_name || 'Listing'));
  var body = encodeURIComponent('Agency: ' + (p.agency_name||'-') + '\nReason: ' + (p.reason||'-') + '\nDetails: ' + (p.details||'-'));
  return 'mailto:' + ADMIN_EMAIL + '?subject=' + subj + '&body=' + body;
}

// ===== Suggestion / Comment =====
function openSuggestionSheet() {
  document.getElementById('s-type').selectedIndex = 0;
  document.getElementById('s-agency').value = '';
  document.getElementById('s-details').value = '';
  document.getElementById('s-contact').value = '';
  var err = document.getElementById('suggestion-error');
  err.style.display = 'none'; err.textContent = '';
  document.getElementById('suggestion-overlay').classList.add('open');
  renderTurnstile('suggestion-turnstile', 'suggestion-overlay');
}
async function submitSuggestion() {
  var type = document.getElementById('s-type').value;
  var agency = document.getElementById('s-agency').value.trim();
  var details = document.getElementById('s-details').value.trim();
  var contact = document.getElementById('s-contact').value.trim();
  var err = document.getElementById('suggestion-error');
  err.style.display = 'none'; err.textContent = '';
  if (!details && !agency) {
    err.textContent = 'Please add some details or an agency name.'; err.style.display = 'block'; return;
  }
  var payload = {
    type: type,
    agency_name: agency,
    details: (details ? details : '') + (contact ? ' | Contact: ' + contact : ''),
    status: 'open',
    user_id: saAuthUser ? saAuthUser.id : null
  };
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  // Primary path: Worker (Turnstile-gated DB insert + Resend email).
  var workerRes = await submitViaWorker('/api/submit/suggestion', {
    type: payload.type,
    agency_name: payload.agency_name,
    details: payload.details
  }, 'suggestion-turnstile');
  var savedToDatabase = !!workerRes.ok;
  if (workerRes.ok) {
    console.log('suggestion submitted via worker', workerRes.data && workerRes.data.email);
  } else {
    // Fallback: preserve the database submission if the Worker is unavailable.
    // Email notifications remain server-side through Resend only.
    var suggError = null;
    try {
      var { error } = await supabaseClient.from('suggestions').insert([payload]);
      suggError = error || null;
      if (error) console.warn('suggestion fallback insert', error);
    } catch(e){ suggError = e; }
    savedToDatabase = !suggError;
  }
  // Local fallback only when BOTH paths failed (see submitReport) — otherwise
  // My submissions shows the delivered item twice: the real row plus a local
  // Pending copy that never resolves.
  if (!savedToDatabase) {
    try {
      var localSugg = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]');
      payload.created_at = new Date().toISOString();
      payload._localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      localSugg.push(payload);
      localStorage.setItem('sa_suggestions_local', JSON.stringify(localSugg));
    } catch(e){}
  }
  resetTurnstile('suggestion-turnstile');
  if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
  closeSheet('suggestion-overlay');
  // Build WhatsApp message and show confirmation sheet
  var waMsg = 'SA Recruiters — ' + (payload.type ? payload.type.toUpperCase() : 'SUGGESTION') + '%0A%0A' +
    'Agency: ' + encodeURIComponent(payload.agency_name || '-') + '%0A' +
    'Details: ' + encodeURIComponent(payload.details || '-');
  showWhatsAppConfirm(savedToDatabase ? {
    title: 'Sent — thank you!',
    message: 'Your ' + (payload.type || 'suggestion') + ' has been saved. Tap below to send it to the admin on WhatsApp so it can be seen right away.',
    waText: waMsg
  } : {
    title: 'Could not reach the admin',
    message: 'The ' + (payload.type || 'suggestion') + ' was not delivered just now (it stays saved on this device as Pending and will be retried automatically). Tap below to send it to the admin on WhatsApp so it isn\'t lost.',
    waText: waMsg
  });
}

// ===== "POST A JOB" — public, ALWAYS-OPEN enquiry form =====
// FirstJobly-style lead capture (see firstjobly.co.za/post-a-job): unlike
// self-service vacancy posting / employer registration, this is never
// gated behind an admin "open/closed" flag — see
// public_submit_job_enquiry() (20260923_add_job_post_enquiries.sql) and
// /api/submit/job-enquiry in the Worker. The static /post-a-job/ page
// (generate-pages.js) posts to the same Worker endpoint independently of
// this in-app sheet.
function pjSelectedRoleTypes() {
  var group = document.getElementById('pj-role-types');
  if (!group) return [];
  return Array.prototype.slice.call(group.querySelectorAll('.role-pill.active')).map(function(b){ return b.textContent.trim(); });
}
function openPostJobSheet() {
  document.getElementById('pj-company').value = '';
  document.getElementById('pj-contact').value = '';
  document.getElementById('pj-email').value = '';
  document.getElementById('pj-phone').value = '';
  document.getElementById('pj-industry').value = '';
  document.getElementById('pj-positions').selectedIndex = 0;
  document.getElementById('pj-details').value = '';
  document.getElementById('pj-website').value = '';
  var group = document.getElementById('pj-role-types');
  if (group) group.querySelectorAll('.role-pill.active').forEach(function(b){ b.classList.remove('active'); });
  var err = document.getElementById('post-job-error');
  err.style.display = 'none'; err.textContent = '';
  var waLink = document.getElementById('post-job-wa-link');
  if (waLink) waLink.href = 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + encodeURIComponent("Hi, I'd like to post a job on SA Recruiters.");
  document.getElementById('post-job-overlay').classList.add('open');
  renderTurnstile('post-job-turnstile', 'post-job-overlay');
}
async function submitJobPostEnquiry() {
  var company = document.getElementById('pj-company').value.trim();
  var contact = document.getElementById('pj-contact').value.trim();
  var email = document.getElementById('pj-email').value.trim();
  var phone = document.getElementById('pj-phone').value.trim();
  var industry = document.getElementById('pj-industry').value.trim();
  var positions = document.getElementById('pj-positions').value;
  var roleTypes = pjSelectedRoleTypes();
  var details = document.getElementById('pj-details').value.trim();
  var website = document.getElementById('pj-website').value.trim();
  var err = document.getElementById('post-job-error');
  err.style.display = 'none'; err.textContent = '';
  if (!company || !email) {
    err.textContent = 'Add your company name and work email.'; err.style.display = 'block'; return;
  }
  var payload = {
    company_name: company, contact_person: contact, work_email: email, phone: phone,
    industry: industry, positions_to_fill: positions, role_types: roleTypes,
    additional_details: details, website: website
  };
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  var workerRes = await submitViaWorker('/api/submit/job-enquiry', payload, 'post-job-turnstile');
  if (!workerRes.ok) {
    // Never fall back to a direct Supabase insert here: that would bypass the
    // Worker-side Turnstile check and allow an attacker to flood enquiries.
    err.textContent = workerRes.error || 'Could not submit the enquiry. Please try again.';
    err.style.display = 'block';
    if (btn) { btn.disabled = false; btn.textContent = 'Submit for admin review'; }
    return;
  }
  var savedToDatabase = true;
  resetTurnstile('post-job-turnstile');
  if (btn) { btn.disabled = false; btn.textContent = 'Submit for admin review'; }
  closeSheet('post-job-overlay');
  showToast("Submitted for admin review — it will not be published until approved.");
}

// ===== TALENT POOL (public browse + self-registration) =====
var poolCache = [];
var poolLoaded = false;
var poolCandidateCount = 0;
var poolReturnScreen = 'home';
// Set by a Talent Pool spotlight card so the very next pool render can jump
// straight to (and expand) that candidate's profile instead of dropping the
// visitor on the generic, unfiltered Talent Pool list.
var poolPendingOpenId = null;

// Lightweight count-only query so the home "Pool Candidates" stat is accurate
// on first load, without waiting for the full candidate list (which only
// loads once someone actually opens the Talent Pool screen).
async function getPoolCandidateCount() {
  try {
    var startup = await getPublicPoolCandidatesFromWorker();
    if (startup && startup.counts && typeof startup.counts.candidates === 'number') return startup.counts.candidates;
    // Resilience fallback for a temporary Worker/D1 outage.
    var { count, error } = await supabaseClient.from('pool_candidates_public').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return typeof count === 'number' ? count : null;
  } catch(e) { console.warn('pool count load', e); return null; }
}

function goPool(returnScreen, openCandidateId) {
  poolReturnScreen = returnScreen === 'profile' || returnScreen === 'account' || (!returnScreen && document.getElementById('screen-account').classList.contains('active')) ? 'profile' : 'home';
  poolPendingOpenId = openCandidateId || null;
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-pool').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  loadPoolCandidates();
}
// Opens (expands) and scrolls to a specific candidate's card in the
// currently-rendered Talent Pool list, e.g. after tapping a spotlight card.
function openPoolCandidateCard(id) {
  if (!id) return;
  var card = document.querySelector('.pool-mini-card[data-candidate-id="' + CSS.escape(String(id)) + '"]');
  if (!card) return;
  card.classList.add('expanded');
  card.setAttribute('aria-expanded', 'true');
  setTimeout(function(){ card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150);
}

async function loadPoolCandidates() {
  var listEl = document.getElementById('pool-list');
  if (listEl && !poolLoaded) listEl.innerHTML = '<div class="empty"><div class="empty-state"><h3>Loading…</h3></div></div>';
  try {
    var startup = await getPublicPoolCandidatesFromWorker();
    var data = startup && Array.isArray(startup.pool_candidates) ? startup.pool_candidates : null;
    if (!data) {
      // Resilience fallback for a temporary Worker/D1 outage.
      var result = await supabaseClient.from('pool_candidates_public')
        .select('id,full_name,position,sector,location,experience_years,about_you,photo_url,verified,status,created_at')
        .order('created_at', { ascending: false });
      if (result.error) throw result.error;
      data = result.data || [];
    }
    poolCache = data.filter(function(c){ return (c.status || 'pending') === 'active'; }).sort(function(a,b){ return (b.verified?1:0) - (a.verified?1:0); });
  } catch(e) { console.error('pool load', e); poolCache = []; }
  poolLoaded = true;
  poolCandidateCount = poolCache.length;
  // Populate sector filter options from whatever is currently listed
  var sel = document.getElementById('pool-sector-filter');
  if (sel) {
    var current = sel.value;
    var sectors = Array.from(new Set(poolCache.map(function(c){ return (c.sector||'').trim(); }).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All sectors</option>' + sectors.map(function(s){ return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>'; }).join('');
    sel.value = sectors.indexOf(current) !== -1 ? current : '';  }
  // A spotlight card asked for a specific candidate -- clear any leftover
  // search/sector filter from a previous visit so that candidate is
  // guaranteed to be in the rendered list, then open their card.
  if (poolPendingOpenId) {
    var searchEl = document.getElementById('pool-search');
    if (searchEl) searchEl.value = '';
    if (sel) sel.value = '';
  }
  updateStats();
  renderPoolList();
  if (poolPendingOpenId) {
    var openId = poolPendingOpenId;
    poolPendingOpenId = null;
    openPoolCandidateCard(openId);
  }
}
function renderPoolList() {
  var listEl = document.getElementById('pool-list');
  if (!listEl) return;
  var q = ((document.getElementById('pool-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('pool', q);
  var sector = ((document.getElementById('pool-sector-filter')||{}).value || '');
  // Defense-in-depth: only approved/active candidates may ever be rendered publicly.
  var list = poolCache.filter(function(c){ return (c.status || 'pending') === 'active'; }).slice();
  if (sector) list = list.filter(function(c){ return (c.sector||'') === sector; });
  if (q) {
    list = list.filter(function(c){
      var hay = ((c.full_name||'') + ' ' + (c.position||'') + ' ' + (c.location||'') + ' ' + (c.sector||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!list.length) {
    listEl.innerHTML = '<div class="empty"><div class="empty-state"><h3>No candidates yet</h3><p>Be the first to join the Talent Pool.</p></div></div>';
    return;
  }
  listEl.innerHTML = list.map(function(c){
    var sub = [c.position, c.sector, c.location].filter(Boolean).join(' · ');
    var frontBits = [];
    if (c.position) frontBits.push(escapeHtml(c.position));
    if (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '') frontBits.push((c.experience_years >= 10 ? '10+' : c.experience_years) + ' yrs');
    if (c.location) frontBits.push(escapeHtml(c.location));
    var detailBits = [];
    function detail(label, value){ if(value !== null && value !== undefined && String(value).trim() !== '') detailBits.push('<div class="det-row"><span class="det-label">'+label+':</span> '+escapeHtml(value)+'</div>'); }
    if (c.verified) detailBits.push('<div class="det-row mini-cv-pitch"><span class="verified-check" title="Screened & Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span> Screened &amp; Verified — information confirmed by SA Recruiters</div>');
    detail('Sector', c.sector); detail('Location', c.location);
    if (c.experience_years !== null && c.experience_years !== undefined && c.experience_years !== '') detail('Years of experience', (c.experience_years >= 10 ? '10+' : c.experience_years) + ' years');
    if (c.about_you) detailBits.push('<div class="det-row mini-cv-pitch"><span class="det-label">About me:</span> '+escapeHtml(c.about_you)+'</div>');
    // Full contact details (phone, email, CV) are admin-only — see
    // CREATE_POOL_PUBLIC_ACCESS.sql. Interested employers go through
    // SA Recruiters on WhatsApp rather than contacting candidates directly.
    detailBits.push('<div class="det-row pool-contact-row"><a class="pool-whatsapp-btn" href="'+poolCandidateWhatsAppLink(c)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.2 14.8l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0 1 12 4z"/></svg> Interested? Contact SA Recruiters</a></div>');
    return '<div class="manager-item pool-mini-card'+(c.photo_url ? ' has-photo' : '')+'" data-candidate-id="'+escapeHtml(c.id)+'" onclick="togglePoolCard(this)" role="button" tabindex="0" aria-expanded="false" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){togglePoolCard(this)}">' +
      (c.photo_url ? '<div class="avatar pool-mini-avatar"><img src="'+escapeHtml(c.photo_url)+'" loading="lazy" alt=""></div>' : '<div class="avatar">'+initials(c.full_name)+'</div>') +
      '<div class="manager-item-title">'+escapeHtml(c.full_name||'Candidate')+(c.verified?' <span class="verified-check" title="Screened & Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>':'')+'</div>' +
      '<div class="manager-item-sub">'+(frontBits.length ? frontBits.join(' · ') : 'Profile details available')+'</div>' +
      '<div class="row-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></div>' +
      '<div class="row-details pool-mini-details">'+(detailBits.length ? detailBits.join('') : '<div class="det-row muted">No additional profile details</div>')+'</div>' +
      '</div>';
  }).join('');
}

// Full candidate contact details are admin-only (see
// CREATE_POOL_PUBLIC_ACCESS.sql) — an interested employer messages SA
// Recruiters on WhatsApp with the candidate's name/position/id, and the
// team makes the introduction directly rather than exposing phone or
// email addresses in the app.
function poolCandidateWhatsAppLink(c) {
  var msg = 'Hi SA Recruiters, I\'m interested in this Talent Pool candidate:\n' +
    (c.full_name || 'Candidate') + (c.position ? ' — ' + c.position : '') +
    (c.location ? ' (' + c.location + ')' : '') +
    '\nCandidate ID: ' + (c.id || '') +
    '\nCould you please share their contact details or help set up an introduction?';
  return 'https://wa.me/' + ADMIN_WHATSAPP + '?text=' + encodeURIComponent(msg);
}

// Talent Pool "profile" state for the currently signed-in user. null = the
// register sheet is being used to create a brand-new candidate; a candidate
// id = the sheet is editing (and will UPDATE, not INSERT) that owned row.
var editingPoolCandidateId = null;

function setPoolSheetEditMode(isEdit) {
  var title = document.getElementById('pool-register-title');
  if (title) title.textContent = isEdit ? 'My Talent Pool Profile' : 'Join the Talent Pool';
  var submitBtn = document.getElementById('pool-submit-btn');
  if (submitBtn) submitBtn.textContent = isEdit ? 'Save changes' : 'Submit registration';
  var deleteBtn = document.getElementById('pool-delete-btn');
  if (deleteBtn) deleteBtn.style.display = isEdit ? 'block' : 'none';
  // New joiners land on a quick, minimal form — the optional Mini-CV
  // section starts collapsed so signing up feels fast. Editing an existing
  // profile opens it straight away since that's the whole point of coming
  // back here.
  var miniCv = document.getElementById('pool-minicv-details');
  if (miniCv) miniCv.open = !!isEdit;
  var laterNote = document.getElementById('pool-finish-later-note');
  if (laterNote) laterNote.style.display = isEdit ? 'none' : 'block';
}

function openPoolRegisterSheet() {
  // Talent Pool membership is a step that comes AFTER the general account:
  // guests are pointed to the account screen's free sign-in card first.
  if (!saAuthUser) {
    showToast('Create your free account first — then join the Talent Pool.');
    openAccountScreen();
    return;
  }
  editingPoolCandidateId = null;
  setPoolSheetEditMode(false);
  document.getElementById('pool-name').value = '';
  window.pendingPoolPhotoBlob = null;
  var poolPreview = document.getElementById('pool-photo-preview');
  var poolFallback = document.getElementById('pool-photo-fallback');
  if (poolPreview) { poolPreview.style.display = 'none'; poolPreview.src = ''; }
  if (poolFallback) poolFallback.style.display = 'flex';
  document.getElementById('pool-phone').value = '';
  document.getElementById('pool-email').value = '';
  document.getElementById('pool-sector').value = '';
  document.getElementById('pool-position').value = '';
  document.getElementById('pool-location').value = '';
  document.getElementById('pool-gender').value = '';
  document.getElementById('pool-grade12').value = '';
  document.getElementById('pool-criminal').value = '';
  document.getElementById('pool-experience').value = '';
  document.getElementById('pool-qualification').value = '';
  document.getElementById('pool-drivers-license').value = '';
  document.getElementById('pool-transport').value = '';
  document.getElementById('pool-relocate').value = '';
  document.getElementById('pool-availability').value = '';
  document.getElementById('pool-employment').value = '';
  document.getElementById('pool-salary').value = '';
  document.getElementById('pool-work-authorized').value = '';
  document.getElementById('pool-about').value = '';
  document.getElementById('pool-cv').value = '';
  var alertOptIn = document.getElementById('pool-email-alerts');
  if (alertOptIn) alertOptIn.checked = false;
  document.getElementById('pool-register-overlay').classList.add('open');
}

// Fills the same register-sheet fields from an existing pool_candidates row
// (used when a signed-in user opens "My Talent Pool Profile").
function fillPoolFormFromCandidate(c) {
  document.getElementById('pool-name').value = c.full_name || '';
  window.pendingPoolPhotoBlob = null;
  var poolPreview = document.getElementById('pool-photo-preview');
  var poolFallback = document.getElementById('pool-photo-fallback');
  if (c.photo_url) {
    if (poolPreview) { poolPreview.src = c.photo_url; poolPreview.style.display = 'block'; }
    if (poolFallback) poolFallback.style.display = 'none';
  } else {
    if (poolPreview) { poolPreview.style.display = 'none'; poolPreview.src = ''; }
    if (poolFallback) poolFallback.style.display = 'flex';
  }
  document.getElementById('pool-phone').value = c.contact_phone || '';
  document.getElementById('pool-email').value = c.contact_email || '';
  document.getElementById('pool-sector').value = c.sector || '';
  document.getElementById('pool-position').value = c.position || '';
  document.getElementById('pool-location').value = c.location || '';
  document.getElementById('pool-gender').value = c.gender || '';
  document.getElementById('pool-grade12').value = c.grade12 || '';
  document.getElementById('pool-criminal').value = c.criminal_record || '';
  document.getElementById('pool-experience').value = (c.experience_years !== null && c.experience_years !== undefined) ? String(c.experience_years) : '';
  document.getElementById('pool-qualification').value = c.qualification || '';
  document.getElementById('pool-drivers-license').value = c.drivers_license || '';
  document.getElementById('pool-transport').value = c.reliable_transport || '';
  document.getElementById('pool-relocate').value = c.willing_relocate || '';
  document.getElementById('pool-availability').value = c.availability || '';
  document.getElementById('pool-employment').value = c.preferred_employment || '';
  document.getElementById('pool-salary').value = c.salary_expectation || '';
  document.getElementById('pool-work-authorized').value = c.work_authorized || '';
  var aboutEl = document.getElementById('pool-about');
  if (aboutEl) { aboutEl.value = c.about_you || ''; aboutEl.dispatchEvent(new Event('input')); }
  document.getElementById('pool-cv').value = c.cv_link || '';
  var alertOptIn = document.getElementById('pool-email-alerts');
  if (alertOptIn) alertOptIn.checked = !!c.email_alert_opt_in;
}

// Entry point for "My Talent Pool Profile" (site menu + Talent Pool screen).
// Loads the row linked to the signed-in user (via pool_candidates.user_id +
// the pool_select_own RLS policy added alongside candidate self-service) and
// opens it in the same register sheet, in edit mode. If nothing is linked
// yet, opens a blank registration pre-filled with the Google name/email —
// submitting it will auto-link (not duplicate) a matching pre-sign-in
// registration if the typed email + phone match one (see submitPoolRegistration).
async function openMyPoolProfile() {
  if (!saAuthUser) { showToast('Please sign in to manage your Talent Pool profile.'); return; }
  var result;
  try {
    result = await supabaseClient.from('pool_candidates').select('*').eq('user_id', saAuthUser.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  } catch(e) { console.error('my pool profile load', e); showToast('Could not load your profile — please try again.'); return; }
  if (result.error) { console.error('my pool profile load', result.error); showToast('Could not load your profile — please try again.'); return; }
  if (result.data) {
    fillPoolFormFromCandidate(result.data);
    editingPoolCandidateId = result.data.id;
    setPoolSheetEditMode(true);
    document.getElementById('pool-register-overlay').classList.add('open');
  } else {
    openPoolRegisterSheet();
    var nameEl = document.getElementById('pool-name');
    var emailEl = document.getElementById('pool-email');
    var meta = saAuthUser.user_metadata || {};
    if (nameEl && !nameEl.value) nameEl.value = meta.full_name || meta.name || '';
    if (emailEl && !emailEl.value) emailEl.value = saAuthUser.email || '';
    showToast('No linked profile yet — already registered before signing in? Enter the same email and phone you used, and it\u2019ll link automatically.');
  }
}

// ===== Mandatory Talent Pool profile gate =====
// Called once per sign-in (see startAuthenticatedApp's onAuthStateChange
// handler in app-core.js) right after a Google session is established.
// Skipped entirely for employer/agency manager-link visitors, who never
// sign in with Google at all (window.__saManagerLinkMode). A signed-in user
// with no linked pool_candidates row gets the Talent Pool registration
// sheet forced open with its close button hidden (.gate-mandatory) until
// they submit — closeSheet() above strips that class the moment a
// successful submit/claim/link path calls it.
async function enforceTalentPoolProfile() {
  if (!saAuthUser || (typeof __saManagerLinkMode !== 'undefined' && __saManagerLinkMode)) return;
  // Never force SA Recruiters' own admin account (signing into the public
  // site with the same Google login) through candidate profile registration.
  try { if (typeof canTrackPublicTraffic === 'function' && !(await canTrackPublicTraffic())) return; } catch(e) {}
  var result;
  try {
    result = await supabaseClient.from('pool_candidates').select('id').eq('user_id', saAuthUser.id).limit(1).maybeSingle();
  } catch(e) { console.error('profile gate check', e); return; } // fail open — never lock someone out over a network blip
  if (result.error) { console.error('profile gate check', result.error); return; }
  if (result.data) return; // already has a linked profile — nothing to enforce
  openPoolRegisterSheet();
  var nameEl = document.getElementById('pool-name');
  var emailEl = document.getElementById('pool-email');
  var meta = saAuthUser.user_metadata || {};
  if (nameEl && !nameEl.value) nameEl.value = meta.full_name || meta.name || '';
  if (emailEl && !emailEl.value) emailEl.value = saAuthUser.email || '';
  var overlay = document.getElementById('pool-register-overlay');
  if (overlay) overlay.classList.add('gate-mandatory');
  var title = document.getElementById('pool-register-title');
  if (title) title.textContent = 'One last step — complete your profile';
  showToast('Please complete your Talent Pool profile to start using SA Recruiters.');
}

async function deleteMyPoolProfile() {
  if (!editingPoolCandidateId) return;
  if (!confirm('Remove your Talent Pool profile? This can\u2019t be undone.')) return;
  var deleteBtn = document.getElementById('pool-delete-btn');
  if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.textContent = 'Removing…'; }
  try {
    var result = await supabaseClient.from('pool_candidates').delete().eq('id', editingPoolCandidateId);
    if (result.error) { console.error('pool self delete', result.error); showToast('Could not remove your profile — please try again.'); if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Remove my profile'; } return; }
  } catch(e) { console.error('pool self delete', e); showToast('Could not remove your profile — please try again.'); if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Remove my profile'; } return; }
  if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Remove my profile'; }
  editingPoolCandidateId = null;
  try { localStorage.removeItem('sa_gate_registration_pending'); } catch(e){}
  closeSheet('pool-register-overlay');
  showToast('Your Talent Pool profile has been removed.');
  poolLoaded = false; // force a fresh load next time the list is viewed
}



// Builds the RPC-shaped field object shared by the edit-save path and the
// claim-and-update path (both push the sheet's current values into an owned
// row via candidate_update_own_profile, just for a different candidate id).
function poolFormToProfileFields() {
  return {
    p_full_name: document.getElementById('pool-name').value.trim(),
    p_contact_phone: document.getElementById('pool-phone').value.trim(),
    p_contact_email: document.getElementById('pool-email').value.trim(),
    p_sector: document.getElementById('pool-sector').value.trim(),
    p_position: document.getElementById('pool-position').value.trim(),
    p_location: document.getElementById('pool-location').value.trim(),
    p_gender: document.getElementById('pool-gender').value,
    p_grade12: document.getElementById('pool-grade12').value,
    p_criminal_record: document.getElementById('pool-criminal').value,
    p_experience_years: parseInt(document.getElementById('pool-experience').value, 10),
    p_qualification: document.getElementById('pool-qualification').value.trim(),
    p_drivers_license: document.getElementById('pool-drivers-license').value,
    p_reliable_transport: document.getElementById('pool-transport').value,
    p_willing_relocate: document.getElementById('pool-relocate').value,
    p_availability: document.getElementById('pool-availability').value.trim(),
    p_preferred_employment: document.getElementById('pool-employment').value,
    p_salary_expectation: document.getElementById('pool-salary').value.trim(),
    p_work_authorized: document.getElementById('pool-work-authorized').value,
    p_about_you: document.getElementById('pool-about').value.trim().slice(0, 150),
    p_cv_link: document.getElementById('pool-cv').value.trim(),
    p_email_alert_opt_in: !!(document.getElementById('pool-email-alerts') && document.getElementById('pool-email-alerts').checked)
  };
}

async function submitPoolRegistration() {
  var name = document.getElementById('pool-name').value.trim();
  var phone = document.getElementById('pool-phone').value.trim();
  var sector = document.getElementById('pool-sector').value.trim();
  var location = document.getElementById('pool-location').value.trim();
  var gender = document.getElementById('pool-gender').value;
  var grade12 = document.getElementById('pool-grade12').value;
  var criminal = document.getElementById('pool-criminal').value;
  var experience = document.getElementById('pool-experience').value;
  var email = document.getElementById('pool-email').value.trim();
  var alertOptIn = !!(document.getElementById('pool-email-alerts') && document.getElementById('pool-email-alerts').checked);
  if (!name || !phone || !email || !sector || !location) { showToast('Please fill in name, email, phone, sector and location. Email is used for cross-device Talent Pool verification.'); return; }
  if (alertOptIn && !email) { showToast('Add your email address to receive vacancy alerts.'); return; }
  if (!gender || !grade12 || !criminal || experience === '') { showToast('Please answer gender, Grade 12, criminal record and experience.'); return; }

  var btn = document.getElementById('pool-submit-btn');
  var defaultBtnLabel = editingPoolCandidateId ? 'Save changes' : 'Submit registration';

  // ----- Editing an owned row: update in place via the self-service RPC. -----
  if (editingPoolCandidateId) {
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var editPhotoUrl = await uploadPoolPhotoIfAny();
    var editFields = poolFormToProfileFields();
    editFields.p_id = editingPoolCandidateId;
    editFields.p_photo_url = editPhotoUrl || null;
    var editResult;
    try { editResult = await supabaseClient.rpc('candidate_update_own_profile', editFields); }
    catch(e) { console.error('pool self update', e); showToast('Could not save — please try again.'); if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; } return; }
    if (editResult.error || editResult.data !== true) { console.error('pool self update', editResult.error); showToast('Could not save — please try again.'); if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; } return; }
    if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; }
    closeSheet('pool-register-overlay');
    showToast('Your Talent Pool profile has been updated.');
    poolLoaded = false; // force a fresh load next time the list is viewed
    return;
  }

  // ----- New registration: a user re-entering details on a fresh device
  // may already be a verified member — register nothing, just mark the
  // device and send them to sign-in (prevents duplicate rows).
  var alreadyMember = await verifyTalentPoolMembership(phone, email, true);
  if (alreadyMember) {
    try { localStorage.setItem('sa_gate_registration_pending', 'linked'); } catch(e){}
    // Signed-in already (e.g. re-entering matching details to clear the
    // mandatory profile gate): link this verified row to the account now,
    // rather than leaving user_id unset and re-showing the gate next visit.
    if (saAuthUser) {
      try { await supabaseClient.rpc('candidate_claim_profile', { p_email: email, p_phone: phone }); }
      catch(e) { console.warn('candidate claim on already-member', e); }
      closeSheet('pool-register-overlay');
      showToast('You are already registered — your account is now linked.');
      return;
    }
    closeSheet('pool-register-overlay');
    showToast('You are already registered — create your free account on the Profile tab to continue.');
    return;
  }

  // ----- New registration: first check whether this is really a pre-Google-
  // sign-in row belonging to this account (matched by email + phone). If so,
  // link it and save the just-typed values into it instead of inserting a
  // duplicate candidate. -----
  if (saAuthUser) {
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    try {
      var claim = await supabaseClient.rpc('candidate_claim_profile', { p_email: email, p_phone: phone });
      if (!claim.error && claim.data) {
        var claimPhotoUrl = await uploadPoolPhotoIfAny();
        var claimFields = poolFormToProfileFields();
        claimFields.p_id = claim.data;
        claimFields.p_photo_url = claimPhotoUrl || null;
        var claimUpdate = await supabaseClient.rpc('candidate_update_own_profile', claimFields);
        if (claimUpdate.error) console.error('pool claim update', claimUpdate.error);
        if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; }
        rememberTalentPoolIdentity(phone, email);
        verifyTalentPoolMembership(phone, email, true);
        closeSheet('pool-register-overlay');
        showToast('Found your existing registration and linked it to your account.');
        return;
      }
    } catch(e) { console.warn('candidate claim check', e); }
  }

  var payload = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    user_id: saAuthUser ? saAuthUser.id : null,
    full_name: name,
    contact_phone: phone,
    contact_email: email,
    sector: sector,
    email_alert_opt_in: alertOptIn,
    alert_sectors: sector,
    alert_locations: location,
    alert_consent_at: alertOptIn ? new Date().toISOString() : null,
    alert_unsubscribe_token: alertOptIn ? ('u_' + Date.now().toString(36) + Math.random().toString(36).slice(2)) : null,
    position: document.getElementById('pool-position').value.trim(),
    location: location,
    gender: gender,
    grade12: grade12,
    criminal_record: criminal,
    experience_years: parseInt(experience, 10),
    qualification: document.getElementById('pool-qualification').value.trim(),
    drivers_license: document.getElementById('pool-drivers-license').value,
    reliable_transport: document.getElementById('pool-transport').value,
    willing_relocate: document.getElementById('pool-relocate').value,
    availability: document.getElementById('pool-availability').value.trim(),
    preferred_employment: document.getElementById('pool-employment').value,
    salary_expectation: document.getElementById('pool-salary').value.trim(),
    work_authorized: document.getElementById('pool-work-authorized').value,
    about_you: document.getElementById('pool-about').value.trim().slice(0, 150),
    cv_link: document.getElementById('pool-cv').value.trim(),
    status: 'pending'
  };
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  var photoUrl = await uploadPoolPhotoIfAny();
  if (photoUrl) payload.photo_url = photoUrl;
  try {
    var result = await supabaseClient.from('pool_candidates').insert([payload]);
    if (result.error && photoUrl && /column|schema cache/i.test(result.error.message || '')) {
      // photo_url column not added yet (CREATE_POOL_PHOTOS.sql not run) —
      // retry without it so registration still succeeds.
      delete payload.photo_url;
      result = await supabaseClient.from('pool_candidates').insert([payload]);
    }
    if (result.error && /column|schema cache/i.test(result.error.message || '')) {
      // Keep registration working on older databases until CREATE_EMAIL_ALERTS.sql
      // has been run; alert consent becomes active after the schema is updated.
      var legacyPayload = Object.assign({}, payload);
      delete legacyPayload.email_alert_opt_in;
      delete legacyPayload.alert_sectors;
      delete legacyPayload.alert_locations;
      delete legacyPayload.alert_consent_at;
      delete legacyPayload.alert_unsubscribe_token;
      delete legacyPayload.qualification;
      delete legacyPayload.drivers_license;
      delete legacyPayload.reliable_transport;
      delete legacyPayload.willing_relocate;
      delete legacyPayload.availability;
      delete legacyPayload.preferred_employment;
      delete legacyPayload.salary_expectation;
      delete legacyPayload.work_authorized;
      delete legacyPayload.about_you;
      result = await supabaseClient.from('pool_candidates').insert([legacyPayload]);
      if (!result.error) showToast('Registration received — email alerts activate after the alert setup is completed.');
    }
    if (result.error) { console.error('pool submit', result.error); showToast('Could not submit — please try again.'); if (btn){ btn.disabled=false; btn.textContent=defaultBtnLabel; } return; }
  } catch(e) { console.error('pool submit', e); showToast('Could not submit — please try again.'); if (btn){ btn.disabled=false; btn.textContent=defaultBtnLabel; } return; }
  if (btn) { btn.disabled = false; btn.textContent = defaultBtnLabel; }
  rememberTalentPoolIdentity(phone, email);
  try { localStorage.setItem('sa_gate_registration_pending', 'pending'); } catch(e){}
  verifyTalentPoolMembership(phone, email, true);
  trackEvent('candidate_registration_submitted', 'candidate', null, { alert_opt_in: alertOptIn });
  closeSheet('pool-register-overlay');
  showToast('Registration received — you\'ll go live once it\'s reviewed.');
}

function copyText(text, el) {
  var done = function() {
    var original = el.querySelector('.hub-contact-value').textContent;
    el.querySelector('.hub-contact-value').textContent = 'Copied ✓';
    setTimeout(function(){ el.querySelector('.hub-contact-value').textContent = original; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(function(){ prompt('Copy this:', text); }); }
  else { prompt('Copy this:', text); }
}

/* SECTION_CONTENT + openContentSheet now live in content.js / content-manager.js
   (admin-editable article system). */

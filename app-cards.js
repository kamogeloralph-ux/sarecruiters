/*
 * SA Recruiters -- app.js split 3/8: app-cards.js
 * Hub cards (agency/employer), talent pool access gating, search screen, vacancy card rendering
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

// ===== Hub card (agency) =====
function avatarHtml(a) {
  if (a.photo) return '<div class="avatar"><img src="' + a.photo + '" alt="" loading="lazy" width="42" height="42"></div>';
  return '<div class="avatar">' + initials(a.name) + '</div>';
}

function hubCard(a) {
  var bCount = branchesFor(a.id).length;
  var headOfficeLocation = (a.location || a.address || '').trim();
  var verifiedCheck = a.verified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
  // Compact notification-style badge showing the agency's branch count.
  var branchBadge = bCount > 0 ? hubCountBadge(VAC_ICONS.pin, bCount, 'branch') : '';
  return '' +
  '<div class="hub-card" id="hub-' + a.id + '">' +
    '<button class="hub-summary" data-ripple onclick="toggleHub(\'' + a.id + '\')" aria-expanded="false">' +
      avatarHtml(a) +
      '<div class="hub-summary-body">' +
        '<div class="agency-name-row">' + verifiedCheck + '<span class="agency-name">' + escapeHtml(a.name || 'Unnamed agency') + '</span></div>' +
        (headOfficeLocation ? '<div class="hub-summary-desc hub-head-office-location">' + VAC_ICONS.pin + '<span>' + escapeHtml(headOfficeLocation) + '</span></div>' : '') +
      '</div>' +
      branchBadge +
      '<span class="chevron">' + ICON_CHEVRON + '</span>' +
    '</button>' +
    '<div class="hub-panel" id="hub-panel-' + a.id + '">' +
      '<div class="hub-panel-inner">' +
        '<div class="hub-listing-row">' +
          '<a href="agency/' + publicAgencySlug(a) + '/" target="_blank" rel="noopener" class="hub-listing-link" onclick="event.stopPropagation()">View public listing page ↗</a>' +
          '<button class="hub-share-btn" onclick="event.stopPropagation();shareAgency(\'' + a.id + '\')" aria-label="Share agency">' + SHARE_SVG + '<span>Share</span></button>' +
        '</div>' +
        '<div class="hub-tabs">' +
          '<button class="hub-tab active" data-ripple onclick="switchHubTab(this,\'' + a.id + '\',\'vacancies\')">Vacancies</button>' +
          '<button class="hub-tab" data-ripple onclick="switchHubTab(this,\'' + a.id + '\',\'branches\')">Branches</button>' +
          '<button class="hub-tab" data-ripple onclick="switchHubTab(this,\'' + a.id + '\',\'contact\')">Contact</button>' +
        '</div>' +
        '<div class="hub-tab-content" data-agency="' + a.id + '">' + hubVacancies(a) + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function hubVacancies(a) {
  var list = vacanciesFor(a.id);
  var html = '<div class="hub-list" style="padding:4px 0;">';
  if (!list.length) {
    html += '<div style="font-size:12.5px;color:var(--text-2);padding:8px 2px;">No vacancies listed right now.</div>';
  } else {
    list.forEach(function(v) {
      /* Use the new expandable vacancy card (agency vacancies show the agency photo) */
      html += vacancyCard(v, a);
      if (isAdmin) {
        html += '<div style="text-align:right;margin:-4px 0 10px;"><button class="hub-row-del" data-ripple onclick="deleteVacancy(\'' + v.id + '\',\'' + a.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>';
      }
    });
  }
  html += '</div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openVacancySheet(\'' + a.id + '\')">+ Add vacancy</button></div>';
  }
  return html;
}

function hubBranches(a) {
  var list = branchesFor(a.id);
  var html = '';
  if (!list.length) {
    html += '<div style="font-size:12.5px;color:var(--text-2);padding:8px 2px;">No branches listed yet.</div>';
  } else {
    list.forEach(function(b) {
      var bid = 'hb-' + a.id + '-' + b.id;
      /* Collapsed: name + location only, Indeed-style. Tap to reveal contact details. */
      html += '<div class="branch-block" id="' + bid + '">';
      html += '<div class="branch-block-head" onclick="toggleBranchBlock(\'' + bid + '\')">' +
        '<div class="hub-contact-body">' +
          '<div class="hub-contact-value">' + escapeHtml(b.name || 'Branch') + '</div>' +
          (b.location ? '<div class="branch-sub">' + VAC_ICONS.pin + escapeHtml(b.location) + '</div>' : '') +
        '</div>' +
        (isAdmin ? '<div class="branch-block-actions">' +
          '<button class="hub-row-edit" data-ripple title="Edit branch" onclick="event.stopPropagation();openBranchSheet(\'' + a.id + '\',\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>' +
          '<button class="hub-row-del" data-ripple title="Delete branch" onclick="event.stopPropagation();deleteBranch(\'' + b.id + '\',\'' + a.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' : '') +
        '<span class="chevron">' + ICON_CHEVRON + '</span>' +
      '</div>';
      /* Expanded: plain labeled rows, matching the agency contact tab */
      html += '<div class="branch-detail"><div class="branch-detail-inner"><div class="det-plain">';
      if (b.location) {
        html += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(b.location) + '</div>';
      }
      if (b.phone) {
        html += '<div class="det-row"><span class="det-label">Phone:</span> ' + telLink(b.phone) + '</div>';
      }
      if (b.email) {
        html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(b.email) + '</div>';
      }
      html += '</div></div></div>'; // close det-plain, branch-detail-inner, branch-detail
      html += '</div>'; // close branch-block
    });
  }
  if (isAdmin) {
    html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openBranchSheet(\'' + a.id + '\')">+ Add branch</button></div>';
  }
  return html;
}

function hubContact(a) {
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  var html = '<div class="det-plain">';
  var headOfficeAddress = a.address || a.location || '';
  var pref = (a.cvpref || '').trim();
  if (pref) html += '<div class="det-row"><span class="det-label">Preferred contact:</span> <span class="hub-contact-preferred">' + (prefIcon(pref) || ICON_SEND) + escapeHtml(pref) + '</span></div>';
  if (a.contact) html += '<div class="det-row"><span class="det-label">Contact:</span> ' + telLink(a.contact) + '</div>';
  if (a.email) html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(a.email) + '</div>';
  if (a.website) html += '<div class="det-row"><span class="det-label">Website:</span> ' + webLink(a.website) + '</div>';
  if (headOfficeAddress) html += '<div class="det-row"><span class="det-label">Head office address:</span> ' + mapsLink(headOfficeAddress) + '</div>';
  if (a.companies) html += '<div class="det-row"><span class="det-label">Companies:</span> ' + escapeHtml(a.companies) + '</div>';
  if (a.trades) html += '<div class="det-row"><span class="det-label">Trades:</span> ' + escapeHtml(a.trades) + '</div>';
  if (html === '<div class="det-plain">') html += '<div class="det-row muted">No additional details</div>';
  html += '</div>';
  // Always show a "report" link so users can flag wrong info
  html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openReportSheet(\'' + (a.name||'').replace(/'/g,"\\'") + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-3px;margin-right:5px"><path d="M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>Report wrong info</button></div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row" style="margin-top:8px;">' +
      '<button class="hub-add-btn" data-ripple onclick="openForm(\'' + a.id + '\')">Edit agency</button>' +
      '<button class="btn-ghost-danger" data-ripple onclick="deleteAgencyById(\'' + a.id + '\')" style="flex-shrink:0;">Delete</button>' +
    '</div>';
  }
  return html;
}

function hubCountBadge(icon, count, noun) {
  var label = count + ' ' + noun + (count === 1 ? '' : noun === 'branch' ? 'es' : 's');
  var employerClass = noun === 'job' ? ' hub-employer-count' : '';
  return '<span class="hub-branch-badge' + employerClass + '" title="' + label + '" aria-label="' + label + '"><span class="hub-branch-pin" aria-hidden="true">' + icon + '</span><span>' + count + '</span></span>';
}

// ===== Hub card (employer) =====
// Same visual structure as the agency hub card, but scoped to employers:
// employers only ever appear in the Employers section, and posting a
// vacancy from here tags it with employer_id so it also shows in the
// main Vacancies list/section.
function employerHubCard(e) {
  var vCount = vacanciesForEmployer(e.id).length;
  var verifiedCheck = e.verified ? '<span class="verified-check" title="Verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';
  var jobsBadge = vCount > 0 ? hubCountBadge('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>', vCount, 'job') : '';
  return '' +
  '<div class="hub-card" id="emphub-' + e.id + '">' +
    '<button class="hub-summary" data-ripple onclick="toggleEmpHub(\'' + e.id + '\')" aria-expanded="false">' +
      avatarHtml(e) +
      '<div class="hub-summary-body">' +
        '<div class="agency-name-row">' + verifiedCheck + '<span class="agency-name">' + escapeHtml(e.name || 'Unnamed company') + '</span></div>' +
        (e.industry ? '<div class="hub-summary-desc"><span style="color:var(--text);font-weight:600">Industry:</span> ' + escapeHtml(e.industry) + '</div>' : (e.location ? '<div class="hub-summary-desc"><span style="color:var(--text);font-weight:600">Location:</span> ' + escapeHtml(e.location) + '</div>' : '')) +
      '</div>' +
      jobsBadge +
      '<span class="chevron">' + ICON_CHEVRON + '</span>' +
    '</button>' +
    '<div class="hub-panel" id="emphub-panel-' + e.id + '">' +
      '<div class="hub-panel-inner">' +
        '<div class="hub-tabs">' +
          '<button class="hub-tab active" data-ripple onclick="switchEmpHubTab(this,\'' + e.id + '\',\'vacancies\')">Vacancies</button>' +
          '<button class="hub-tab" data-ripple onclick="switchEmpHubTab(this,\'' + e.id + '\',\'contact\')">Contact</button>' +
        '</div>' +
        '<div class="hub-tab-content" data-employer="' + e.id + '">' + employerHubVacancies(e) + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function employerHubVacancies(e) {
  var list = vacanciesForEmployer(e.id);
  var html = '<div class="hub-list" data-vacancy-state="' + (list.length ? 'ready' : 'empty') + '" style="padding:4px 0;">';
  if (!list.length) {
    html += vacancyScreenStateMarkup('employer', false, false);
  } else {
    list.forEach(function(v) {
      html += vacancyCard(v, {});
      if (isAdmin) {
        html += '<div style="text-align:right;margin:-4px 0 10px;"><button class="hub-row-del" data-ripple onclick="deleteGeneralVacancy(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>';
      }
    });
  }
  html += '</div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row"><button class="hub-add-btn" data-ripple onclick="openEmployerVacancySheet(\'' + e.id + '\')">+ Post vacancy</button></div>';
  }
  return html;
}

function employerHubContact(e) {
  var html = '<div class="det-plain">';
  if (e.contact) html += '<div class="det-row"><span class="det-label">Contact:</span> ' + telLink(e.contact) + '</div>';
  if (e.email) html += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(e.email) + '</div>';
  if (e.website) html += '<div class="det-row"><span class="det-label">Website:</span> ' + webLink(e.website) + '</div>';
  if (e.location) html += '<div class="det-row"><span class="det-label">Location:</span> ' + mapsLink(e.location) + '</div>';
  if (e.address && e.address !== e.location) html += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(e.address) + '</div>';
  if (e.industry) html += '<div class="det-row"><span class="det-label">Industry:</span> ' + escapeHtml(e.industry) + '</div>';
  if (html === '<div class="det-plain">') html += '<div class="det-row muted">No additional details</div>';
  html += '</div>';
  if (isAdmin) {
    html += '<div class="hub-admin-row" style="margin-top:8px;">' +
      '<button class="hub-add-btn" data-ripple onclick="openEmployerForm(\'' + e.id + '\')">Edit employer</button>' +
      '<button class="btn-ghost-danger" data-ripple onclick="deleteEmployerById(\'' + e.id + '\')" style="flex-shrink:0;">Delete</button>' +
    '</div>';
  }
  return html;
}

window.toggleEmpHub = function(id) {
  if (!requireEmployerDirectoryAccess()) return;
  var card = null;
  var active = document.querySelector('.screen.active');
  if (active) card = active.querySelector('#emphub-' + id);
  if (!card) card = document.getElementById('emphub-' + id);
  if (!card) return;
  var wasOpen = card.classList.contains('open');
  if (active) active.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  else document.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  if (!wasOpen) {
    card.classList.add('open');
    trackEvent('employer_view', 'employer', id);
    setTimeout(function(){ card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 200);
  }
};

window.switchEmpHubTab = function(btn, employerId, tab) {
  if (!requireEmployerDirectoryAccess()) return;
  btn.parentElement.querySelectorAll('.hub-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  var e = employersCache.find(function(x){ return x.id === employerId; });
  var card = btn.closest('.hub-card');
  var target = card ? card.querySelector('.hub-tab-content') : null;
  if (!target) return;
  if (tab === 'vacancies') target.innerHTML = employerHubVacancies(e);
  if (tab === 'contact') target.innerHTML = employerHubContact(e);
};

var directoryReturnScreen = 'home';

function talentPoolIdentityRecord() {
  try { return JSON.parse(localStorage.getItem('sa_pool_identity') || 'null'); } catch(e) { return null; }
}
function hasTalentPoolAccess() {
  return employerDirectoryOpen || talentPoolVerified;
}
function rememberTalentPoolIdentity(phone, email) {
  try { localStorage.setItem('sa_pool_identity', JSON.stringify({ phone: phone || '', email: email || '' })); } catch(e) {}
}
async function verifyTalentPoolMembership(phone, email, quiet) {
  phone = (phone || '').trim(); email = (email || '').trim().toLowerCase();
  if (!phone || !email) { if (!quiet) showToast('Enter the email and phone number used for Talent Pool registration.'); return false; }
  try {
    var result = await supabaseClient.rpc('verify_talent_pool_access', { p_email: email, p_phone: phone });
    if (result.error) { console.error('Talent Pool verification', result.error); if (!quiet) showToast('Membership verification is not configured yet. Run CREATE_TALENT_POOL_ACCESS.sql in Supabase.'); return false; }
    talentPoolVerified = result.data === true;
    if (talentPoolVerified) rememberTalentPoolIdentity(phone, email);
    else if (!quiet) showToast('We could not verify that Talent Pool registration. Check your details.');
    return talentPoolVerified;
  } catch(e) { if (!quiet) showToast('Could not verify Talent Pool membership right now.'); return false; }
}
async function restoreTalentPoolMembership() {
  if (employerDirectoryOpen) return;
  var identity = talentPoolIdentityRecord();
  if (identity) await verifyTalentPoolMembership(identity.phone, identity.email, true);
}
function openEmployerDirectoryAccessMessage() {
  var sheet = document.getElementById('employer-directory-locked-overlay');
  var identity = talentPoolIdentityRecord();
  var phone = document.getElementById('employer-access-phone');
  var email = document.getElementById('employer-access-email');
  if (phone && identity) phone.value = identity.phone || '';
  if (email && identity) email.value = identity.email || '';
  if (sheet) sheet.classList.add('open');
  else showToast('Please verify your Talent Pool registration first to browse employers and employer vacancies.');
}
async function verifyEmployerDirectoryAccess() {
  var phone = (document.getElementById('employer-access-phone') || {}).value || '';
  var email = (document.getElementById('employer-access-email') || {}).value || '';
  var ok = await verifyTalentPoolMembership(phone, email, false);
  if (ok) {
    closeSheet('employer-directory-locked-overlay');
    showToast('Talent Pool membership verified');
    showAllEmployers();
  }
}
function requireEmployerDirectoryAccess() {
  if (employerDirectoryOpen || talentPoolVerified) return true;
  openEmployerDirectoryAccessMessage();
  return false;
}

function showAllEmployers() {
  if (!requireEmployerDirectoryAccess()) return;
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-profile').classList.contains('active') ? 'profile' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allemployers').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllEmployersList();
}

function renderAllEmployersList() {
  var q = ((document.getElementById('allemployers-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('allemployers', q);
  var el = document.getElementById('allemployers-list');
  var list = employersCache.slice();
  if (q) {
    list = list.filter(function(e){
      var hay = ((e.name||'') + ' ' + (e.industry||'') + ' ' + (e.location||'') + ' ' + (e.address||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  list.sort(function(a,b){
    if ((a.verified?1:0) !== (b.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return (a.name||'').localeCompare(b.name||'');
  });
  if (!list.length) { el.dataset.state = 'empty'; el.innerHTML = '<div class="empty-state"><h3>No employers yet</h3><p>Be the first company to register and post a vacancy.</p></div>'; return; }
  el.dataset.state = 'ready';
  el.innerHTML = list.map(employerHubCard).join('');
}

function prefIcon(pref) {
  var p = (pref||'').toLowerCase();
  if (p === 'whatsapp') return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.2 14.8l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0 1 12 4z"/></svg>';
  if (p === 'email') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  if (p === 'website') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
  if (p === 'walk-in') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  return '';
}
function mailLink(email) {
  // email may contain multiple comma separated
  var first = email.split(',')[0].trim();
  return '<a href="mailto:' + escapeHtml(first) + '" class="contact-link">' + escapeHtml(email) + '</a>';
}
function webLink(url) {
  var href = url;
  if (!/^https?:\/\//i.test(href)) href = 'https://' + href;
  return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="contact-link">' + escapeHtml(url) + '</a>';
}
function telLink(phone) {
  // Extract first phone number, strip non-dial chars for tel:
  var raw = phone.split(',')[0].trim();
  var dial = raw.replace(/[^\d+]/g, '');
  if (dial.charAt(0) === '0' && dial.length > 9) dial = '+27' + dial.substring(1);
  return '<a href="tel:' + escapeHtml(dial) + '" class="contact-link">' + escapeHtml(phone) + '</a>';
}
function mapsLink(location) {
  var href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location);
  return '<a href="' + href + '" target="_blank" rel="noopener" class="contact-link">' + escapeHtml(location) + '</a>';
}

var ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

/* ── Modern flat black-and-white icon set (currentColor, 2px stroke) ── */
var IS = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
var ICON_LOCK    = '<svg viewBox="0 0 24 24"' + IS + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
var ICON_UNLOCK  = '<svg viewBox="0 0 24 24"' + IS + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
var ICON_LINK    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
var ICON_CHAT    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>';
var ICON_HEART   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
var ICON_FLAG    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M4 21V4M4 4h12l-2 4 2 4H4"/></svg>';
var ICON_BOOK    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5H6.5A2.5 2.5 0 0 0 4 19.5z"/></svg>';
var ICON_DOC     = '<svg viewBox="0 0 24 24"' + IS + '><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h6"/></svg>';
var ICON_SPARKLE = '<svg viewBox="0 0 24 24"' + IS + '><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/></svg>';
var ICON_MIC     = '<svg viewBox="0 0 24 24"' + IS + '><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
var ICON_SCALES  = '<svg viewBox="0 0 24 24"' + IS + '><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0zM8 21h8"/></svg>';
var ICON_HELP    = '<svg viewBox="0 0 24 24"' + IS + '><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/></svg>';
var ICON_PIN     = '<svg viewBox="0 0 24 24"' + IS + '><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
var ICON_BRIEFCASE = '<svg viewBox="0 0 24 24"' + IS + '><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>';
var ICON_BUILDING = '<svg viewBox="0 0 24 24"' + IS + '><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M14 21V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v12M4 21h16"/><path d="M7 7h2M7 11h2M7 15h2"/></svg>';
var ICON_PHONE   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>';
var ICON_MAIL    = '<svg viewBox="0 0 24 24"' + IS + '><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
var ICON_WARN    = '<svg viewBox="0 0 24 24"' + IS + '><path d="M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
var ICON_CHECK   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M20 6L9 17l-5-5"/></svg>';
var ICON_CLOSE   = '<svg viewBox="0 0 24 24"' + IS + '><path d="M18 6L6 18M6 6l12 12"/></svg>';
/* Wrap an icon for a 18px menu slot */
function miSvg(svg) { return '<span class="mi-icon">' + svg + '</span>'; }
/* Small inline icon (12-14px) for stats / sub-text */
function tinySvg(svg) { return '<span class="ti">' + svg + '</span>'; }

window.switchHubTab = function(btn, agencyId, tab) {
  btn.parentElement.querySelectorAll('.hub-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  var a = agenciesCache.find(function(x){ return x.id === agencyId; });
  // Scope to the card that contains this button so duplicate IDs across screens don't conflict
  var card = btn.closest('.hub-card');
  var target = card ? card.querySelector('.hub-tab-content') : null;
  if (!target) {
    var active = document.querySelector('.screen.active');
    target = active ? active.querySelector('.hub-tab-content[data-agency="' + agencyId + '"]') : document.querySelector('.hub-tab-content[data-agency="' + agencyId + '"]');
  }
  if (!target) return;
  if (tab === 'vacancies') target.innerHTML = hubVacancies(a);
  if (tab === 'branches') target.innerHTML = hubBranches(a);
  if (tab === 'contact') target.innerHTML = hubContact(a);
};

window.toggleHub = function(id) {
  var card = null;
  var active = document.querySelector('.screen.active');
  if (active) card = active.querySelector('#hub-' + id);
  if (!card) card = document.getElementById('hub-' + id);
  if (!card) return;
  var wasOpen = card.classList.contains('open');
  if (active) active.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  else document.querySelectorAll('.hub-card.open').forEach(function(c){ c.classList.remove('open'); });
  if (!wasOpen) {
    card.classList.add('open');
    setTimeout(function(){ card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 200);
  }
};

var AGENCY_RENDER_BATCH_SIZE = 20;
var agencyRenderGeneration = 0;
function renderAgencyBatch(list, generation, offset) {
  if (generation !== agencyRenderGeneration) return;
  var target = document.getElementById('hub-list');
  if (!target) return;
  var nextOffset = Math.min(offset + AGENCY_RENDER_BATCH_SIZE, list.length);
  if (nextOffset > offset) {
    target.insertAdjacentHTML('beforeend', list.slice(offset, nextOffset).map(hubCard).join(''));
  }
  if (nextOffset < list.length) {
    var schedule = window.requestAnimationFrame || function(cb) { setTimeout(cb, 0); };
    schedule(function() { renderAgencyBatch(list, generation, nextOffset); });
  } else {
    target.removeAttribute('aria-busy');
  }
}

function filterAndRenderCached() {
  var generation = ++agencyRenderGeneration;
  var q = (document.getElementById('home-search').value || '').trim().toLowerCase();
  var list = agenciesCache;
  if (q) {
    // Build set of agency IDs whose branches match the query (name, location, phone, email)
    var branchMatchIds = {};
    branchesCache.forEach(function(b) {
      var bHay = ((b.name||'') + ' ' + (b.location||'') + ' ' + (b.phone||'') + ' ' + (b.email||'')).toLowerCase();
      if (bHay.indexOf(q) !== -1 && b.agency_id) branchMatchIds[b.agency_id] = true;
    });
    // Build set of agency IDs whose vacancies match the query (title, notes, location)
    var vacancyMatchIds = {};
    vacanciesCache.forEach(function(v) {
      var hay = ((v.title||'') + ' ' + (v.notes||'') + ' ' + (v.location||'')).toLowerCase();
      if (hay.indexOf(q) !== -1 && v.agency_id) vacancyMatchIds[v.agency_id] = true;
    });
    // Search across name, location, address, companies, trades/industries, branch matches, vacancy matches
    list = list.filter(function(a){
      var hay = ((a.name||'') + ' ' + (a.location||'') + ' ' + (a.address||'') + ' ' + (a.companies||'') + ' ' + (a.trades||'') + ' ' + (a.contact||'') + ' ' + (a.email||'')).toLowerCase();
      return hay.indexOf(q) !== -1 || branchMatchIds[a.id] || vacancyMatchIds[a.id];
    });
  }
  var empty = document.getElementById('empty-msg');
  if (empty) {
    empty.style.display = list.length ? 'none' : 'block';
    var emptyTitle = empty.querySelector('h3');
    var emptyCopy = empty.querySelector('p');
    if (emptyTitle) emptyTitle.textContent = q ? 'No agencies match that search' : 'No agencies yet';
    if (emptyCopy) emptyCopy.textContent = q ? 'Try a different agency, job, or location.' : 'Tap + to add the first one.';
  }
  var target = document.getElementById('hub-list');
  if (!target) return;
  target.innerHTML = '';
  target.setAttribute('aria-busy', list.length ? 'true' : 'false');
  renderAgencyBatch(list, generation, 0);
}

// ===== Search screen =====


window.toggleSave = function(btn, key) {
  if (savedSet.has(key)) { savedSet.delete(key); btn.classList.remove('saved'); showToast('Removed from saved'); }
  else { savedSet.add(key); btn.classList.add('saved'); showToast('Saved \u2605'); }
  localStorage.setItem('savedVacancies', JSON.stringify(Array.from(savedSet)));
  renderSaved();
};

function renderSaved() {
  var list = vacanciesCache.filter(function(v){ return savedSet.has(v.id); });
  var el = document.getElementById('saved-list');
  if (el) el.dataset.state = list.length ? 'ready' : 'empty';
  if (!list.length) {
    el.innerHTML = vacancyScreenStateMarkup('saved', false, false);
    return;
  }
  el.innerHTML = list.map(function(v) {
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
    return vacancyCard(v, agency);
  }).join('');
}

// ===== Search screen =====
window.handleSearchScreen = function(val) {
  var q = val.trim().toLowerCase();
  var el = document.getElementById('search-results');
  if (!q) { el.dataset.state = 'empty'; el.innerHTML = vacancyScreenStateMarkup('search', false, false); return; }
  // Build set of agency IDs whose branches match (name, location, phone, email)
  var branchMatchIds = {};
  branchesCache.forEach(function(b) {
    var bHay = ((b.name||'') + ' ' + (b.location||'') + ' ' + (b.phone||'') + ' ' + (b.email||'')).toLowerCase();
    if (bHay.indexOf(q) !== -1 && b.agency_id) branchMatchIds[b.agency_id] = true;
  });
  // Agencies: match name, location, address, companies, trades/industries, contact, email, or branch match
  var am = agenciesCache.filter(function(a){
    var hay = ((a.name||'') + ' ' + (a.location||'') + ' ' + (a.address||'') + ' ' + (a.companies||'') + ' ' + (a.trades||'') + ' ' + (a.contact||'') + ' ' + (a.email||'')).toLowerCase();
    return hay.indexOf(q)!==-1 || branchMatchIds[a.id];
  });
  // Vacancies: match title, notes, location, or parent agency name/trades/companies/address
  var vm = vacanciesCache.filter(function(v){
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
    var hay = ((v.title||'') + ' ' + (v.notes||'') + ' ' + (v.location||'')).toLowerCase();
    if (hay.indexOf(q)!==-1) return true;
    if (agency) {
      var aHay = ((agency.name||'') + ' ' + (agency.trades||'') + ' ' + (agency.companies||'') + ' ' + (agency.address||'') + ' ' + (agency.location||'')).toLowerCase();
      if (aHay.indexOf(q)!==-1) return true;
    }
    return false;
  });
  if (!am.length && !vm.length) { el.dataset.state = 'empty'; el.innerHTML = vacancyScreenStateMarkup('search', false, true); return; }
  var html = '';
  if (am.length) html += am.map(hubCard).join('');
  if (vm.length) {
    vm.forEach(function(v) {
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
      html += vacancyCard(v, agency);
    });
  }
  el.dataset.state = 'ready';
  el.innerHTML = html;
};

function vacancyCard(v, agency) {
  var key = v.id;
  var saved = savedSet.has(key);
  var isGeneral = v.agency_id === 'general';
  var employer = v.employer_id ? (employersCache.find(function(e){ return e.id === v.employer_id; }) || null) : null;
  var isEmployerPost = !!employer;
  var employerAccessLocked = isEmployerPost && !employerDirectoryOpen && !hasTalentPoolAccess();
  var orgName = isEmployerPost ? (employer.name || 'Employer') : (isGeneral ? (v.company || 'General Vacancy') : (agency.name || ''));
  var isAdzuna = String(v.id || '').indexOf('adzuna-') === 0;
  var isHimalayas = v.source_type === 'himalayas' || String(v.id || '').indexOf('himalayas-') === 0;
  var isGovernment = ['government','dpsa'].indexOf(String(v.source_type || '').toLowerCase()) !== -1 || /^(government|dpsa)-/i.test(String(v.id || ''));
  var isCareerBoard = v.source_type === 'career_board' || String(v.id || '').indexOf('career-') === 0;
  var sourceBadge = isHimalayas ? '<span class="vac-source-tag">Remote · Himalayas</span>' : isGovernment ? '<span class="vac-source-tag vac-source-tag-dpsa">Government vacancy</span>' : isCareerBoard ? '<span class="vac-source-tag vac-source-tag-career">Career Board · ' + escapeHtml(v.company || 'Direct') + '</span>' : '';
  var title = escapeHtml(v.title || 'Untitled role');
  var verifiedCheck = ((isEmployerPost && employer.verified) || (!isEmployerPost && !isGeneral && agency && agency.verified)) ? '<span class="verified-check" title="' + (isEmployerPost ? 'Verified employer' : 'Verified agency') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>' : '';

  /* Logo tile: employer/agency photo -> img; else company/agency initials on a gradient */
  var logo;
  if (isEmployerPost && employer.photo) {
    logo = '<div class="vac-logo"><img src="' + escapeHtml(employer.photo) + '" alt="" loading="lazy" width="46" height="46" onerror="this.style.display=\'none\'"></div>';
  } else if (isGeneral && v.company_photo) {
    logo = '<div class="vac-logo"><img src="' + escapeHtml(v.company_photo) + '" alt="" loading="lazy" width="46" height="46" onerror="this.style.display=\'none\'"></div>';
  } else if (!isEmployerPost && !isGeneral && agency && agency.photo) {
    logo = '<div class="vac-logo"><img src="' + escapeHtml(agency.photo) + '" alt="" loading="lazy" width="46" height="46" onerror="this.style.display=\'none\'"></div>';
  } else {
    var grad = vacGradFor(orgName);
    logo = '<div class="vac-logo ' + grad + '">' + escapeHtml(initials(orgName)) + '</div>';
  }

  /* Indeed-style summary: title, company, location, posted time — nothing else.
     Everything else (work arrangement, salary, closing date, contacts...) only
     shows once the card is tapped open. */
  var locLine = v.location ? ('<div class="vac-loc-line">' + VAC_ICONS.pin + escapeHtml(v.location) + '</div>') : '';
  var postedLine = '<div class="vac-posted">' + timeAgo(v.created_at) + '</div>';

  /* Detail rows (inside expandable section) */
  var detail = '';
  if (v.location) detail += vacDetRow(VAC_ICONS.pin, 'Location', escapeHtml(v.location));
  if (v.remote) detail += vacDetRow(VAC_ICONS.globe, 'Work Arrangement', escapeHtml(v.remote));
  if (v.experience_level) detail += vacDetRow(VAC_ICONS.star, 'Experience Level', escapeHtml(v.experience_level));
  if (v.employment_type) detail += vacDetRow(VAC_ICONS.briefcase, 'Employment Type', escapeHtml(v.employment_type + (v.contract_type ? ' \u2014 ' + v.contract_type : '')));
  if (v.salary) detail += vacDetRow(VAC_ICONS.money, 'Salary', escapeHtml(v.salary));
  if (v.hours) detail += vacDetRow(VAC_ICONS.clock, 'Hours', escapeHtml(v.hours));
  if (v.work_schedule) detail += vacDetRow(VAC_ICONS.calendar, 'Work Schedule', escapeHtml(v.work_schedule));
  if (v.start_date) detail += vacDetRow(VAC_ICONS.calendar, 'Start Date', escapeHtml(v.start_date));
  if (v.closing_date) detail += vacDetRow(VAC_ICONS.calendar, 'Closing Date', escapeHtml(v.closing_date));
  if (orgName) detail += vacDetRow(VAC_ICONS.building, isEmployerPost ? 'Employer' + (employer.verified ? ' \u2713 Verified' : '') : (isGeneral ? 'Company' : 'Agency' + ((agency && agency.verified) ? ' \u2713 Verified' : '')), escapeHtml(orgName));
  /* Email and phone detail rows with clickable links */
  if (v.email) detail += vacDetRow(VAC_ICONS.mail, 'Contact Email', mailLink(v.email));
  if (v.phone) detail += vacDetRow(VAC_ICONS.phone, 'Contact Phone', telLink(v.phone));

  var desc = v.notes ? '<div class="vac-desc-title">Job description</div><div class="vac-desc">' + escapeHtml(v.notes) + '</div>' : '';
  /* Platform attribution for vacancies posted by SA Recruiters or its agencies. */
  var saRecruitersAttribution = !isHimalayas && !isAdzuna && !isCareerBoard && (isGovernment || isGeneral || (!isEmployerPost && !isGeneral && agency))
    ? '<div class="sa-recruiters-attribution" aria-label="Jobs by SA Recruiters">' +
        '<a href="vacancy/' + publicVacancySlug(v) + '/" target="_blank" rel="noopener" title="Jobs by SA Recruiters" onclick="event.stopPropagation()">' +
          '<img src="/icons/v2-icon-192.png" alt="SA Recruiters logo" loading="lazy" width="20" height="20">' +
          '<span>Jobs by SA Recruiters</span>' +
        '</a>' +
      '</div>'
    : '';
  /* Adzuna requires visible attribution wherever an Adzuna listing is shown. */
  var adzunaAttribution = isAdzuna
    ? '<div class="adzuna-attribution" aria-label="Jobs by Adzuna">' +
        '<a href="https://www.adzuna.co.za/" target="_blank" rel="noopener" class="adzuna-attribution-jobs">Jobs</a>' +
        '<span aria-hidden="true"> by </span>' +
        '<a href="https://www.adzuna.co.za/" target="_blank" rel="noopener" class="adzuna-attribution-logo">' +
          '<span class="adzuna-mark" aria-hidden="true">A</span><span>Adzuna</span>' +
        '</a>' +
      '</div>'
    : '';

  /* Action buttons */
  var himalayasAttribution = isHimalayas
    ? '<div class="himalayas-attribution" aria-label="Remote job from Himalayas">' +
        '<a href="https://himalayas.app/" target="_blank" rel="noopener">Remote jobs by Himalayas</a>' +
      '</div>'
    : '';
  var actions = '<div class="vac-actions">';
  if (v.link) {
    actions += '<a class="vac-apply" href="' + escapeHtml(v.link) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.apply + 'Apply here</a>';
  } else if (v.email || v.phone) {
    /* No link but has email/phone — show contact buttons */
    if (v.email) {
      actions += '<a class="vac-apply" href="mailto:' + escapeHtml(v.email) + '" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.mail + 'Email to apply</a>';
    }
    if (v.phone) {
      actions += '<a class="vac-apply' + (v.email ? ' vac-apply-secondary' : '') + '" href="tel:' + escapeHtml(v.phone.replace(/\s/g,'')) + '" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.phone + 'Call to apply</a>';
    }
  } else if (isEmployerPost && (employer.contact || employer.email || employer.website)) {
    var ecta = employer.website ? escapeHtml(employer.website) : '#';
    actions += '<a class="vac-apply" href="' + ecta + '" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.apply + 'Contact employer</a>';
  } else if (!isGeneral && !isEmployerPost && agency && (agency.contact || agency.email || agency.website)) {
    var cta = agency.website ? escapeHtml(agency.website) : '#';
    actions += '<a class="vac-apply" href="' + cta + '" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">' + VAC_ICONS.apply + 'Contact agency</a>';
  } else {
    actions += '<button class="vac-apply" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId);showToast(\'Contact the agency or company directly to apply.\')">' + VAC_ICONS.apply + 'Contact to apply</button>';
  }
  actions += '<a class="vac-apply vac-apply-secondary" href="vacancy/' + publicVacancySlug(v) + '/" target="_blank" rel="noopener" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)">View public listing ↗</a>';
  actions += '<button class="vac-close-btn" onclick="event.stopPropagation();closeVac(this)">Close</button></div>';

  /* Admin actions (general vacancies + employer vacancies, when admin) */
  var admin = '';
  if (isAdmin && (isGeneral || isEmployerPost)) {
    admin = '<div class="vac-admin-actions">' +
      '<button class="rate-action-btn" data-ripple onclick="event.stopPropagation();openEditGeneralVacancySheet(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>' +
      '<button class="rate-action-btn danger" data-ripple onclick="event.stopPropagation();deleteGeneralVacancy(\'' + v.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>' +
    '</div>';
  }

  return '' +
  '<article class="vac-card' + (employerAccessLocked ? ' vac-card-locked' : '') + '" id="vc-' + key + '" data-vacancy-id="' + escapeHtml(v.id) + '" onclick="' + (employerAccessLocked ? 'openEmployerDirectoryAccessMessage()' : 'toggleVac(this)') + '">' +
    '<div class="vac-card-main">' +
      logo +
      '<div class="vac-body">' +
        '<div class="vac-title">' + title + '</div>' +
      '<div class="vac-company">' + verifiedCheck + escapeHtml(orgName) + sourceBadge + '</div>' +
        locLine +
        postedLine +
      '</div>' +
      '<div class="vac-card-side">' +
        '<button class="vac-share" onclick="event.stopPropagation();shareVacancy(\'' + key + '\')" aria-label="Share vacancy">' + SHARE_SVG + '</button>' +
        '<button class="vac-save' + (saved ? ' saved' : '') + '" onclick="event.stopPropagation();toggleSave(this,\'' + key + '\')" aria-label="Save vacancy">' + STAR_SVG + '</button>' +
        '<span class="chevron">' + ICON_CHEVRON + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="vac-detail"><div class="vac-detail-inner">' +
      detail + desc + saRecruitersAttribution + adzunaAttribution + himalayasAttribution + actions + admin +
    '</div></div>' +
  '</article>';
}

/* Human-friendly relative time, Indeed-style ("Just posted", "1 day ago", "3 days ago"...) */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  var then = new Date(dateStr).getTime();
  if (!then || isNaN(then)) return '';
  var diff = Date.now() - then;
  if (diff < 0) diff = 0;
  var min = Math.floor(diff / 60000);
  if (min < 60) return min < 1 ? 'Just posted' : (min + (min === 1 ? ' minute ago' : ' minutes ago'));
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
  var day = Math.floor(hr / 24);
  if (day < 30) return day + (day === 1 ? ' day ago' : ' days ago');
  var month = Math.floor(day / 30);
  if (month < 12) return month + (month === 1 ? ' month ago' : ' months ago');
  var year = Math.floor(month / 12);
  return year + (year === 1 ? ' year ago' : ' years ago');
}

/* Shorten a full street address down to "Suburb, City" for compact collapsed rows.
   Drops a trailing postal code / "South Africa" if present, then keeps the last
   two comma-separated segments. Falls back gracefully for short addresses. */
function shortLocation(loc) {
  if (!loc) return '';
  var parts = loc.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  while (parts.length > 2 && (/^\d+$/.test(parts[parts.length - 1]) || /^south africa$/i.test(parts[parts.length - 1]))) {
    parts.pop();
  }
  if (parts.length <= 2) return parts.join(', ');
  return parts.slice(-2).join(', ');
}

/* Helper: detail row with icon + label + value */
function vacDetRow(icn, label, val) {
  return '<div class="vac-detail-row"><span class="vac-detail-icon">' + icn + '</span><div><div class="vac-detail-label">' + label + '</div><div class="vac-detail-value">' + val + '</div></div></div>';
}

/* Helper: deterministic gradient class from a name (so each company gets a stable color) */
var VAC_GRADS = ['grad-blue','grad-green','grad-orange','grad-purple','grad-teal','grad-pink','grad-indigo','grad-mint','grad-amber','grad-red','grad-brown','grad-gray'];
function vacGradFor(name) {
  if (!name) return 'grad-gray';
  var h = 0;
  for (var i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return VAC_GRADS[Math.abs(h) % VAC_GRADS.length];
}

/* Vacancy card small inline icons (white stroke, sized by CSS) */
var VAC_ICONS = {
  pin:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  briefcase:'<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
  doc:'<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  money:'<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>',
  clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  calendar:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  building:'<svg viewBox="0 0 24 24"><path d="M3 22h18M4 21h16M3.5 10L12 4.5 20.5 10M5 21V11M9 21V11M15 21V11M19 21V11M2 10h20"/></svg>',
  mail:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  phone:'<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  apply:'<svg viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  globe:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  edit:'<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
};

/* Share icon for the vacancy card's share button (node network glyph, matches vac-save sizing) */
var SHARE_SVG = '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 10.51l6.83-3.98M8.59 13.49l6.83 3.98"/></svg>';

/* Toggle expand/collapse of a vacancy card */
window.toggleVac = function(target) {
  var c = target && target.closest ? target.closest('.vac-card') : document.getElementById('vc-' + target);
  if (c) {
    var opening = !c.classList.contains('open');
    c.classList.toggle('open');
    if (opening && c.dataset.vacancyId) {
      var viewKey = 'sa_vacancy_viewed_' + c.dataset.vacancyId + '_' + analyticsSessionId;
      var alreadyViewed = false;
      try { alreadyViewed = sessionStorage.getItem(viewKey) === '1'; if (!alreadyViewed) sessionStorage.setItem(viewKey, '1'); } catch(e) {}
      if (!alreadyViewed) trackEvent('vacancy_view', 'vacancy', c.dataset.vacancyId);
    }
  }
};
window.closeVac = function(target) {
  var c = target && target.closest ? target.closest('.vac-card') : document.getElementById('vc-' + target);
  if (c) c.classList.remove('open');
};

/* Toggle expand/collapse of a branch block/row (used by hub branch tab and the All Branches screen) */
window.toggleBranchBlock = function(id) {
  var c = document.getElementById(id);
  if (c) c.classList.toggle('open');
};

window.toggleSave = function(btn, key) {
  if (savedSet.has(key)) { savedSet.delete(key); btn.classList.remove('saved'); btn.innerHTML = STAR_SVG; showToast('Removed from saved'); }
  else { savedSet.add(key); btn.classList.add('saved'); btn.innerHTML = STAR_SVG; showToast('Saved'); }
  localStorage.setItem('savedVacancies', JSON.stringify(Array.from(savedSet)));
  renderSaved();
};

function renderSaved() {
  var list = vacanciesCache.filter(function(v){ return savedSet.has(v.id); });
  var el = document.getElementById('saved-list');
  if (el) el.dataset.state = list.length ? 'ready' : 'empty';
  if (!list.length) {
    el.innerHTML = vacancyScreenStateMarkup('saved', false, false);
    return;
  }
  el.innerHTML = list.map(function(v) {
    var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {};
    return vacancyCard(v, agency);
  }).join('');
}

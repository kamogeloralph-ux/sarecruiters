/* SA Recruiters — Vacancy section v2.
   Replaces vacancyCard + the overview layout, and adds quick filters, active-filter
   pills, posted-date / salary / saved filters, more sorts, list/grid layouts and recent
   searches. Data loading, pagination, save/share/apply and guest limits stay in the bundle. */
(function () {
  'use strict';

  var baseRender = window.renderAllVacanciesList;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var jsq = function (s) { return esc(String(s).replace(/[\\']/g, '\\$&')); };
  var DAY = 864e5;
  var S = { sort: 'newest', saved: false, fresh: false, salary: false, view: 'list' };
  try { S.view = localStorage.getItem('vx_view') === 'grid' ? 'grid' : 'list'; } catch (e) {}

  var LABELS = { general: 'General', agency: 'Agency', government: 'Government', retail: 'Retail', learnerships: 'Learnerships', himalayas: 'Himalayas Remote', adzuna: 'Adzuna', careers_page: 'Cruise Careers' };
  var SRC_ICON = { general: '⌕', agency: '▦', government: '⌂', retail: '▤', learnerships: '✦', himalayas: '↗', adzuna: 'A', careers_page: '⚓' };
  var I = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8l-6.2 3.3L7 14.2 2 9.3l6.9-1z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 10.51 6.83-3.98M8.59 13.49l6.83 3.98"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>'
  };

  /* ---------- helpers ---------- */
  function srcOf(v) {
    var t = String(v.source_type || '').toLowerCase(), id = String(v.id || '');
    if (t === 'himalayas' || /^himalayas-/.test(id)) return 'himalayas';
    if (t === 'adzuna' || /^adzuna-/.test(id)) return 'adzuna';
    if (t === 'government' || t === 'dpsa' || /^(government|dpsa)-/.test(id)) return 'government';
    if (['retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar'].indexOf(t) > -1 || /^(retail|shoprite|picknpay|woolworths|truworths|spar)-/.test(id)) return 'retail';
    if (t === 'learnerships' || /^graduates24-/.test(id)) return 'learnerships';
    if (t === 'careers_page' || /^careers-page-/.test(id)) return 'careers_page';
    return v.agency_id === 'general' ? 'general' : (v.employer_id ? 'employer' : 'agency');
  }
  function ts(d) { var t = d ? new Date(d).getTime() : 0; return isNaN(t) ? 0 : t; }
  function closingIn(v) { var t = ts(v.closing_date); return t ? Math.ceil((t - Date.now()) / DAY) : null; }
  function postedLabel(v) { var t = ts(v.created_at || v.posted_at || v.updated_at); return t ? new Date(t).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently'; }
  function salaryNum(v) { var m = String(v.salary || '').replace(/\s/g, '').match(/\d[\d,.]*/g); return m ? Math.max.apply(null, m.map(function (x) { return parseFloat(x.replace(/,/g, '')) || 0; })) : 0; }
  function agencyOf(v) { return v.agency_id && v.agency_id !== 'general' ? (agenciesCache.find(function (a) { return a.id === v.agency_id; }) || {}) : {}; }
  function fact(label, val) { return val ? '<div class="vx-fact"><small>' + esc(label) + '</small><b>' + val + '</b></div>' : ''; }

  /* ---------- card ---------- */
  function card(v, agency, o) {
    o = o || {}; agency = agency || {};
    var key = v.id, saved = savedSet.has(key), isGeneral = v.agency_id === 'general';
    var employer = v.employer_id ? (employersCache.find(function (e) { return e.id === v.employer_id; }) || null) : null;
    var locked = !!employer && !employerDirectoryOpen && !hasTalentPoolAccess();
    var org = employer ? (employer.name || 'Employer') : isGeneral ? (v.company || 'General vacancy') : (agency.name || v.company || '');
    var src = srcOf(v), verified = (employer && employer.verified) || (!employer && !isGeneral && agency.verified);
    var photo = employer && employer.photo || (isGeneral && v.company_photo) || (!employer && !isGeneral && agency.photo) || '';
    var logo = photo
      ? '<div class="vx-logo"><img src="' + esc(photo) + '" alt="" loading="lazy" decoding="async" width="78" height="78" onerror="this.remove()"></div>'
      : '<div class="vx-logo ' + vacGradFor(org) + '">' + esc(initials(org)) + '</div>';
    var age = (Date.now() - ts(v.created_at)) / DAY, left = closingIn(v);
    var isGov = src === 'government', isAdz = src === 'adzuna', isHim = src === 'himalayas';

    /* detail */
    var facts = fact('Location', esc(v.location)) + fact('Work mode', esc(v.remote)) + fact('Experience', esc(v.experience_level)) +
      fact('Type', esc((v.employment_type || '') + (v.contract_type ? ' — ' + v.contract_type : ''))) + fact('Salary', esc(v.salary)) + fact('Hours', esc(v.hours)) +
      fact('Schedule', esc(v.work_schedule)) + fact('Start date', esc(v.start_date)) + fact('Closing date', esc(v.closing_date)) +
      fact(employer ? 'Employer' : isGeneral ? 'Company' : 'Agency', esc(org) + (verified ? verifiedBadge(employer ? 'Verified employer' : 'Verified agency') : '')) +
      fact('Email', v.email ? mailLink(v.email) : '') + fact('Phone', v.phone ? telLink(v.phone) : '');
    var desc = v.notes ? '<div class="vx-desc"><h4>About the role</h4><p>' + esc(v.notes) + '</p></div>' : '';
    var attr = '';
    if (!isHim && !isAdz && (isGov || isGeneral || (!employer && !isGeneral && agency.id))) attr = '<div class="vx-attr"><a href="vacancy/' + publicVacancySlug(v) + '/" target="_blank" rel="noopener" onclick="event.stopPropagation()"><img src="/icons/v2-icon-192.png" alt="" width="18" height="18" loading="lazy" decoding="async">Jobs by SA Recruiters</a></div>';
    if (isAdz) attr = '<div class="vx-attr adzuna-attribution">Jobs by <a href="https://www.adzuna.co.za/" target="_blank" rel="noopener">Adzuna</a></div>';
    if (isHim) attr = '<div class="vx-attr himalayas-attribution"><a href="https://himalayas.app/" target="_blank" rel="noopener">Remote jobs by Himalayas</a></div>';

    var track = 'onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId)"';
    var cta = '';
    if (v.link) cta = '<a class="vx-btn vx-btn--primary" href="' + esc(v.link) + '" target="_blank" rel="noopener" ' + track + '>Apply now ' + I.arrow + '</a>';
    else if (v.email || v.phone) {
      if (v.email) cta += '<a class="vx-btn vx-btn--primary" href="mailto:' + esc(v.email) + '" ' + track + '>' + I.mail + ' Email to apply</a>';
      if (v.phone) cta += '<a class="vx-btn' + (v.email ? '' : ' vx-btn--primary') + '" href="tel:' + esc(String(v.phone).replace(/\s/g, '')) + '" ' + track + '>' + I.phone + ' Call</a>';
    } else if (employer && (employer.website || employer.email || employer.contact)) cta = '<a class="vx-btn vx-btn--primary" href="' + esc(employer.website || '#') + '" target="_blank" rel="noopener" ' + track + '>Contact employer</a>';
    else if (agency.id && (agency.website || agency.email || agency.contact)) cta = '<a class="vx-btn vx-btn--primary" href="' + esc(agency.website || '#') + '" target="_blank" rel="noopener" ' + track + '>Contact agency</a>';
    else cta = '<button type="button" class="vx-btn vx-btn--primary" onclick="event.stopPropagation();trackEvent(&#39;vacancy_click&#39;,&#39;vacancy&#39;,this.closest(&#39;.vac-card&#39;).dataset.vacancyId);showToast(&#39;Contact the agency or company directly to apply.&#39;)">Contact to apply</button>';
    cta += '<a class="vx-btn" href="vacancy/' + publicVacancySlug(v) + '/" target="_blank" rel="noopener" ' + track + '>Public listing ↗</a>';
    cta += '<button type="button" class="vx-btn vx-btn--ghost" onclick="event.stopPropagation();closeVac(this)">Close</button>';

    var inlineHref = '', inlineLabel = 'Apply', inlineTarget = '';
    if (v.link) { inlineHref = esc(v.link); inlineTarget = ' target="_blank" rel="noopener"'; }
    else if (v.email) { inlineHref = 'mailto:' + esc(v.email); inlineLabel = 'Email to apply'; }
    else if (v.phone) { inlineHref = 'tel:' + esc(String(v.phone).replace(/\s/g, '')); inlineLabel = 'Call to apply'; }
    else if (employer && (employer.website || employer.email || employer.contact)) {
      if (employer.website) { inlineHref = esc(employer.website); inlineTarget = ' target="_blank" rel="noopener"'; inlineLabel = 'Contact employer'; }
      else if (employer.email) { inlineHref = 'mailto:' + esc(employer.email); inlineLabel = 'Email employer'; }
      else { inlineHref = 'tel:' + esc(String(employer.contact).replace(/\s/g, '')); inlineLabel = 'Call employer'; }
    } else if (agency.id && (agency.website || agency.email || agency.contact)) {
      if (agency.website) { inlineHref = esc(agency.website); inlineTarget = ' target="_blank" rel="noopener"'; inlineLabel = 'Contact agency'; }
      else if (agency.email) { inlineHref = 'mailto:' + esc(agency.email); inlineLabel = 'Email agency'; }
      else { inlineHref = 'tel:' + esc(String(agency.contact).replace(/\s/g, '')); inlineLabel = 'Call agency'; }
    }
    var inlineApplyMarkup = '';
    var admin = (isAdmin && (isGeneral || employer))
      ? '<div class="vx-admin"><button type="button" class="vx-btn" onclick="event.stopPropagation();openEditGeneralVacancySheet(\'' + jsq(v.id) + '\')">' + VAC_ICONS.edit + ' Edit</button><button type="button" class="vx-btn" onclick="event.stopPropagation();deleteGeneralVacancy(\'' + jsq(v.id) + '\')">' + VAC_ICONS.trash + ' Delete</button></div>' : '';

    var loc = v.location ? shortLocation(v.location) : '';
    var jobType = v.employment_type || v.contract_type || 'Not specified';
    var companyLine = v.company && String(v.company).trim() && String(v.company).trim() !== String(org).trim() ? String(v.company).trim() : '';
    var cardMeta = '<span class="vx-card-meta"><span>' + I.calendar + '<b>' + esc(timeAgo(v.created_at) || 'Recently') + '</b></span><span>' + I.pin + '<b>' + esc(loc || 'South Africa') + '</b></span><span class="vx-card-field"><em>Salary</em><b>' + esc(v.salary || 'Not specified') + '</b></span><span class="vx-card-field"><em>Work Type</em><b>' + esc(jobType) + '</b></span></span>';
    return '<article class="vx-card vac-card' + (o.featured || v.is_featured ? ' vx-card--feat' : '') + (locked ? ' vx-card--locked' : '') + '" id="vc-' + esc(key) + '" data-vacancy-id="' + esc(v.id) + '" data-posted="' + ts(v.created_at) + '" data-closing="' + ts(v.closing_date) + '" data-salary="' + salaryNum(v) + '" data-title="' + esc(String(v.title || '').toLowerCase()) + '" data-loc="' + esc(String(v.location || v.province || '').toLowerCase()) + '">' +
      '<div class="vx-top">' +
        '<button type="button" class="vx-head" aria-expanded="false" aria-controls="vd-' + esc(key) + '" onclick="' + (locked ? 'openEmployerDirectoryAccessMessage()' : 'toggleVac(this)') + '">' + logo +
        '<span class="vx-main"><span class="vx-title" style="display:-webkit-box">' + esc(v.title || 'Untitled role') + '</span>' +
          (companyLine ? '<span class="vx-company-context">' + esc(companyLine) + '</span>' : '') +
          '<span class="vx-org"><span>' + esc(org) + '</span>' + (verified ? verifiedBadge(employer ? 'Verified employer' : 'Verified agency') : '') + '</span>' +
          cardMeta + '</span></button>' +
        '<div class="vx-tools-col"><button type="button" class="vx-tool vac-save' + (saved ? ' saved' : '') + '" onclick="event.stopPropagation();toggleSave(this,\'' + jsq(key) + '\')" aria-label="Save vacancy">' + STAR_SVG + '</button>' +
        '<button type="button" class="vx-tool vac-share" onclick="event.stopPropagation();shareVacancy(\'' + jsq(key) + '\')" aria-label="Share vacancy">' + SHARE_SVG + '</button></div>' +
      '</div>' +
      '<div class="vx-detail" id="vd-' + esc(key) + '"><div><div class="vx-detail-in"><div class="vx-facts">' + facts + '</div>' + desc + attr + '<div class="vx-cta">' + cta + '</div>' + admin + '</div></div></div>' +
    '</article>';
  }
  window.vacancyCard = card;

  /* ---------- filter state ---------- */
  function val(id) { var el = $(id); return el ? String(el.value || '').trim() : ''; }
  function vacancyText(v, fields) { return fields.map(function (key) { return v && v[key] || ''; }).join(' ').toLowerCase(); }
  function matchesWorkMode(v, wanted) {
    if (!wanted) return true;
    var text = vacancyText(v, ['remote', 'work_arrangement', 'work_schedule', 'notes']);
    if (wanted === 'remote') return /remote|telecommute|work[ -]?from[ -]?home|anywhere|distributed/.test(text);
    if (wanted === 'hybrid') return /hybrid/.test(text);
    if (wanted === 'onsite') return /on[ -]?site|office|in[ -]?person/.test(text) && !/remote|hybrid/.test(text);
    return text.indexOf(String(wanted).toLowerCase()) !== -1;
  }
  function matchesExperience(v, wanted) {
    if (!wanted) return true;
    var text = vacancyText(v, ['experience_level', 'notes', 'title']);
    if (wanted === 'entry') return /entry|junior|graduate|intern|learnership|trainee|no experience/.test(text);
    if (wanted === 'mid') return /mid|intermediate|experienced/.test(text) && !/senior|lead|principal|manager|executive/.test(text);
    if (wanted === 'senior') return /senior|lead|principal|manager|executive|head of/.test(text);
    return text.indexOf(String(wanted).toLowerCase()) !== -1;
  }
  function hasSalary(v) {
    return /\d/.test(String(v && (v.salary || v.min_salary || v.max_salary) || ''));
  }
  function postedWithin(v, days) {
    if (!days) return true;
    var posted = new Date(v && (v.created_at || v.posted_at || v.updated_at) || '').getTime();
    return !!posted && Date.now() - posted <= days * DAY;
  }
  function activeList() {
    var a = [], q = val('allvacancies-search'), l = val('allvacancies-location');
    if (q) a.push(['search', '“' + q + '”']);
    if (l) a.push(['location', l]);
    if (val('allvacancies-industry')) a.push(['industry', val('allvacancies-industry')]);
    if (val('allvacancies-remote')) a.push(['remote', { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' }[val('allvacancies-remote')] || val('allvacancies-remote')]);
    if (val('allvacancies-exp')) a.push(['exp', { entry: 'Entry level', mid: 'Mid level', senior: 'Senior level' }[val('allvacancies-exp')] || val('allvacancies-exp')]);
    if (val('vx-posted')) a.push(['posted', 'Last ' + val('vx-posted') + (val('vx-posted') === '1' ? ' day' : ' days')]);
    if (S.fresh) a.push(['fresh', 'New this week']);
    if (S.salary) a.push(['salary', 'Salary shown']);
    if (S.saved) a.push(['saved', 'Saved only']);
    return a;
  }
  function clearOne(k) {
    var map = { search: 'allvacancies-search', location: 'allvacancies-location', industry: 'allvacancies-industry', remote: 'allvacancies-remote', exp: 'allvacancies-exp', posted: 'vx-posted' };
    if (map[k]) { var el = $(map[k]); if (el) el.value = ''; if (k === 'location' && window.preciseLocationState && preciseLocationState.allvacancies) { try { resetPreciseLocationChipVisual('allvacancies'); } catch (e) {} } }
    else S[k] = false;
  }
  function syncUI() {
    var act = activeList(), filterKeys = ['industry', 'remote', 'exp', 'posted'];
    var n = act.filter(function (a) { return filterKeys.indexOf(a[0]) > -1; }).length;
    var cnt = $('vx-filter-count'); if (cnt) { cnt.textContent = n; cnt.hidden = !n; }
    var chips = { fresh: S.fresh, salary: S.salary, saved: S.saved, remote: val('allvacancies-remote') === 'remote' };
    document.querySelectorAll('.vx-quick [data-vx]').forEach(function (b) {
      var k = b.dataset.vx, on = k === 'near' ? !!(window.preciseLocationState && preciseLocationState.allvacancies && preciseLocationState.allvacancies.active) : !!chips[k];
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    var box = $('vx-active');
    if (box) box.innerHTML = act.length > 1 || (act.length === 1 && act[0][0] !== 'search')
      ? act.map(function (a) { return '<button type="button" class="vx-pill" data-clear="' + a[0] + '" aria-label="Remove filter ' + esc(a[1]) + '">' + esc(a[1]) + ' <i>×</i></button>'; }).join('') : '';
    var vs = $('allvacancies-sort'); if (vs) vs.value = S.sort;
    document.querySelectorAll('[data-vxview]').forEach(function (b) { b.classList.toggle('on', b.dataset.vxview === S.view); });
    var list = $('allvacancies-list'); if (list) list.classList.toggle('vx-grid', S.view === 'grid');
    var t = $('vacancy-market-title'), c = $('vx-crumb'), f = window.allVacanciesFolder;
    if (t) t.textContent = f ? (LABELS[f] || 'Vacancies') : 'Vacancies';
    if (c) c.textContent = f ? 'All sources › ' + (LABELS[f] || f) : totalLabel();
  }
  function totalLabel() {
    if (!generalVacancyCountLoaded || !dedicatedVacancyCountsLoaded) return 'Loading live roles…';
    var d = dedicatedVacancyCounts, n = (generalVacancyCount || 0) + vacanciesCache.filter(hasAssignedAgency).length;
    Object.keys(d).forEach(function (k) { n += d[k] || 0; });
    return (window.formatCompactCount ? window.formatCompactCount(n) : Number(n).toLocaleString()) + ' live roles across ' + Object.keys(LABELS).length + ' sources';
  }

  /* ---------- overview ---------- */
  function poolFiltered() {
    var pool = vacanciesCache.slice();
    (vacancyOverviewExtraRows || []).forEach(function (v) { if (v && !pool.some(function (x) { return x.id === v.id; })) pool.push(v); });
    (window.retailPriorityPreviewRows || []).forEach(function (v) { if (v && !pool.some(function (x) { return x.id === v.id; })) pool.push(v); });
    var q = val('allvacancies-search').toLowerCase(), loc = val('allvacancies-location').toLowerCase(), rem = val('allvacancies-remote'), ex = val('allvacancies-exp'), ind = val('allvacancies-industry').toLowerCase(), posted = Number(val('vx-posted')) || (S.fresh ? 7 : 0);
    return pool.filter(function (v) {
      if (isVacancyExpired(v)) return false;
      var a = agencyOf(v);
      if (loc && ((v.location || '') + ' ' + (v.address || '') + ' ' + (v.province || '')).toLowerCase().indexOf(loc) < 0) return false;
      if (!matchesWorkMode(v, rem)) return false;
      if (!matchesExperience(v, ex)) return false;
      if (ind && [a.trades, v.industry, v.sector, v.category, v.notes].join(' ').toLowerCase().indexOf(ind) < 0) return false;
      if (q && [v.title, v.notes, v.location, v.company, a.name, a.trades].join(' ').toLowerCase().indexOf(q) < 0) return false;
      if (posted && !postedWithin(v, posted)) return false;
      if (S.salary && !hasSalary(v)) return false;
      if (S.saved && !savedSet.has(v.id)) return false;
      if (vacancyOverviewFilter !== 'all' && !vacancyMatchesOverviewFilter(v)) return false;
      return true;
    });
  }
  function fillIndustries() {
    var sel = $('allvacancies-industry'); if (!sel || window.allVacanciesFolder) return;
    var seen = {}; vacanciesCache.forEach(function (v) { [v.industry, v.sector, v.category, agencyOf(v).trades].filter(Boolean).join(',').split(/[,|;/]+/).forEach(function (t) { t = t.trim(); if (t) seen[t] = 1; }); });
    var cur = sel.value, names = Object.keys(seen).sort();
    sel.innerHTML = '<option value="">Any industry</option>' + names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    sel.value = names.indexOf(cur) > -1 ? cur : '';
  }
  function sourceSummary() {
    var d = dedicatedVacancyCounts || {};
    return {
      ready: !!(generalVacancyCountLoaded && dedicatedVacancyCountsLoaded),
      order: ['general', 'agency', 'government', 'retail', 'learnerships', 'himalayas', 'adzuna', 'careers_page'],
      labels: LABELS, icons: SRC_ICON,
      counts: { general: generalVacancyCount || 0, agency: vacanciesCache.filter(hasAssignedAgency).length, government: d.government || 0, retail: d.retail || 0, learnerships: d.learnerships || 0, himalayas: d.himalayas || 0, adzuna: d.adzuna || 0, careers_page: d.careers_page || 0 }
    };
  }
  window.vacancySourceSummary = sourceSummary;
  function renderOverview() {
    var el = $('allvacancies-list'); if (!el) return;
    el.dataset.state = 'ready';
    if (typeof window.ensureRetailPriorityVacancies === 'function') window.ensureRetailPriorityVacancies();
    var lm = $('allvacancies-loadmore'); if (lm) lm.style.display = 'none';
    fillIndustries();
    var sum = sourceSummary(), counts = sum.counts, ready = sum.ready, order = sum.order;
    var searching = !!(val('allvacancies-search') || val('allvacancies-location') || activeList().length);
    var list = poolFiltered();
    list.sort(function (a, b) {
      var isRetail = window.isRetailPriorityVacancy;
      var retailOrder = Number(typeof isRetail === 'function' && isRetail(b)) - Number(typeof isRetail === 'function' && isRetail(a));
      if (retailOrder) return retailOrder;
      if (S.sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      if (S.sort === 'salary') return (Number(String(b.salary || '').replace(/[^0-9.]/g, '')) || 0) - (Number(String(a.salary || '').replace(/[^0-9.]/g, '')) || 0);
      if (S.sort === 'closing') return (new Date(a.closing_date || '9999-12-31').getTime() || 9e15) - (new Date(b.closing_date || '9999-12-31').getTime() || 9e15);
      var aDate = new Date(a.created_at || 0).getTime() || 0, bDate = new Date(b.created_at || 0).getTime() || 0;
      return bDate - aDate;
    });
    var html = '';
    if (searching) html += '<p class="vx-search-note" role="status">Showing loaded matches. Choose a source below to browse more.</p>';
    var rolesMarkup = '<section class="vx-block vx-available-roles" aria-labelledby="vx-available-roles-title"><div class="vx-block-head"><h2 id="vx-available-roles-title">Available roles</h2></div>' +
      '<div class="vx-seg" role="group" aria-label="Filter latest roles">' + [['all', 'All'], ['government', 'Government'], ['private', 'Private'], ['remote', 'Remote']].map(function (x) { return '<button type="button" data-ov="' + x[0] + '" class="' + (vacancyOverviewFilter === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="vx-list-slot" aria-live="polite" style="display:contents">' + (vacancyOverviewLoading ? '<div class="empty-state"><p>Loading matching vacancies…</p></div>' :
        list.length ? list.slice(0, 24).map(function (v) { return card(v, agencyOf(v)); }).join('') : '<div class="empty-state"><h3>No roles match yet</h3><p>Try widening your filters or choose another source below.</p></div>') + '</div></section>';
    var sourcesMarkup = '<section class="vx-block vx-source-section" aria-labelledby="vx-sources-title"><div class="vx-block-head"><div><h2 id="vx-sources-title">Browse jobs by source</h2><span class="vx-source-hint">Choose a source to browse its full listings.</span></div><span class="vx-source-count">8 sources</span></div><div class="vx-sources">' +
      order.map(function (t) { return '<button type="button" class="vx-source" data-open="' + t + '"><span class="vx-source-ic">' + SRC_ICON[t] + '</span><span><strong>' + esc(LABELS[t]) + '</strong><small>' + (ready ? counts[t].toLocaleString() + ' role' + (counts[t] === 1 ? '' : 's') : 'Loading…') + '</small></span></button>'; }).join('') + '</div></section>';
    html += sourcesMarkup + rolesMarkup;
    html += '<div class="vx-block"><div class="vx-block-head"><h2>Popular categories</h2></div><div class="vx-cats">' +
      [['government', 'Government'], ['learnership', 'Learnerships'], ['internship', 'Internships'], ['graduate_programme', 'Graduate programmes'], ['bursary', 'Bursaries'], ['apprenticeship', 'Apprenticeships'], ['part_time', 'Part-time'], ['remote', 'Remote'], ['permanent', 'Permanent'], ['contract', 'Contract']]
        .map(function (c) { return '<a href="/browse/category/' + c[0] + '/">' + c[1] + '</a>'; }).join('') + '</div></div>';
    el.innerHTML = '<div class="vx-block" style="display:contents">' + html + '</div>';
    var rc = $('allvacancies-result-count'); if (rc) rc.textContent = searching ? list.length + ' match' + (list.length === 1 ? '' : 'es') + ' in loaded roles' : Math.min(list.length, 24).toLocaleString() + ' roles shown';
  }

  /* ---------- folder post-processing (works after async page loads too) ---------- */
  var busy = false, raf = 0, obs;
  function post() {
    var list = $('allvacancies-list'); if (!list) return;
    busy = true; if (obs) obs.disconnect();
    try {
      var cards = Array.prototype.slice.call(list.querySelectorAll(':scope > .vx-card'));
      if (cards.length && window.allVacanciesFolder) {
        var loc = val('allvacancies-location').toLowerCase(), days = Number(val('vx-posted')) || (S.fresh ? 7 : 0), hidden = 0;
        cards.forEach(function (c) {
          var hide = false, id = c.dataset.vacancyId;
          if (days && Date.now() - Number(c.dataset.posted) > days * DAY) hide = true;
          if (S.salary && !Number(c.dataset.salary)) hide = true;
          if (S.saved && !savedSet.has(id)) hide = true;
          if (loc && c.dataset.loc.indexOf(loc) < 0 && !(window.preciseLocationState && preciseLocationState.allvacancies && preciseLocationState.allvacancies.active)) hide = true;
          c.hidden = hide; if (hide) hidden++;
        });
        var by = { newest: function (a, b) { return b.dataset.posted - a.dataset.posted; }, title: function (a, b) { return a.dataset.title.localeCompare(b.dataset.title); }, salary: function (a, b) { return b.dataset.salary - a.dataset.salary || b.dataset.posted - a.dataset.posted; }, closing: function (a, b) { var x = Number(a.dataset.closing) || 9e15, y = Number(b.dataset.closing) || 9e15; return x - y; } }[S.sort];
        var anchor = list.querySelector(':scope > .vac-pagination');
        cards.sort(by).forEach(function (c) { list.insertBefore(c, anchor); });
        var n = $('vx-hidden-note'); if (n) n.textContent = hidden ? '· ' + hidden + ' hidden by filters' : '';
        if (hidden === cards.length) { if (!list.querySelector('.vx-none')) { var e = document.createElement('div'); e.className = 'empty-state vx-none'; e.innerHTML = '<h3>Nothing on this page matches</h3><p>Reset a filter or move to another page.</p>'; list.insertBefore(e, cards[0]); } }
        else { var old = list.querySelector('.vx-none'); if (old) old.remove(); }
      } else { var nn = $('vx-hidden-note'); if (nn) nn.textContent = ''; }
      list.classList.toggle('vx-grid', S.view === 'grid');
    } finally { busy = false; if (obs && list) obs.observe(list, { childList: true }); }
  }
  function schedulePost() { if (busy) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(post); }

  /* ---------- render entry ---------- */
  function render() {
    if (window.allVacanciesFolder) { if (typeof baseRender === 'function') baseRender(); }
    else { if (typeof updateVacanciesBackButton === 'function') updateVacanciesBackButton(); renderOverview(); }
    syncUI(); post();
  }
  window.renderAllVacanciesList = render;
  window.clearVacancyFilters = function () {
    ['allvacancies-search', 'allvacancies-location', 'allvacancies-industry', 'allvacancies-remote', 'allvacancies-exp', 'vx-posted'].forEach(function (id) { var el = $(id); if (el) el.value = ''; });
    S.fresh = S.salary = S.saved = false; S.sort = 'newest'; vacancyOverviewFilter = 'all'; vacancyOverviewExtraRows = []; render();
  };
  window.setVacancySort = function (v) { S.sort = v || 'newest'; render(); };

  function remember(q) {
    if (!q || q.length < 2) return;
    try {
      var r = JSON.parse(localStorage.getItem('vx_recent') || '[]').filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
      r.unshift(q); localStorage.setItem('vx_recent', JSON.stringify(r.slice(0, 8))); fillRecent();
    } catch (e) {}
  }
  function fillRecent() {
    var dl = $('vx-recent'); if (!dl) return;
    try { dl.innerHTML = JSON.parse(localStorage.getItem('vx_recent') || '[]').map(function (x) { return '<option value="' + esc(x) + '">'; }).join(''); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    var screen = $('screen-allvacancies'); if (!screen) return;
    var t; var debounced = function () { clearTimeout(t); t = setTimeout(render, 280); };
    ['allvacancies-search', 'allvacancies-location'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('input', debounced);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.blur(); clearTimeout(t); remember(val(id)); render(); } });
    });
    ['allvacancies-industry', 'allvacancies-remote', 'allvacancies-exp', 'vx-posted', 'allvacancies-sort'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('change', function () { if (id === 'allvacancies-sort') S.sort = el.value; render(); });
    });
    var list = $('allvacancies-list');
    if (list && 'MutationObserver' in window) { obs = new MutationObserver(schedulePost); obs.observe(list, { childList: true }); }
    screen.addEventListener('click', function (e) {
      var b = e.target.closest('button,a'); if (!b) return;
      if (b.classList.contains('vx-head')) { var c = b.closest('.vac-card'); b.setAttribute('aria-expanded', c && c.classList.contains('open') ? 'true' : 'false'); return; }
      if (b.classList.contains('vac-save') && S.saved) { setTimeout(post, 0); return; }
      if (b.id === 'vx-filter-toggle') { var p = $('vx-filters'), o = p.hidden; p.hidden = !o; b.setAttribute('aria-expanded', o); return; }
      if (b.id === 'vacancy-clear-filters') return window.clearVacancyFilters();
      if (b.dataset.clear) { clearOne(b.dataset.clear); return render(); }
      if (b.dataset.open) { return openVacancyFolder(b.dataset.open); }
      if (b.dataset.ov) { return setVacancyOverviewFilter(b.dataset.ov); }
      if (b.dataset.vxview) { S.view = b.dataset.vxview; try { localStorage.setItem('vx_view', S.view); } catch (x) {} return render(); }
      var k = b.dataset.vx; if (!k) return;
      if (k === 'near') return usePreciseLocation('allvacancies');
      if (k === 'remote') { var r = $('allvacancies-remote'); r.value = r.value === 'remote' ? '' : 'remote'; return render(); }
      S[k] = !S[k]; render();
    });
    fillRecent(); syncUI();
  });
})();

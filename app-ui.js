/*
 * SA Recruiters -- app.js split 6/8: app-ui.js
 * Admin stubs, bottom nav, toast, force-update, retry banner, version badge, ripple, submissions + all-list views, vacancy folder rendering
 *
 * Part of the original monolithic app.js, mechanically split and kept as
 * classic (non-module) scripts loaded in this exact order via <script defer>
 * in index.html, so all functions/vars stay on one shared global scope
 * exactly as before. Do not reorder these files relative to one another.
 */

// ===== ADMIN (removed from public app — admin console now lives in admin.html) =====
// isAdmin is permanently false in the public app. All admin-only UI is hidden.
// The ?manage=TOKEN agency self-service flow (managerMode) remains fully functional.
var ADMIN_PIN = '';          // PIN removed — no longer used
var pinVerified = false;     // kept for backward-compat references
function getPinAttempts() { return 0; }
function setPinAttempts() {}
function getPinLockTime() { return 0; }
function setPinLockTime() {}
function isPinLocked() { return 0; }
function formatRemainingTime() { return ''; }
function verifyPin() {}
function showPinLockMsg() {}

function openAdminSheet() {
  // Admin access has moved to the separate admin.html console.
  alert('Admin access has moved.\n\nPlease use the separate admin console URL (admin.html).');
}
async function adminLogin() {}
async function adminLogout() {}
function updateAdminUI() {
  // No admin UI in public app — keep as no-op for any callers.
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin) fabAdmin.style.display = 'none';
}
// Do NOT auto-restore an admin session in the public app.
// (Supabase session restore + admin console handled in admin.html.)

// ===== Bottom nav =====
var SA_ACTIVE_SCREEN_KEY = 'sa_active_screen_v1';
var SA_RESTORABLE_SCREENS = {
  home: true, account: true, saved: true, menu: true,
  allagencies: true, allbranches: true, allvacancies: true,
  allemployers: true, allposters: true, pool: true
};
function isRestorableScreen(name) {
  return !!SA_RESTORABLE_SCREENS[name];
}
function persistActiveScreen(name) {
  if (!isRestorableScreen(name)) return;
  try { sessionStorage.setItem(SA_ACTIVE_SCREEN_KEY, name); } catch(e) {}
}
function restoredScreenName() {
  try {
    var name = sessionStorage.getItem(SA_ACTIVE_SCREEN_KEY);
    return isRestorableScreen(name) ? name : 'home';
  } catch(e) { return 'home'; }
}
function closeTransientOutsideUi() {
  document.querySelectorAll('.sheet-scrim.open').forEach(function (overlay) {
    if (overlay.id === 'pool-register-overlay' && overlay.classList.contains('gate-mandatory')) return;
    overlay.classList.remove('open');
  });
  var notes = document.getElementById('my-notes-accordion');
  if (notes) notes.open = false;
  var report = document.getElementById('community-report-overlay');
  if (report) { report.hidden = true; report.classList.remove('open'); }
  var toast = document.getElementById('toast');
  if (toast) toast.classList.remove('show');
  var drawer = document.getElementById('site-menu-drawer');
  var backdrop = document.getElementById('site-menu-backdrop');
  if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
  if (backdrop) { backdrop.classList.remove('is-visible'); backdrop.setAttribute('aria-hidden', 'true'); }
  document.body.classList.remove('site-menu-open');
}
window.__saCloseTransientOutsideUi = closeTransientOutsideUi;
window.addEventListener('pagehide', closeTransientOutsideUi);
function normalizeStartupScreen() {
  var params = new URLSearchParams(window.location.search);
  closeTransientOutsideUi();
  // Explicit manager/action/deep-link URLs are intentional entry points.
  if (params.has('manage') || params.has('manage_employer') || params.has('action') || params.has('tab') || params.has('section')) return;
  // Community shares use a hash deep link. Preserve that intent across the
  // final reveal pass, which can run after the community's own initial timer.
  if (location.hash === '#tipchat' || location.hash === '#community-interview-tips') return;
  try { sessionStorage.setItem(SA_ACTIVE_SCREEN_KEY, 'home'); } catch(e) {}
  // Normalize every screen, not just the previously observed Menu/TipChat
  // route. This is called both before boot and immediately before reveal.
  document.querySelectorAll('.screen').forEach(function (screen) { screen.classList.remove('active'); });
  var home = document.getElementById('screen-home');
  if (home) home.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function (button) {
    button.classList.toggle('active', button.dataset.tab === 'home');
  });
  window.__saRestoredScreen = 'home';
}
window.__saNormalizeStartupScreen = normalizeStartupScreen;
function restoreActiveScreenBeforeReveal() {
  normalizeStartupScreen();
}
restoreActiveScreenBeforeReveal();

// ===== Vacancy-first home feed =====
var homeLocationFilter = '';
var homeCategoryFilter = '';
var HOME_VACANCY_CARD_LIMIT = 8;
if (!Array.isArray(window.retailPriorityPreviewRows)) window.retailPriorityPreviewRows = [];
var retailPriorityPreviewPromise = null;
var retailPriorityPreviewLoaded = false;
var HOME_JOB_CATEGORIES = [
  { key: 'finance', label: 'Finance & accounting', sub: 'Accounts, audit and finance', icon: 'R' },
  { key: 'technology', label: 'IT & technology', sub: 'Software, data and digital', icon: 'IT' },
  { key: 'trades', label: 'Trades & engineering', sub: 'Technical and skilled work', icon: '+' },
  { key: 'sales', label: 'Sales & marketing', sub: 'Sales, brand and growth', icon: '↗' }
];

function setHomeLocationFilter(filter) {
  filter = filter || '';
  homeLocationFilter = homeLocationFilter === filter && filter ? '' : filter;
  filterAndRenderCached();
}

function setHomeCategoryFilter(filter) {
  var category = HOME_JOB_CATEGORIES.find(function (item) { return item.key === filter; });
  if (!category) return;
  // Category tiles are navigation cards: take the visitor to the full vacancy
  // screen with the selected category already entered in the search field.
  showAllVacancies('home');
  var search = document.getElementById('allvacancies-search');
  if (search) {
    search.value = category.key;
    if (typeof renderAllVacanciesList === 'function') renderAllVacanciesList();
  }
}

function clearHomeFeedFilters() {
  homeLocationFilter = '';
  homeCategoryFilter = '';
  var search = document.getElementById('home-search');
  if (search) search.value = '';
  filterAndRenderCached();
}

function openHomeTalentPoolProfile() {
  if (typeof saAuthUser !== 'undefined' && saAuthUser) {
    openMyPoolProfile();
    return;
  }
  openPoolRegisterSheet();
}

function homeSourceVacancies() {
  var rows = [], seen = {};
  function add(list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (v) {
      if (!v || !v.id || seen[v.id]) return;
      if (typeof isVacancyExpired === 'function' && isVacancyExpired(v)) return;
      seen[v.id] = true;
      rows.push(v);
    });
  }
  add(typeof vacanciesCache !== 'undefined' ? vacanciesCache : null);
  add(typeof staticVacanciesCache !== 'undefined' ? staticVacanciesCache : null);
  add(typeof vacancyOverviewExtraRows !== 'undefined' ? vacancyOverviewExtraRows : null);
  add(window.retailPriorityPreviewRows);
  return rows;
}

function isRetailPriorityVacancy(v) {
  if (!v) return false;
  var source = String(v.source_type || '').toLowerCase();
  var id = String(v.id || '').toLowerCase();
  if (['retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar'].indexOf(source) !== -1 || /^(retail|shoprite|picknpay|woolworths|truworths|spar)-/.test(id)) return true;
  var agency = v.agency_id && v.agency_id !== 'general' && typeof agenciesCache !== 'undefined'
    ? (agenciesCache.find(function (a) { return a.id === v.agency_id; }) || {}) : {};
  var employer = v.employer_id && typeof employersCache !== 'undefined'
    ? (employersCache.find(function (e) { return e.id === v.employer_id; }) || {}) : {};
  var brandText = [v.company, v.employer_name, employer.name, agency.name].join(' ');
  if (/\b(shoprite|checkers|pick\s*'?n?\s*pay|woolworths|spar|boxer|truworths|pep\b|clicks|dis[\s-]?chem|mr\s*price|makro|game\b|cashbuild|ackermans|builders\s*warehouse|food\s*lover)/i.test(brandText)) return true;
  var roleText = [v.title, v.category, v.industry, v.sector, agency.trades].join(' ');
  return /\b(retail|cashier|till operator|store manager|store supervisor|shop assistant|sales assistant|merchandiser|stock controller|stockroom assistant|shelf packer|grocery|supermarket)\b/i.test(roleText);
}
window.isRetailPriorityVacancy = isRetailPriorityVacancy;

function ensureRetailPriorityVacancies() {
  if (retailPriorityPreviewLoaded) return Promise.resolve(window.retailPriorityPreviewRows || []);
  if (retailPriorityPreviewPromise) return retailPriorityPreviewPromise;
  // The committed Pages snapshot already contains the full live vacancy set,
  // including dedicated retail sources. Do not download the same 60 wide rows
  // (with long descriptions) from PostgREST again on every Home/overview visit.
  if (typeof staticDataEnabled !== 'undefined' && staticDataEnabled &&
      typeof startupDataResolved !== 'undefined' && !startupDataResolved &&
      typeof getStartupData === 'function') {
    return getStartupData().then(function () { return ensureRetailPriorityVacancies(); });
  }
  if (typeof startupDataSource !== 'undefined' && startupDataSource === 'static') {
    retailPriorityPreviewLoaded = true;
    window.retailPriorityPreviewRows = [];
    return Promise.resolve(window.retailPriorityPreviewRows);
  }
  var columns = 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order';
  var retailSources = ['retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar'];
  function readRetailFromPostgrest() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return Promise.resolve([]);
    return supabaseClient.from('vacancies').select(columns)
      .in('source_type', retailSources)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(60)
      .then(function (result) {
        if (result.error) throw result.error;
        return result.data || [];
      });
  }
  var workerRead = typeof fetchVacancyPageFromWorker === 'function'
    ? fetchVacancyPageFromWorker({ source: retailSources.join(','), limit: 50 })
    : Promise.resolve(null);
  retailPriorityPreviewPromise = Promise.resolve(workerRead).catch(function () { return null; })
    .then(function (page) {
      if (page && Array.isArray(page.vacancies)) return page.vacancies;
      return readRetailFromPostgrest();
    })
    .then(function (rows) {
      window.retailPriorityPreviewRows = filterExpiredVacancies(rows || []);
      retailPriorityPreviewLoaded = true;
      retailPriorityPreviewPromise = null;
      var home = document.getElementById('screen-home');
      if (home && home.classList.contains('active') && typeof filterAndRenderCached === 'function') filterAndRenderCached();
      var vacancies = document.getElementById('screen-allvacancies');
      if (vacancies && vacancies.classList.contains('active') && typeof renderAllVacanciesList === 'function') renderAllVacanciesList();
      return window.retailPriorityPreviewRows;
    })
    .catch(function (error) {
      console.warn('retail vacancy preview', error);
      retailPriorityPreviewPromise = null;
      return [];
    });
  return retailPriorityPreviewPromise;
}
window.ensureRetailPriorityVacancies = ensureRetailPriorityVacancies;

function homeVacancyText(v) {
  var agency = v.agency_id && v.agency_id !== 'general' && typeof agenciesCache !== 'undefined'
    ? (agenciesCache.find(function (a) { return a.id === v.agency_id; }) || {}) : {};
  var employer = v.employer_id && typeof employersCache !== 'undefined'
    ? (employersCache.find(function (e) { return e.id === v.employer_id; }) || {}) : {};
  return [v.title, v.notes, v.location, v.address, v.province, v.company, v.category, v.industry,
    v.sector, v.remote, v.employment_type, agency.name, agency.trades, employer.name, employer.industry]
    .join(' ').toLowerCase();
}

function homeVacancyMatchesLocation(v, filter) {
  if (!filter) return true;
  var text = [v.location, v.address, v.province, v.remote, v.work_arrangement].join(' ').toLowerCase();
  var patterns = {
    gauteng: /gauteng|johannesburg|joburg|pretoria|centurion|sandton|randburg|midrand|benoni|kempton park|eastrand|roodepoort|krugersdorp/i,
    'western-cape': /western[\s-]?cape|cape town|stellenbosch|paarl|george|mossel bay|bellville|worcester/i,
    'kwazulu-natal': /kwazulu[\s-]?natal|durban|pietermaritzburg|richards bay|newcastle|ballito/i,
    'eastern-cape': /eastern[\s-]?cape|gqeberha|port elizabeth|east london|mthatha|uitenhage|komani|queenstown|bhisho|king william'?s town/i,
    'free-state': /free[\s-]?state|bloemfontein|welkom|bethlehem|kroonstad|sasolburg|harrismith/i,
    limpopo: /limpopo|polokwane|thohoyandou|mokopane|tzaneen|lephalale|musina/i,
    mpumalanga: /mpumalanga|mbombela|nelspruit|witbank|emalahleni|middelburg|secunda|ermelo/i,
    'north-west': /north[\s-]?west|rustenburg|mahikeng|mafikeng|klerksdorp|potchefstroom|brits|vryburg/i,
    'northern-cape': /northern[\s-]?cape|kimberley|upington|kuruman|de aar|springbok|kathu/i,
    remote: /remote|hybrid|work[ -]from[ -]home|anywhere|distributed/i
  };
  return !!(patterns[filter] && patterns[filter].test(text));
}

function homeVacancyMatchesCategory(v, filter) {
  if (!filter) return true;
  var text = homeVacancyText(v);
  var patterns = {
    finance: /\b(finance|financial|accounting|accountant|bookkeeper|audit|payroll|tax|banking|banker|investment|actuarial|treasury)\b/i,
    technology: /\b(it|software|developer|technology|data|cyber|network|devops|cloud|systems?|computer)\b/i,
    trades: /\b(trade|trades|artisan|technician|electrician|plumber|weld(?:er|ing)?|fitter|mechanic|millwright|construction|maintenance|engineering|engineer)\b/i,
    sales: /\b(sales|marketing|business development|account manager|brand|digital marketing|social media|communications|crm)\b/i
  };
  return !!(patterns[filter] && patterns[filter].test(text));
}

function openCompanyFeatureInquiry() {
  if (typeof openSuggestionSheet !== 'function') return;
  openSuggestionSheet();
  var type = document.getElementById('s-type');
  if (type) type.value = 'Feature request';
}

function openFeaturedCompanyWebsite(event) {
  if (event && event.target && event.target.closest && event.target.closest('button')) return;
  var url = 'https://jwprojects.co.za/';
  window.open(url, '_blank', 'noopener,noreferrer');
}

function homeVacancySourceMarkup() {
  var summary = typeof window.vacancySourceSummary === 'function' ? window.vacancySourceSummary() : null;
  var order = summary && summary.order ? summary.order : ['general', 'agency', 'government', 'retail', 'learnerships', 'himalayas', 'adzuna', 'careers_page'];
  var labels = summary && summary.labels ? summary.labels : {
    general: 'General', agency: 'Agency', government: 'Government', retail: 'Retail',
    learnerships: 'Learnerships', himalayas: 'Himalayas Remote', adzuna: 'Adzuna', careers_page: 'Cruise Careers'
  };
  var icons = summary && summary.icons ? summary.icons : { general: '⌕', agency: '▦', government: '⌂', retail: '▤', learnerships: '✦', himalayas: '↗', adzuna: 'A', careers_page: '⚓' };
  var counts = summary && summary.counts ? summary.counts : {};
  var ready = !!(summary && summary.ready);
  return '<section class="home-sources-section" aria-labelledby="home-sources-title"><div class="home-section-heading home-section-heading--compact"><div><span class="home-section-kicker">Browse all opportunities</span><h2 id="home-sources-title">Jobs by source</h2></div><span class="home-source-total">8 sources</span></div><div class="home-source-grid">' +
    order.map(function (source) {
      var count = Number(counts[source]) || 0;
      var countText = ready ? count.toLocaleString() + ' ' + (count === 1 ? 'role' : 'roles') : 'Loading…';
      return '<button type="button" class="home-source-card" onclick="openVacancyFolder(\'' + source + '\')" aria-label="Open ' + escapeHtml(labels[source]) + ' vacancies"><span class="home-source-icon" aria-hidden="true">' + escapeHtml(icons[source]) + '</span><span class="home-source-copy"><strong>' + escapeHtml(labels[source]) + '</strong><small>' + escapeHtml(countText) + '</small></span><span class="home-source-arrow" aria-hidden="true">›</span></button>';
    }).join('') + '</div></section>';
}

function getDailyFeaturedPoster(posters) {
  var list = (Array.isArray(posters) ? posters : []).filter(function (poster) { return poster && poster.image_url; }).slice().sort(function (a, b) {
    return String(a.id || a.image_url).localeCompare(String(b.id || b.image_url));
  });
  if (!list.length) return null;
  var now = new Date();
  var day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return list[((day % list.length) + list.length) % list.length];
}
function renderHomeFeaturedPoster(posters) {
  var slot = document.getElementById('home-featured-poster-slot');
  if (!slot) return;
  var featured = getDailyFeaturedPoster(posters);
  if (!featured) {
    slot.innerHTML = '<div class="poster-empty">No vacancy posters are available today. Check back soon.</div>';
    return;
  }
  var caption = String(featured.caption || 'Featured vacancy opportunity');
  slot.innerHTML = '<button type="button" class="home-featured-poster-image" data-featured-poster-url="' + escapeHtml(featured.image_url) + '" aria-label="Open featured vacancy poster: ' + escapeHtml(caption) + '"><img src="' + escapeHtml(featured.image_url) + '" loading="lazy" decoding="async" alt="' + escapeHtml(caption) + '"></button>';
  slot.querySelectorAll('[data-featured-poster-url]').forEach(function (button) {
    button.addEventListener('click', function () { openPosterLightbox(button.getAttribute('data-featured-poster-url')); });
  });
}
var HOME_WEEKLY_PROVINCES = [
  { key: 'gauteng', label: 'Gauteng', pattern: /gauteng|johannesburg|joburg|pretoria|centurion|sandton|randburg|midrand|benoni|kempton park|eastrand|roodepoort|krugersdorp/i },
  { key: 'western-cape', label: 'Western Cape', pattern: /western[\s-]?cape|cape town|stellenbosch|paarl|george|mossel bay|bellville|worcester/i },
  { key: 'kwazulu-natal', label: 'KwaZulu-Natal', pattern: /kwazulu[\s-]?natal|durban|pietermaritzburg|richards bay|newcastle|ballito/i },
  { key: 'eastern-cape', label: 'Eastern Cape', pattern: /eastern[\s-]?cape|gqeberha|port elizabeth|east london|mthatha|uitenhage|komani|queenstown|bhisho|king william'?s town/i },
  { key: 'free-state', label: 'Free State', pattern: /free[\s-]?state|bloemfontein|welkom|bethlehem|kroonstad|sasolburg|harrismith/i },
  { key: 'limpopo', label: 'Limpopo', pattern: /limpopo|polokwane|thohoyandou|mokopane|tzaneen|lephalale|musina/i },
  { key: 'mpumalanga', label: 'Mpumalanga', pattern: /mpumalanga|mbombela|nelspruit|witbank|emalahleni|middelburg|secunda|ermelo/i },
  { key: 'north-west', label: 'North West', pattern: /north[\s-]?west|rustenburg|mahikeng|mafikeng|klerksdorp|potchefstroom|brits|vryburg/i },
  { key: 'northern-cape', label: 'Northern Cape', pattern: /northern[\s-]?cape|kimberley|upington|kuruman|de aar|springbok|kathu/i }
];
function homeWeeklyProvince(v) {
  var text = [v && v.province, v && v.province_name, v && v.state, v && v.region, v && v.location, v && v.address].filter(Boolean).join(' ');
  for (var i = 0; i < HOME_WEEKLY_PROVINCES.length; i++) if (HOME_WEEKLY_PROVINCES[i].pattern.test(text)) return HOME_WEEKLY_PROVINCES[i];
  return null;
}
function homeWeeklyRows() {
  var now = Date.now(), week = 7 * 864e5, rows = [], seen = {};
  homeSourceVacancies().forEach(function (v) {
    if (!v || seen[v.id]) return;
    var posted = new Date(v.created_at || v.posted_at || v.updated_at || 0).getTime();
    var province = homeWeeklyProvince(v);
    if (!province || !posted || now - posted < 0 || now - posted > week) return;
    seen[v.id] = true;
    rows.push({ vacancy: v, province: province, score: (v.is_featured ? 100000000000 : 0) + posted });
  });
  var byProvince = {};
  rows.forEach(function (item) { (byProvince[item.province.key] || (byProvince[item.province.key] = [])).push(item); });
  return HOME_WEEKLY_PROVINCES.map(function (province) {
    var items = (byProvince[province.key] || []).sort(function (a, b) { return b.score - a.score; });
    return { province: province, items: items.slice(0, 5), total: items.length };
  }).filter(function (group) { return group.total > 0; }).sort(function (a, b) { return b.total - a.total || b.items[0].score - a.items[0].score; }).slice(0, 3);
}
function homeWeeklyTopJobsMarkup() {
  var groups = homeWeeklyRows();
  if (!groups.length) return '<section class="home-weekly-section" aria-labelledby="home-weekly-title"><div class="home-section-heading"><div><span class="home-section-kicker">This week</span><h2 id="home-weekly-title">Top Jobs This Week</h2><p>Provincial highlights will appear as this week’s listings arrive.</p></div></div><div class="home-weekly-empty">No new provincial highlights are available yet.</div></section>';
  return '<section class="home-weekly-section" aria-labelledby="home-weekly-title"><div class="home-section-heading"><div><span class="home-section-kicker">This week</span><h2 id="home-weekly-title">Top Jobs This Week</h2><p>The three provinces with the strongest new vacancy activity this week.</p></div><button type="button" class="home-view-all" onclick="showAllVacancies(\'home\')">View all<span aria-hidden="true"> →</span></button></div><div class="home-weekly-grid">' + groups.map(function (group) {
    return '<article class="home-weekly-province"><header class="home-weekly-province-head"><div class="home-weekly-province-title"><span class="home-weekly-pin" aria-hidden="true">●</span><div><strong>' + escapeHtml(group.province.label) + '</strong><small>' + group.total + ' new role' + (group.total === 1 ? '' : 's') + '</small></div></div><a href="/jobs/' + group.province.key + '/" aria-label="View all ' + escapeHtml(group.province.label) + ' jobs">See province</a></header><div class="home-weekly-table" role="list" aria-label="Top jobs in ' + escapeHtml(group.province.label) + '">' + group.items.map(function (item, index) {
      var v = item.vacancy;
      var agency = v.agency_id && v.agency_id !== 'general' && typeof agenciesCache !== 'undefined' ? (agenciesCache.find(function (a) { return a.id === v.agency_id; }) || {}) : {};
      var company = v.company || agency.name || 'SA Recruiters listing';
      return '<button type="button" class="home-weekly-row" role="listitem" onclick="openHomeWeeklyVacancy(\'' + String(v.id).replace(/[\\']/g, '\\$&') + '\')"><span class="home-weekly-rank">' + String(index + 1).padStart(2, '0') + '</span><span class="home-weekly-job"><strong>' + escapeHtml(v.title || 'Untitled role') + '</strong><small>' + escapeHtml(company) + (v.location ? ' · ' + escapeHtml(v.location) : '') + '</small></span><span class="home-weekly-arrow" aria-hidden="true">›</span></button>';
    }).join('') + '</div></article>';
  }).join('') + '</div></section>';
}
window.openHomeWeeklyVacancy = function (id) {
  var source = homeSourceVacancies().find(function (v) { return String(v.id) === String(id); });
  showAllVacancies('home');
  setTimeout(function () {
    var card = Array.prototype.find.call(document.querySelectorAll('#screen-allvacancies [data-vacancy-id]'), function (node) { return String(node.getAttribute('data-vacancy-id')) === String(id); });
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); var head = card.querySelector('.vx-head'); if (head) head.click(); return; }
    var search = document.getElementById('allvacancies-search');
    if (search && source) { search.value = source.title || ''; if (typeof renderAllVacanciesList === 'function') renderAllVacanciesList(); }
  }, 120);
};
function homeAvailableRoleGroups(rows) {
  var grouped = {};
  (rows || []).forEach(function (v) {
    var province = homeWeeklyProvince(v);
    if (!province) return;
    var group = grouped[province.key] || (grouped[province.key] = { province: province, rows: [], seen: {} });
    var title = String(v.title || 'Untitled role').trim();
    var dedupe = title.toLowerCase();
    if (group.seen[dedupe]) return;
    group.seen[dedupe] = true;
    group.rows.push(v);
  });
  return HOME_WEEKLY_PROVINCES.map(function (province) { return grouped[province.key]; })
    .filter(function (group) { return group && group.rows.length; })
    .sort(function (a, b) { return b.rows.length - a.rows.length || a.province.label.localeCompare(b.province.label); })
    .slice(0, 3);
}
function homeAvailableRolesMarkup(rows) {
  var groups = homeAvailableRoleGroups(rows);
  if (!groups.length) return '<div class="home-feed-empty" role="status"><strong>No provincial roles match yet.</strong><p>Try another search or browse all live roles.</p><button type="button" onclick="clearHomeFeedFilters()">Clear filters</button></div>';
  return '<div class="home-available-groups">' + groups.map(function (group) {
    return '<article class="home-available-group"><header><span class="home-available-group-pin" aria-hidden="true">●</span><div><strong>' + escapeHtml(group.province.label) + '</strong><small>' + group.rows.length + ' available role' + (group.rows.length === 1 ? '' : 's') + '</small></div></header><div class="home-available-role-list" role="list">' + group.rows.slice(0, 8).map(function (v, index) {
      return '<button type="button" class="home-available-role" role="listitem" onclick="openHomeWeeklyVacancy(\'' + String(v.id).replace(/[\\']/g, '\\$&') + '\')"><span class="home-available-role-index">' + String(index + 1).padStart(2, '0') + '</span><span><strong>' + escapeHtml(v.title || 'Untitled role') + '</strong><small>' + escapeHtml(v.company || v.location || 'View vacancy details') + '</small></span><span aria-hidden="true">›</span></button>';
    }).join('') + (group.rows.length > 8 ? '<button type="button" class="home-available-more" onclick="openHomeWeeklyVacancy(\'' + String(group.rows[0].id).replace(/[\\']/g, '\\$&') + '\')">+' + (group.rows.length - 8) + ' more roles</button>' : '') + '</div></article>';
  }).join('') + '</div>';
}
function renderHomeFeed() {
  var target = document.getElementById('home-feed');
  if (!target) return;
  ensureRetailPriorityVacancies();
  var previouslyOpen = target.querySelector('.vac-card.open');
  var previouslyOpenId = previouslyOpen && previouslyOpen.getAttribute('data-vacancy-id');
  var searchInput = document.getElementById('home-search');
  var query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  var matchingRows = homeSourceVacancies().filter(function (v) {
    return (!query || homeVacancyText(v).indexOf(query) !== -1) &&
      homeVacancyMatchesLocation(v, homeLocationFilter) &&
      homeVacancyMatchesCategory(v, homeCategoryFilter);
  });
  var rows = matchingRows;
  rows.sort(function (a, b) {
    var retailOrder = Number(isRetailPriorityVacancy(b)) - Number(isRetailPriorityVacancy(a));
    return retailOrder || new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });

  var categoryMarkup = HOME_JOB_CATEGORIES.map(function (category) {
    var active = homeCategoryFilter === category.key;
    return '<button type="button" class="home-category-chip' + (active ? ' active' : '') + '" onclick="setHomeCategoryFilter(\'' + category.key + '\')" aria-pressed="' + active + '">' +
      '<span class="home-category-icon" aria-hidden="true">' + category.icon + '</span>' +
      '<span class="home-category-copy"><strong>' + category.label + '</strong><small>' + category.sub + '</small></span></button>';
  }).join('');
  var totalNode = document.getElementById('stat-vacancies');
  var totalLabel = totalNode && totalNode.textContent.trim() && totalNode.textContent.trim() !== '…'
    ? totalNode.textContent.trim() : 'all';
  var filtering = !!(query || homeLocationFilter || homeCategoryFilter);
  var empty = rows.length ? '' : '<div class="home-feed-empty" role="status"><strong>' +
    (filtering ? 'No vacancies match those filters yet.' : 'The latest vacancies are loading or none are available right now.') +
    '</strong><p>Try another search or browse all live roles.</p><button type="button" onclick="clearHomeFeedFilters()">Clear filters</button></div>';

  target.innerHTML = '<section class="home-media-section" id="home-media-section" aria-labelledby="home-media-title">' +
      '<div class="home-section-heading home-section-heading--compact"><div><span class="home-section-kicker">Watch &amp; listen</span><h2 id="home-media-title">Media</h2><p>Useful recruitment content and the Track of the Day.</p></div></div>' +
      '<div class="home-media-video-wrap"><iframe id="home-media-video" title="SA Recruiters media video" src="https://www.youtube.com/embed/HV64XG91tE4?rel=0" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>' +
      '<div class="home-media-track"><div class="home-media-track-art" aria-hidden="true">♫</div><div class="home-media-track-copy"><span>Track of the Day</span><strong id="home-media-track-title">Loading…</strong><small id="home-media-track-artist"></small></div><button type="button" class="home-media-track-play" id="home-media-track-play" disabled onclick="toggleTrackPlay()" aria-label="Play Track of the Day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></div>' +
      '<audio id="track-audio" preload="none" ontimeupdate="updateTrackProgress()" onended="onTrackEnded()" onloadedmetadata="onTrackLoaded()"></audio>' +
    '</section>' +
    '<section class="home-featured-poster" aria-labelledby="home-featured-poster-title"><div class="poster-cta-heading"><span class="poster-cta-kicker">Featured today</span><h2 id="home-featured-poster-title">Vacancy poster of the day</h2><p>A fresh recruitment poster selected automatically for today.</p></div><div class="poster-deck" id="home-featured-poster-slot"><div class="poster-empty">Loading today’s poster…</div></div></section>' +
    homeWeeklyTopJobsMarkup() +
    homeVacancySourceMarkup() +
    '<section class="home-jobs-section" aria-labelledby="home-jobs-title">' +
      '<div class="home-section-heading"><div><span class="home-section-kicker">Opportunities across South Africa</span><h2 id="home-jobs-title">Available roles</h2><p>Retail vacancies first, followed by the newest live listings.</p></div>' +
      '<button type="button" class="home-view-all" onclick="showAllVacancies(\'home\')">View all ' + escapeHtml(totalLabel) + '<span aria-hidden="true"> →</span></button></div>' +
      '<div class="home-available-roles-wrap" aria-live="polite">' + (rows.length ? homeAvailableRolesMarkup(rows) : empty) + '</div>' +
    '</section>' +
    '<section class="home-community-card home-chat-banner" aria-labelledby="home-community-title"><div class="home-chat-banner-top"><span class="home-community-kicker">A space to connect</span><span class="home-chat-live"><span aria-hidden="true"></span> Public community</span></div><div class="home-chat-banner-main"><span class="home-community-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h1l3 3v-3h4a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3Z"/><path d="M10 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-1v3l-3-3"/><path d="M7 8h5M7 11h3"/></svg></span><div class="home-community-copy"><h2 id="home-community-title">TipChat</h2><p>Advice, conversations and vacancies — together.</p><small>Ask questions, share interview wins, and post vacancies as text or posters with South African job seekers.</small></div></div><div class="home-chat-banner-bottom"><div class="home-chat-people" aria-hidden="true"><span>R</span><span>N</span><span>T</span><span>+</span></div><span class="home-chat-people-label">Join the conversation with the community</span><button type="button" onclick="openCommunity()">Open TipChat <span aria-hidden="true">→</span></button></div></section>' +
    '<section class="spotlight-mini home-spotlight" aria-labelledby="home-spotlight-title"><div class="spotlight-mini-head"><div><div class="quick-access-label">Talent Pool spotlight</div><h2 id="home-spotlight-title">Meet our candidates</h2></div><button type="button" data-ripple onclick="goPool(\'profile\')">See all &#8594;</button></div><div class="spotlight-deck" id="home-candidate-spotlight-deck" aria-label="Featured Talent Pool candidates"><div class="poster-empty">Loading candidates…</div></div></section>' +
    '<section class="home-categories-section" aria-labelledby="home-categories-title"><div class="home-section-heading home-section-heading--compact"><div><span class="home-section-kicker">Find your next move</span><h2 id="home-categories-title">Explore top job categories</h2></div></div>' +
      '<div class="home-category-grid">' + categoryMarkup + '</div></section>' +
    '<div id="house-ad-home-middle" class="house-ad-slot" hidden></div>' +
    '<section class="home-tools-section" aria-labelledby="home-tools-title"><div class="home-section-heading home-section-heading--compact"><div><span class="home-section-kicker">Start here</span><h2 id="home-tools-title">Take your next step</h2><p>Whether you’re looking for work or hiring talent, start here.</p></div></div>' +
      '<div class="home-tools-grid">' +
        '<article class="home-tool-card home-tool-card--seeker"><div class="home-tool-top"><div class="home-tool-icon" aria-hidden="true">CV</div><span class="home-tool-badge">Free to use</span></div><div class="home-tool-copy"><h3>Get discovered by recruiters</h3><p>Upload your CV to the Talent Pool and browse current opportunities.</p></div><div class="home-tool-actions"><button type="button" onclick="openHomeTalentPoolProfile()">Upload / update CV <span aria-hidden="true">→</span></button><button type="button" class="secondary" onclick="showAllVacancies(\'home\')">Browse vacancies <span aria-hidden="true">→</span></button></div></article>' +
        '<article class="home-tool-card home-tool-card--employer"><div class="home-tool-top"><div class="home-tool-icon" aria-hidden="true">＋</div><span class="home-tool-badge">Reach active candidates</span></div><div class="home-tool-copy"><h3>Reach active candidates</h3><p>Post a vacancy or share a recruitment poster with the SA job-seeking community.</p></div><div class="home-tool-actions"><button type="button" onclick="openGeneralVacancySheet()">Post a vacancy <span aria-hidden="true">→</span></button><button type="button" class="secondary" onclick="openPublicPosterSheet()">Post a poster</button><button type="button" class="secondary" onclick="goPool(\'profile\')">Browse candidates</button></div></article>' +
      '</div></section>';

  target.setAttribute('aria-busy', 'false');
  if (typeof renderHomeFeaturedPoster === 'function') renderHomeFeaturedPoster(typeof postersCache !== 'undefined' ? postersCache : []);
  if (typeof renderHomeMediaSection === 'function') renderHomeMediaSection();
  if (typeof renderHouseAdSlots === 'function') renderHouseAdSlots();
  if (typeof todayTrack !== 'undefined' && todayTrack) renderTrackReady();
  else if (typeof renderTrackEmpty === 'function') renderTrackEmpty();
  if (typeof loadCandidateSpotlight === 'function') loadCandidateSpotlight();
  if (previouslyOpenId) {
    target.querySelectorAll('.vac-card').forEach(function (card) {
      if (card.getAttribute('data-vacancy-id') === previouslyOpenId) {
        card.classList.add('open');
        card.setAttribute('aria-expanded', 'true');
        var trigger = card.querySelector('[aria-controls]');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
      }
    });
  }
  document.querySelectorAll('.home-filter-chip[data-home-location]').forEach(function (button) {
    var value = button.getAttribute('data-home-location') || '';
    if (value === 'all') value = '';
    var active = value === (homeLocationFilter || '');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// Public section links are intentionally query-based so Cloudflare Pages can
// serve the normal PWA shell while the link remains stable and easy to share:
// /?section=vacancies, /?section=agencies, /?section=candidates,
// /?section=posters and /?section=employers.
var SA_SECTION_LINKS = {
  vacancies: { label: 'Vacancies', title: 'SA Recruiters — Vacancies' },
  agencies: { label: 'Recruitment agencies', title: 'SA Recruiters — Recruitment Agencies' },
  candidates: { label: 'Join the Talent Pool', title: 'SA Recruiters — Join the Talent Pool', shareKey: 'talent-pool' },
  posters: { label: 'Vacancy posters', title: 'SA Recruiters — Vacancy Posters' },
  employers: { label: 'Employers', title: 'SA Recruiters — Employers' }
};
function getSectionLink(section) {
  if (!SA_SECTION_LINKS[section]) return '';
  var key = SA_SECTION_LINKS[section].shareKey || section;
  return window.location.origin + '/?section=' + encodeURIComponent(key);
}
function shareSectionLink(section) {
  var meta = SA_SECTION_LINKS[section];
  var link = getSectionLink(section);
  if (!meta || !link) return;
  var shareLabel = section === 'candidates' ? 'Join the Talent Pool' : meta.label;
  var text = (section === 'candidates' ? shareLabel : 'Explore ' + shareLabel.toLowerCase()) + ' on SA Recruiters: ' + link;
  if (navigator.share) {
    navigator.share({ title: meta.title, text: text, url: link }).catch(function() {});
  } else {
    copyText(link, null);
    showToast(meta.label + ' link copied');
  }
}
function openDeepLinkedSection() {
  var section = new URLSearchParams(window.location.search).get('section');
  if (section === 'talent-pool') section = 'candidates';
  if (!SA_SECTION_LINKS[section]) return;
  // Treat a promoted URL like a restored screen. loadAll() calls
  // renderRestoredScreenContent() after IndexedDB/live data hydration, which
  // prevents the destination from staying on an early loading/count state.
  var screenBySection = {
    vacancies: 'allvacancies', agencies: 'allagencies', candidates: 'pool',
    posters: 'allposters', employers: 'allemployers'
  };
  window.__saRestoredScreen = screenBySection[section];
  if (section === 'vacancies') showAllVacancies('home');
  else if (section === 'agencies') showAllAgencies('home');
  else if (section === 'candidates') goPool('home');
  else if (section === 'posters') showVacancyPosters('home');
  else if (section === 'employers') showAllEmployers('home');
}
// Wait until the normal boot has painted the shell; the destination functions
// then render from IndexedDB immediately and refresh from the network normally.

// All navigation paths in this app eventually toggle a screen's `active`
// class. Observing that single state change keeps refresh restoration in sync
// without relying on every individual menu/card handler remembering to call a
// second persistence helper.
if (window.MutationObserver) {
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') return;
      var el = m.target;
      if (!el.classList.contains('screen') || !el.classList.contains('active')) return;
      persistActiveScreen(el.id.replace(/^screen-/, ''));
    });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
function openSiteMenu() {
  var drawer = document.getElementById('site-menu-drawer');
  var backdrop = document.getElementById('site-menu-backdrop');
  var trigger = document.getElementById('site-menu-trigger');
  if (!drawer || !backdrop) return;
  drawer.classList.add('is-open');
  backdrop.classList.add('is-visible');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.setAttribute('aria-hidden', 'false');
  document.querySelectorAll('.site-menu-trigger').forEach(function(btn) { btn.setAttribute('aria-expanded', 'true'); });
  document.body.classList.add('site-menu-open');
}
function closeSiteMenu() {
  var drawer = document.getElementById('site-menu-drawer');
  var backdrop = document.getElementById('site-menu-backdrop');
  var trigger = document.getElementById('site-menu-trigger');
  if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
  if (backdrop) { backdrop.classList.remove('is-visible'); backdrop.setAttribute('aria-hidden', 'true'); }
  // The trigger exists in every screen's header (the iOS-style site menu update);
  // return focus to the one on the screen the user is actually viewing.
  var activeTrigger = document.querySelector('.screen.active .site-menu-trigger') || trigger;
  document.querySelectorAll('.site-menu-trigger').forEach(function(btn) { btn.setAttribute('aria-expanded', 'false'); });
  if (activeTrigger) activeTrigger.focus();
  document.body.classList.remove('site-menu-open');
}
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeSiteMenu();
});

document.querySelectorAll('.navbtn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!btn.dataset.tab) return; // action buttons (e.g. Feedback) handle their own click
    document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById('screen-' + btn.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0 });
    if (btn.dataset.tab === 'saved') renderSaved();
    if (btn.dataset.tab === 'account') renderAccountDetails();
    if (btn.dataset.tab === 'menu' && typeof loadCandidateSpotlight === 'function') loadCandidateSpotlight();
  });
});

function renderRestoredScreenContent() {
  var name = window.__saRestoredScreen;
  if (!name) return;
  if (name === 'account' && typeof renderAccountDetails === 'function') renderAccountDetails();
  else if (name === 'saved' && typeof renderSaved === 'function') renderSaved();
  else if (name === 'allagencies' && typeof renderAllAgenciesList === 'function') renderAllAgenciesList();
  else if (name === 'allbranches' && typeof renderAllBranchesList === 'function') renderAllBranchesList();
  else if (name === 'allemployers' && typeof renderAllEmployersList === 'function') renderAllEmployersList();
  else if (name === 'allvacancies' && typeof renderAllVacanciesList === 'function') renderAllVacanciesList();
  else if (name === 'allposters') {
    if (typeof renderPosterFeed === 'function') renderPosterFeed(postersCache);
    if (typeof loadPosterFeed === 'function') loadPosterFeed();
  } else if (name === 'pool' && typeof loadPoolCandidates === 'function') {
    loadPoolCandidates();
  }
}
window.renderRestoredScreenContent = renderRestoredScreenContent;

// ===== Home horizontal navigation =====
function scrollStats(direction) {
  var row = document.getElementById('home-stats');
  if (!row) return;
  var card = row.querySelector('.stat-card');
  var amount = card ? card.getBoundingClientRect().width + 8 : row.clientWidth * 0.8;
  row.scrollBy({ left: direction * amount, behavior: 'smooth' });
}
function updateCtaDots() {
  var carousel = document.getElementById('cta-carousel');
  var dots = document.querySelectorAll('.cta-swipe-dots button');
  if (!carousel || !dots.length) return;
  var index = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
  index = Math.max(0, Math.min(dots.length - 1, index));
  dots.forEach(function(dot, i) {
    dot.classList.toggle('active', i === index);
    dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
}
function scrollCtaPanel(direction) {
  var carousel = document.getElementById('cta-carousel');
  if (!carousel) return;
  carousel.scrollBy({ left: direction * carousel.clientWidth, behavior: 'smooth' });
  setTimeout(updateCtaDots, 220);
}
function setCtaPanel(index) {
  var carousel = document.getElementById('cta-carousel');
  if (!carousel) return;
  carousel.scrollTo({ left: Math.max(0, Math.min(2, index)) * carousel.clientWidth, behavior: 'smooth' });
  setTimeout(updateCtaDots, 220);
}
(function initHomeHorizontalNavigation() {
  var carousel = document.getElementById('cta-carousel');
  if (carousel) carousel.addEventListener('scroll', updateCtaDots, { passive: true });
})();
function refreshHome() {
  // Home is already hydrated; returning here must not refetch or rebuild the app.
  if (typeof goBackToHome === 'function') goBackToHome();
}

// ===== Toast =====
var toastTimer;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
}

// ===== Force update: activate the waiting production worker safely =====
function forceUpdate() {
  showToast('Updating SA Recruiters…');
  if (!('serviceWorker' in navigator)) { window.location.reload(); return; }
  var reloaded = false;
  function reloadOnce() {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  }
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
  navigator.serviceWorker.getRegistration('/').then(function(registration) {
    if (!registration) { reloadOnce(); return; }
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      registration.update().then(reloadOnce).catch(reloadOnce);
    }
  }).catch(reloadOnce);
}

function dismissUpdateBanner() {
  var banner = document.getElementById('update-banner');
  if (banner) { banner.classList.remove('show'); banner.hidden = true; }
  try { sessionStorage.setItem('sa_update_dismissed', '1'); } catch (e) {}
  try { trackEvent('service_worker_update_dismissed', 'pwa', null); } catch (e) {}
}
function forceUpdateReload() {
  var banner = document.getElementById('update-banner');
  if (banner) { banner.classList.remove('show'); banner.hidden = true; }
  try { sessionStorage.removeItem('sa_update_dismissed'); } catch (e) {}
  try { trackEvent('service_worker_update_accepted', 'pwa', null); } catch (e) {}
  forceUpdate();
}

// ===== Retry banner: shown when a data refresh genuinely fails =====
// Unlike the offline.html fallback (which is the service worker's last
// resort for a broken navigation), this is an honest, in-app signal that
// the *data* refresh failed while the app itself is fine — the person can
// see it happened and tap to try again, instead of the screen silently
// staying frozen or looking emptier than it should.
function setRetryBanner(show) {
  var el = document.getElementById('retry-banner');
  if (!el) return;
  el.classList.toggle('show', !!show);
}
function retryLoadAll() {
  var btn = document.querySelector('#retry-banner button');
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
  loadAll({ fresh: true }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  });
}

// ===== Ripple =====
document.addEventListener('pointerdown', function(e) {
  var el = e.target.closest('[data-ripple]');
  if (!el) return;
  var rect = el.getBoundingClientRect();
  var size = Math.max(rect.width, rect.height) * 1.4;
  var span = document.createElement('span');
  span.className = 'ripple-el';
  span.style.width = span.style.height = size + 'px';
  span.style.left = (e.clientX - rect.left - size/2) + 'px';
  span.style.top = (e.clientY - rect.top - size/2) + 'px';
  el.appendChild(span);
  span.addEventListener('animationend', function(){ span.remove(); });
});

// ===== SUBMISSIONS (admin section — reports & suggestions) =====
var subCurrentTab = 'reports';
var subReportsCache = [];
var subSuggestionsCache = [];

function goSubmissions() {
  if (!isAdmin) return;
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-submissions').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  subCurrentTab = 'reports';
  switchSubTab('reports');
}

function closeTalentPool() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var targetId = poolReturnScreen === 'profile' ? 'screen-account' : 'screen-home';
  var target = document.getElementById(targetId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === (poolReturnScreen === 'profile' ? 'account' : 'home')); });
  resetActiveScreenScroll(targetId);
}
window.closeTalentPool = closeTalentPool;
function goBackFromPool() {
  closeTalentPool();
}
function goBackToProfile() {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-account').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'account'); });
  resetActiveScreenScroll('screen-account');
}

// ===== MY ACCOUNT (general signed-in profile) =====
// A general account view — Google identity, preferences and activity — that is
// deliberately separate from the Talent Pool product. The Talent Pool listing
// stays a scoped section inside it ("Your listing"), not the account itself.
var accountReturnScreen = 'profile';

function openAccountScreen() {
  var active = document.querySelector('.screen.active');
  accountReturnScreen = active && active.id !== 'screen-account' ? active.id.replace(/^screen-/, '') : accountReturnScreen || 'profile';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-account').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'account'); });
  resetActiveScreenScroll('screen-account');
  renderAccountDetails();
}
window.openAccountScreen = openAccountScreen;

// Keyboard activation for the drawer's account card (role="button" div):
// Enter/Space opens the account screen, other keys are ignored. Clicks are
// handled by the card's own onclick.
function activateAccountFromMenu(e) {
  if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  closeSiteMenu();
  openAccountScreen();
}
window.activateAccountFromMenu = activateAccountFromMenu;

// Composite cards are retained for the mobile visual design, but they must
// behave like native controls for keyboard and switch-device users.
document.addEventListener('keydown', function(e) {
  var el = e.target;
  if (!el || !el.classList) return;
  if ((el.classList.contains('stat-card') || el.classList.contains('vac-card')) &&
      (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    el.click();
  }
});

function goBackFromAccount() {
  var targetId = 'screen-' + (accountReturnScreen || 'profile');
  if (!document.getElementById(targetId)) targetId = 'screen-account';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById(targetId).classList.add('active');
  var tab = targetId.replace(/^screen-/, '');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === tab); });
  resetActiveScreenScroll(targetId);
}
window.goBackFromAccount = goBackFromAccount;

// Mirrors the identity (renderAuthUser) into the account hero card and
// switches the screen between guest mode (sign-in card + daily quota) and
// signed-in mode (Google identity + sign-out group).
function renderAccountIdentity(user) {
  var name = user && (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user.email) || 'Guest';
  var avatar = user && user.user_metadata && (user.user_metadata.profile_photo || user.user_metadata.avatar_url);
  var isGuest = !user;
  var nameEl = document.getElementById('account-name');
  var emailEl = document.getElementById('account-email');
  var avatarEl = document.getElementById('account-avatar');
  var providerEl = document.getElementById('account-provider');
  if (nameEl) nameEl.textContent = user ? name : 'Guest';
  if (emailEl) emailEl.textContent = user ? (user.email || '—') : 'Browsing as a guest';
  if (avatarEl) {
    avatarEl.innerHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" alt="" decoding="async" referrerpolicy="no-referrer">' : '<span>' + escapeHtml((name || 'A').charAt(0).toUpperCase()) + '</span>';
  }
  if (providerEl) providerEl.style.display = user ? 'inline-flex' : 'none';
  // Guest chrome: sign-in card + quota meter. Signed-in chrome: sign-out.
  var signinCard = document.getElementById('account-signin-card');
  if (signinCard) {
    signinCard.hidden = !isGuest;
    signinCard.setAttribute('aria-hidden', isGuest ? 'false' : 'true');
  }
  var quotaCard = document.getElementById('account-quota-card');
  if (quotaCard) quotaCard.hidden = !isGuest;
  var signoutGroup = document.getElementById('account-signout-group');
  if (signoutGroup) signoutGroup.hidden = isGuest;
  var guestTeaser = document.getElementById('guest-teaser');
  if (guestTeaser) guestTeaser.style.display = user ? 'none' : 'flex';
  var meta = document.getElementById('account-meta');
  if (meta) {
    var joined = user && user.created_at ? new Date(user.created_at) : null;
    meta.textContent = joined && !isNaN(joined) ? 'Member since ' + joined.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) : '';
  }
  renderAccountQuota();
}

// Daily free-view meter shown to guests on the account screen.
function renderAccountQuota() {
  var countEl = document.getElementById('account-quota-count');
  var fillEl = document.getElementById('account-quota-fill');
  var noteEl = document.getElementById('account-quota-note');
  if (saAuthUser) return; // signed-in users are unmetered; card is hidden
  if (typeof guestQuotaState !== 'function') return;
  var q = guestQuotaState();
  var left = Math.max(0, q.limit - q.used);
  if (countEl) countEl.textContent = left + ' of ' + q.limit + ' left';
  if (fillEl) {
    var pct = Math.round((left / q.limit) * 100);
    fillEl.style.width = pct + '%';
    fillEl.classList.toggle('low', left <= 1);
  }
  if (noteEl) noteEl.textContent = left > 0
    ? left + (left === 1 ? ' free view left today.' : ' free views left today — full access is unlocked with a free account.')
    : 'Free views used — create an account for unlimited access.';
}

// "Your listing" status: reflects whether the signed-in user currently has a
// pool_candidates row linked, so the account view stays honest about the fact
// that the Talent Pool is a product scoped to pool_candidates — not the
// account itself.
async function renderAccountPoolStatus() {
  var el = document.getElementById('account-pool-status');
  if (!el) return;
  if (!saAuthUser || !supabaseClient) { el.textContent = 'Join free — available after you create an account'; return; }
  try {
    var res = await supabaseClient.from('pool_candidates').select('id').eq('user_id', saAuthUser.id).limit(1).maybeSingle();
    if (el) el.textContent = (res && res.data) ? 'Listed — tap to edit your Mini-CV' : 'Not listed yet — join free';
  } catch(e) { /* keep default copy on failure */ }
}

function renderAccountDetails() {
  renderAccountIdentity(saAuthUser);
  renderAccountPoolStatus();
  renderProfileSettingsVisibility();
}
window.renderAccountDetails = renderAccountDetails;

// ===== PROFILE SETTINGS (edit name, photo, delete account) =====
// Available to signed-in users only. The name is stored on the Supabase auth
// user (user_metadata.full_name) and the photo is uploaded through the
// Worker's media endpoint (candidate-photos bucket, same pipeline as Talent
// Pool photos) with the URL kept in user_metadata.profile_photo.
function renderProfileSettingsVisibility() {
  var group = document.getElementById('account-settings-group');
  if (group) group.style.display = saAuthUser ? 'block' : 'none';
}
window.renderProfileSettingsVisibility = renderProfileSettingsVisibility;

function setProfileSettingsStatus(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || '';
}

function profilePhotoUrl() {
  return saAuthUser && saAuthUser.user_metadata && saAuthUser.user_metadata.profile_photo || null;
}

function openEditProfileSheet() {
  if (!saAuthUser) { showToast('Create your free account first — open sign-in below.'); return; }
  var nameEl = document.getElementById('ep-name');
  var emailEl = document.getElementById('ep-email');
  if (nameEl) nameEl.value = (saAuthUser.user_metadata && (saAuthUser.user_metadata.full_name || saAuthUser.user_metadata.name)) || '';
  if (emailEl) emailEl.value = saAuthUser.email || '';
  setProfileSettingsStatus('edit-profile-status', '');
  var overlay = document.getElementById('edit-profile-overlay');
  if (overlay) overlay.classList.add('open');
}
window.openEditProfileSheet = openEditProfileSheet;

async function saveProfileEdits() {
  var nameEl = document.getElementById('ep-name');
  var btn = document.getElementById('edit-profile-save-btn');
  var name = (nameEl && nameEl.value || '').trim();
  if (!name) { setProfileSettingsStatus('edit-profile-status', 'Please enter a display name.'); return; }
  if (!supabaseClient || !saAuthUser) { setProfileSettingsStatus('edit-profile-status', 'You need to be signed in.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  setProfileSettingsStatus('edit-profile-status', '');
  var meta = Object.assign({}, saAuthUser.user_metadata, { full_name: name });
  var res = await supabaseClient.auth.updateUser({ data: meta });
  if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
  if (res && res.error) {
    setProfileSettingsStatus('edit-profile-status', 'Could not save — ' + res.error.message);
    return;
  }
  saAuthUser = res && res.user ? res.user : saAuthUser;
  renderAuthUser(saAuthUser);
  renderAccountDetails();
  closeSheet('edit-profile-overlay');
  showToast('Profile updated');
}
window.saveProfileEdits = saveProfileEdits;

function openProfilePhotoSheet() {
  if (!saAuthUser) { showToast('Create your free account first — open sign-in below.'); return; }
  var url = profilePhotoUrl();
  var preview = document.getElementById('pp-preview');
  var fallback = document.getElementById('pp-fallback');
  var removeBtn = document.getElementById('profile-photo-remove-btn');
  window.pendingProfilePhotoBlob = null;
  if (preview) {
    if (url) { preview.src = url; preview.style.display = 'block'; if (fallback) fallback.style.display = 'none'; }
    else { preview.style.display = 'none'; if (fallback) fallback.style.display = 'flex'; }
  }
  if (removeBtn) removeBtn.style.display = url ? 'block' : 'none';
  setProfileSettingsStatus('profile-photo-status', '');
  var overlay = document.getElementById('profile-photo-overlay');
  if (overlay) overlay.classList.add('open');
}
window.openProfilePhotoSheet = openProfilePhotoSheet;

// Reuses the Talent Pool photo pipeline: centre-crop to a 512x512 square and
// keep the blob locally until Save, so nothing uploads until the user commits.
function handleProfilePhoto(evt) {
  var file = evt.target.files && evt.target.files[0];
  if (!file) return;
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
        window.pendingProfilePhotoBlob = blob;
        var preview = document.getElementById('pp-preview');
        var fallback = document.getElementById('pp-fallback');
        var url = URL.createObjectURL(blob);
        if (preview) { preview.src = url; preview.style.display = 'block'; }
        if (fallback) fallback.style.display = 'none';
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
window.handleProfilePhoto = handleProfilePhoto;

async function saveProfilePhoto() {
  var btn = document.getElementById('profile-photo-save-btn');
  if (!supabaseClient || !saAuthUser) { setProfileSettingsStatus('profile-photo-status', 'You need to be signed in.'); return; }
  var meta = Object.assign({}, saAuthUser.user_metadata);
  var existing = meta.profile_photo || null;
  if (window.pendingProfilePhotoBlob) {
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
    setProfileSettingsStatus('profile-photo-status', 'Uploading photo…');
    try {
      var res = await fetch(R2_WORKER_URL + '/api/upload/candidate-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: window.pendingProfilePhotoBlob
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok || !data.url) throw new Error((data && data.error) || 'Upload failed');
      meta.profile_photo = data.url;
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save photo'; }
      setProfileSettingsStatus('profile-photo-status', 'Photo upload failed — please try again.');
      return;
    }
  } else if (!existing) {
    setProfileSettingsStatus('profile-photo-status', 'Choose a photo first.');
    return;
  }
  var upd = await supabaseClient.auth.updateUser({ data: meta });
  if (btn) { btn.disabled = false; btn.textContent = 'Save photo'; }
  if (upd && upd.error) {
    setProfileSettingsStatus('profile-photo-status', 'Could not save — ' + upd.error.message);
    return;
  }
  saAuthUser = upd && upd.user ? upd.user : saAuthUser;
  window.pendingProfilePhotoBlob = null;
  renderAuthUser(saAuthUser);
  renderAccountDetails();
  closeSheet('profile-photo-overlay');
  showToast('Profile photo saved');
}
window.saveProfilePhoto = saveProfilePhoto;

async function removeProfilePhoto() {
  if (!supabaseClient || !saAuthUser) return;
  var meta = Object.assign({}, saAuthUser.user_metadata);
  delete meta.profile_photo;
  var btn = document.getElementById('profile-photo-remove-btn');
  if (btn) { btn.disabled = true; }
  var upd = await supabaseClient.auth.updateUser({ data: meta });
  if (btn) { btn.disabled = false; }
  if (upd && upd.error) {
    setProfileSettingsStatus('profile-photo-status', 'Could not remove the photo — please try again.');
    return;
  }
  saAuthUser = upd && upd.user ? upd.user : saAuthUser;
  window.pendingProfilePhotoBlob = null;
  renderAuthUser(saAuthUser);
  renderAccountDetails();
  var preview = document.getElementById('pp-preview');
  var fallback = document.getElementById('pp-fallback');
  var removeBtn = document.getElementById('profile-photo-remove-btn');
  if (preview) preview.style.display = 'none';
  if (fallback) fallback.style.display = 'flex';
  if (removeBtn) removeBtn.style.display = 'none';
  showToast('Profile photo removed');
}
window.removeProfilePhoto = removeProfilePhoto;

function openDeleteAccountSheet() {
  if (!saAuthUser) { showToast('You are browsing as a guest — nothing to delete.'); return; }
  var confirmEl = document.getElementById('da-confirm');
  if (confirmEl) confirmEl.value = '';
  setProfileSettingsStatus('delete-account-status', '');
  var overlay = document.getElementById('delete-account-overlay');
  if (overlay) overlay.classList.add('open');
}
window.openDeleteAccountSheet = openDeleteAccountSheet;

async function confirmDeleteAccount() {
  var confirmEl = document.getElementById('da-confirm');
  var btn = document.getElementById('delete-account-btn');
  if (!confirmEl || (confirmEl.value || '').trim().toUpperCase() !== 'DELETE') {
    setProfileSettingsStatus('delete-account-status', 'Type DELETE to confirm.');
    return;
  }
  if (!supabaseClient || !saAuthUser) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  setProfileSettingsStatus('delete-account-status', '');
  var authToken = null;
  try {
    var sessionResult = await supabaseClient.auth.getSession();
    authToken = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
  } catch(e) {}
  if (!authToken) {
    if (btn) { btn.disabled = false; btn.textContent = 'Delete my account permanently'; }
    setProfileSettingsStatus('delete-account-status', 'Could not verify your session — please sign in again.');
    return;
  }
  var ok = false;
  try {
    var res = await fetch(R2_WORKER_URL + '/api/account/delete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    var data = await res.json().catch(function(){ return {}; });
    ok = res.ok && data && data.ok;
    if (!ok) console.error('account delete', data && data.error);
  } catch(e) { console.error('account delete', e); }
  if (btn) { btn.disabled = false; btn.textContent = 'Delete my account permanently'; }
  if (!ok) {
    setProfileSettingsStatus('delete-account-status', 'Could not delete right now — please try again or contact support.');
    return;
  }
  closeSheet('delete-account-overlay');
  await signOutSaRecruiters();
  showToast('Your account has been deleted.');
}
window.confirmDeleteAccount = confirmDeleteAccount;

function goBackToHome() {
  // If we're leaving a manager/manager-status screen, restore the normal app
  // chrome (bottom nav + admin FAB) that those screens hide on entry.
  if (managerMode) { try { exitManagerMode(); return; } catch(e){} }
  if (employerManagerMode) { try { exitEmployerManagerMode(); return; } catch(e){} }
  // Also covers the manager-link STATUS screen (loading/invalid), which hides
  // the nav but doesn't set managerMode/employerManagerMode.
  var nav = document.querySelector('.bottom-nav');
  if (nav && nav.style.display === 'none') nav.style.display = '';
  var fabAdmin = document.getElementById('fab-admin');
  if (fabAdmin && fabAdmin.style.display === 'none') fabAdmin.style.display = isAdmin ? 'flex' : 'none';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var home = document.getElementById('screen-home');
  if (home) home.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'home'); });
  resetActiveScreenScroll('screen-home');
}

// Show / hide a Contact Details card (accordion)
window.toggleContactCard = function(headEl) {
  var card = headEl.closest('.contact-card');
  if (!card) return;
  var open = card.classList.toggle('open');
  headEl.setAttribute('aria-expanded', open ? 'true' : 'false');
};

// ===== Stats bar: clickable list views =====
function goBackHome() {
  directoryReturnScreen = 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-home').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === 'home'); });
  resetActiveScreenScroll('screen-home');
}

function resetActiveScreenScroll(screenId) {
  var screen = document.getElementById(screenId);
  if (!screen) return;
  var scroll = screen.querySelector('.screen-scroll');
  if (scroll) scroll.scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function goBackFromDirectory() {
  var target = directoryReturnScreen || 'home';
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var targetScreen = document.getElementById('screen-' + target);
  if (!targetScreen) targetScreen = document.getElementById('screen-home');
  targetScreen.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === target); });
  resetActiveScreenScroll(targetScreen.id);
}

function showAllAgencies() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allagencies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllAgenciesList();
}

function showAllBranches() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allbranches').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo({ top: 0 });
  renderAllBranchesList();
}

function showAllVacancies() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allvacancies').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  allVacanciesFolder = null;
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}

// Vacancy posters live on their own screen, separate from All Vacancies.
function showVacancyPosters() {
  directoryReturnScreen = arguments.length && arguments[0] ? arguments[0] : (document.getElementById('screen-account').classList.contains('active') ? 'account' : 'home');
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-allposters').classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  var search = document.getElementById('allposters-search');
  if (search) search.value = '';
  renderPosterFeed(postersCache);
  if (typeof loadPosterFeed === 'function') loadPosterFeed();
  resetActiveScreenScroll('screen-allposters');
}

// ---- Precise-location filter (Agencies / Branches / Employers / Vacancies / Pool) ----
// None of these records carry GPS coordinates, only a free-text location
// (e.g. "Durban, KZN"), so real distance sorting isn't possible without a
// backend change (geocoding every listing + storing lat/lng). This detects
// the device's area via the browser's geolocation + a no-key reverse-geocode
// lookup, then drives the same text search each list already filters on --
// same result as typing the area in. The reverse-geocode lookup resolves to
// the actual locality (e.g. "Wattville" rather than the wider "Benoni"),
// which is as precise as this text-matching approach can get.
var PRECISE_LOCATION_SCREENS = {
  allagencies: { search: 'allagencies-search', chip: 'allagencies-geo-chip', text: 'allagencies-geo-text', render: function(){ renderAllAgenciesList(); } },
  allbranches: { search: 'allbranches-search', chip: 'allbranches-geo-chip', text: 'allbranches-geo-text', render: function(){ renderAllBranchesList(); } },
  allemployers: { search: 'allemployers-search', chip: 'allemployers-geo-chip', text: 'allemployers-geo-text', render: function(){ renderAllEmployersList(); } },
  allvacancies: { search: 'allvacancies-search', chip: 'allvacancies-geo-chip', text: 'allvacancies-geo-text', render: function(){ renderAllVacanciesList(); } },
  pool: { search: 'pool-search', chip: 'pool-geo-chip', text: 'pool-geo-text', render: function(){ renderPoolList(); } }
};
var preciseLocationState = {};

function resetPreciseLocationChipVisual(key) {
  var cfg = PRECISE_LOCATION_SCREENS[key];
  if (!cfg) return;
  var chip = document.getElementById(cfg.chip);
  var label = document.getElementById(cfg.text);
  if (chip) { chip.classList.remove('pl-loading'); chip.classList.remove('pl-active'); }
  if (label) label.textContent = 'Use precise location';
  preciseLocationState[key] = { active: false, query: '' };
}

// Called from each list's render function so the chip auto-reverts to idle
// if the person edits the search box by hand after applying a location.
function syncPreciseLocationChip(key, currentQueryLower) {
  var state = preciseLocationState[key];
  if (state && state.active && currentQueryLower !== state.query) resetPreciseLocationChipVisual(key);
}

function usePreciseLocation(key) {
  var cfg = PRECISE_LOCATION_SCREENS[key];
  if (!cfg) return;
  var chip = document.getElementById(cfg.chip);
  var label = document.getElementById(cfg.text);
  if (!chip || !label) return;
  var state = preciseLocationState[key] || {};

  // Tapping again while a location filter is applied clears it.
  if (state.active) {
    var input = document.getElementById(cfg.search);
    if (input) input.value = '';
    resetPreciseLocationChipVisual(key);
    cfg.render();
    return;
  }

  if (!('geolocation' in navigator)) {
    showToast("Location isn't available on this device");
    return;
  }

  chip.classList.add('pl-loading');
  label.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(function(pos) {
    reverseGeocodeArea(key, pos.coords.latitude, pos.coords.longitude);
  }, function(err) {
    resetPreciseLocationChipVisual(key);
    var msg = "Couldn't get your location";
    if (err && err.code === err.PERMISSION_DENIED) msg = 'Location permission denied';
    else if (err && err.code === err.TIMEOUT) msg = 'Location request timed out';
    showToast(msg);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
}

function reverseGeocodeArea(key, lat, lon) {
  detectAreaFromCoords(lat, lon)
    .then(function(loc) { applyPreciseLocation(key, loc.query); })
    .catch(function() {
      resetPreciseLocationChipVisual(key);
      showToast("Couldn't detect your area — try searching manually");
    });
}

// Shared by the per-screen "Use precise location" chips.
function detectAreaFromCoords(lat, lon) {
  return fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=en')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var area = (data && (data.locality || data.city)) || '';
      var region = (data && data.principalSubdivision) || '';
      var query = [area, region].filter(Boolean).join(', ');
      if (!query) throw new Error('No area found');
      return { area: area, region: region, query: query };
    });
}

function applyPreciseLocation(key, query) {
  var cfg = PRECISE_LOCATION_SCREENS[key];
  if (!cfg) return;
  var chip = document.getElementById(cfg.chip);
  var label = document.getElementById(cfg.text);
  var input = document.getElementById(cfg.search);
  if (input) input.value = query;
  preciseLocationState[key] = { active: true, query: query.toLowerCase() };
  if (chip) { chip.classList.remove('pl-loading'); chip.classList.add('pl-active'); }
  if (label) label.textContent = 'Near: ' + query;
  cfg.render();
  showToast('Showing results near ' + query);
}

function renderAllAgenciesList() {
  var q = ((document.getElementById('allagencies-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('allagencies', q);
  var el = document.getElementById('allagencies-list');
  var list = agenciesCache.slice();
  if (q) {
    list = list.filter(function(a){
      var hay = ((a.name||'') + ' ' + (a.location||'') + ' ' + (a.address||'') + ' ' + (a.companies||'') + ' ' + (a.trades||'') + ' ' + (a.contact||'') + ' ' + (a.email||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  // Sort: verified first, then alphabetical
  list.sort(function(a,b){
    if ((a.verified?1:0) !== (b.verified?1:0)) return (b.verified?1:0) - (a.verified?1:0);
    return (a.name||'').localeCompare(b.name||'');
  });
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No agencies found</h3><p>Try a different search term.</p></div>'; return; }
  var middleAt = Math.max(1, Math.ceil(list.length / 2));
  el.innerHTML = list.map(function(item, index){ return (index === middleAt ? '<div id="house-ad-agencies-middle" class="house-ad-slot" hidden></div>' : '') + hubCard(item); }).join('');
  renderHouseAdSlots();
}

function renderAllBranchesList() {
  var q = ((document.getElementById('allbranches-search')||{}).value || '').trim().toLowerCase();
  syncPreciseLocationChip('allbranches', q);
  var el = document.getElementById('allbranches-list');
  var list = branchesCache.slice().map(function(b){
    var agency = agenciesCache.find(function(a){ return a.id === b.agency_id; });
    b._agencyName = agency ? agency.name : '';
    b._agencyTrades = agency ? (agency.trades||'') : '';
    return b;
  });
  if (q) {
    list = list.filter(function(b){
      var hay = ((b.name||'')+' '+(b.location||'')+' '+(b.phone||'')+' '+(b.email||'')+' '+(b._agencyName||'')+' '+(b._agencyTrades||'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!list.length) { el.innerHTML = '<div class="empty-state"><h3>No branches found</h3><p>Try a different search term.</p></div>'; return; }

  var groups = {};
  list.forEach(function(b){
    var key = b.agency_id || '__unknown__';
    if (!groups[key]) groups[key] = { name: b._agencyName || 'Other / Unassigned', items: [] };
    groups[key].items.push(b);
  });
  var keys = Object.keys(groups).sort(function(a,b){ return groups[a].name.localeCompare(groups[b].name); });
  el.innerHTML = keys.map(function(key){
    var group = groups[key];
    group.items.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
    var rows = group.items.map(function(b){
      var bid = 'ab-' + b.id;
      var head = '<div class="branch-block-head" onclick="toggleBranchBlock(\'' + bid + '\')">' +
        '<div class="hub-contact-body">' +
          '<div class="hub-contact-value">' + escapeHtml(b.name || 'Branch') + '</div>' +
          (b.location ? '<div class="branch-sub">' + VAC_ICONS.pin + escapeHtml(shortLocation(b.location)) + '</div>' : '') +
        '</div>' +
        '<span class="chevron">' + ICON_CHEVRON + '</span>' +
      '</div>';
      var body = '<div class="branch-detail"><div class="branch-detail-inner"><div class="det-plain">';
      body += '<div class="det-row"><span class="det-label">Agency:</span> ' + escapeHtml(group.name) + '</div>';
      if (b.location) body += '<div class="det-row"><span class="det-label">Address:</span> ' + mapsLink(b.location) + '</div>';
      if (b.phone) body += '<div class="det-row"><span class="det-label">Phone:</span> ' + telLink(b.phone) + '</div>';
      if (b.email) body += '<div class="det-row"><span class="det-label">Email:</span> ' + mailLink(b.email) + '</div>';
      body += '</div>';
      if (isAdmin) {
        body += '<div class="branch-detail-actions">' +
          '<button class="br-edit" data-ripple onclick="event.stopPropagation();openBranchSheet(\'' + (b.agency_id||'') + '\',\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg> Edit</button>' +
          '<button class="br-del" data-ripple onclick="event.stopPropagation();deleteBranchAllList(\'' + b.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete</button>' +
        '</div>';
      }
      body += '</div></div>';
      return '<div class="branch-block" id="' + bid + '">' + head + body + '</div>';
    }).join('');
    return '<section class="directory-group" aria-label="' + escapeHtml(group.name) + '">' +
      '<div class="directory-group-head"><div><div class="directory-group-title">' + escapeHtml(group.name) + '</div><div class="directory-group-sub">' + group.items.length + ' branch' + (group.items.length===1?'':'es') + '</div></div></div>' + rows + '</section>';
  }).join('');
}

// Delete a branch from the All Branches list (admin). Looks up the branch
// name for the confirm dialog so branch names with apostrophes/quotes are
// safe, then reloads the data and re-renders the list.
async function deleteBranchAllList(id) {
  var b = branchesCache.find(function(x){ return x.id === id; });
  var name = b ? (b.name || 'this branch') : 'this branch';
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  await removeBranch(id);
  showToast('Branch deleted');
  await loadAll();
  renderAllBranchesList();
}

// Combined overview: null shows source folders; a folder value shows that
// source's complete filtered list.
var allVacanciesFolder = null;
var vacancyFolderDisplayLimit = 30;
var vacancyFolderDisplayKey = '';
function handleVacanciesBack() {
  if (allVacanciesFolder) closeVacancyFolder();
  else goBackFromDirectory();
}
/* Numbered pagination bar shared by the General / Agency / dedicated-source
   vacancy folders. gotoFn is the name of a global function accepting a
   single 1-based page number (goToGeneralVacancyPage, etc). Shows at most
   5 page numbers centred on the current page, plus prev/next arrows. */
var VAC_PAGE_PREV_SVG = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';
var VAC_PAGE_NEXT_SVG = '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
function vacPaginationBar(page, totalPages, gotoFn) {
  totalPages = Math.max(1, totalPages || 1);
  page = Math.max(1, Math.min(page || 1, totalPages));
  if (totalPages <= 1) return '';
  var windowSize = 5;
  var start = Math.max(1, Math.min(page - 2, totalPages - windowSize + 1));
  var end = Math.min(totalPages, start + windowSize - 1);
  var nums = '';
  for (var i = start; i <= end; i++) {
    nums += '<button class="vac-page-num' + (i === page ? ' active' : '') + '"' + (i === page ? ' aria-current="page"' : '') + ' onclick="event.stopPropagation();' + gotoFn + '(' + i + ')">' + i + '</button>';
  }
  return '<nav class="vac-pagination" aria-label="Vacancy pages" onclick="event.stopPropagation()">' +
    '<button class="vac-page-arrow" ' + (page <= 1 ? 'disabled' : '') + ' onclick="' + gotoFn + '(' + (page - 1) + ')" aria-label="Previous page">' + VAC_PAGE_PREV_SVG + '</button>' +
    '<div class="vac-page-nums">' + nums + '</div>' +
    '<button class="vac-page-arrow" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="' + gotoFn + '(' + (page + 1) + ')" aria-label="Next page">' + VAC_PAGE_NEXT_SVG + '</button>' +
  '</nav>';
}
function updateVacanciesBackButton() {
  var btn = document.getElementById('allvacancies-back');
  if (!btn) return;
  btn.setAttribute('aria-label', allVacanciesFolder ? 'Back to vacancy categories' : 'Back to home menu');
  btn.title = allVacanciesFolder ? 'Back to vacancy categories' : 'Back to home menu';
}
// Overview filter hooks are kept separate from folder filters so the home
// directory can add compact filter controls without changing folder state.
var vacancyOverviewFilter = 'all';
var vacancyOverviewSource = 'all';
function vacancyMatchesOverviewSource(v) {
  if (vacancyOverviewSource === 'all') return true;
  if (vacancyOverviewSource === 'government') return ['government', 'dpsa'].indexOf(String(v.source_type || '').toLowerCase()) !== -1;
  return String(v.source_type || '').toLowerCase() === vacancyOverviewSource;
}
function setVacancyOverviewSource(source) {
  vacancyOverviewSource = source || 'all';
  renderAllVacanciesList();
}
function vacancyMatchesOverviewFilter(v) {
  var source = String(v.source_type || '').toLowerCase();
  var id = String(v.id || '');
  var government = ['government', 'dpsa'].indexOf(source) !== -1 || /^(government|dpsa)-/i.test(id);
  var remote = /remote|work[ -]?from[ -]?home|telecommute/i.test(String(v.remote || '') + ' ' + source + ' ' + id);
  if (vacancyOverviewFilter === 'government') return government;
  if (vacancyOverviewFilter === 'private') return !government && !remote;
  if (vacancyOverviewFilter === 'remote') return remote;
  return true;
}
var vacancyOverviewExtraRows = [];
var vacancyOverviewLoading = false;
async function setVacancyOverviewFilter(filter) {
  vacancyOverviewFilter = filter || 'all';
  vacancyOverviewExtraRows = [];
  if (vacancyOverviewFilter === 'government' || vacancyOverviewFilter === 'remote') {
    vacancyOverviewLoading = true;
    renderAllVacanciesList();
    try {
      var folder = vacancyOverviewFilter === 'government' ? 'government' : 'himalayas';
      vacancyOverviewExtraRows = filterExpiredVacancies(await fetchDedicatedVacancyPage(folder, generalVacancyQueryState(), 0));
    } catch (e) {
      vacancyOverviewExtraRows = [];
    } finally {
      vacancyOverviewLoading = false;
    }
  }
  renderAllVacanciesList();
}
function openVacancyFolder(type) {
  // Source cards live on Home, so explicitly open the vacancy screen before
  // applying the selected source. Previously the filter state changed while
  // Home remained active, making the tap appear to do nothing.
  showAllVacancies('home');
  allVacanciesFolder = type;
  vacancyFolderDisplayLimit = 30;
  vacancyFolderDisplayKey = '';
  generalVacancyDisplayPage = 1;
  dedicatedVacancyDisplayPage = 1;
  agencyFolderDisplayPage = 1;
  if (type === 'general') {
    generalVacancyQueryKey = '__open__';
    generalVacancyHasMore = true;
  } else if (DEDICATED_VACANCY_FOLDER_SOURCES[type]) {
    // Switching to a different dedicated folder (or opening one fresh)
    // always needs a new fetch — force loadDedicatedVacancies() to reset.
    dedicatedVacancyFolder = type;
    dedicatedVacancyQueryKey = '__open__';
    dedicatedVacancyHasMore = true;
  }
  // Filters are shared by the folder picker and its listing view, so a user
  // can narrow the category before opening it and keep that context.
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}
function closeVacancyFolder() {
  allVacanciesFolder = null;
  vacancyFolderDisplayLimit = 30;
  vacancyFolderDisplayKey = '';
  generalVacancyDisplayPage = 1;
  dedicatedVacancyDisplayPage = 1;
  agencyFolderDisplayPage = 1;
  renderAllVacanciesList();
  resetActiveScreenScroll('screen-allvacancies');
}
function renderGeneralVacancyCards(append) {
  var el = document.getElementById('allvacancies-list');
  var loadMore = document.getElementById('allvacancies-loadmore');
  var countLabel = document.getElementById('allvacancies-result-count');
  if (!el) return;
  if (generalVacancyError) {
    el.dataset.state = 'error';
    el.innerHTML = '<div class="empty-state"><h3>Could not load vacancies</h3><p>Check your connection and try again.</p><button class="vac-load-more" onclick="loadGeneralVacancies(true)">Try again</button></div>';
  } else if (generalVacancyLoading && !generalVacancyRows.length) {
    el.dataset.state = 'loading';
    el.innerHTML = '<div class="empty-state"><h3>Loading vacancies…</h3><p>Fetching the latest opportunities.</p></div>';
  } else if (!generalVacancyRows.length) {
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, !!generalVacancyQueryKey);
  } else {
    el.dataset.state = 'ready';
    var totalPages = Math.max(1, Math.ceil((generalVacancyCount || generalVacancyRows.length) / VAC_PAGE_SIZE));
    if (generalVacancyDisplayPage > totalPages) generalVacancyDisplayPage = totalPages;
    var pageStart = (generalVacancyDisplayPage - 1) * VAC_PAGE_SIZE;
    var pageRows = generalVacancyRows.slice(pageStart, pageStart + VAC_PAGE_SIZE);
    var cards = pageRows.map(function(v){
      var agency = v.agency_id && v.agency_id !== 'general' ? (agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {}) : {};
      return vacancyCard(v, agency, { hideBadges: true });
    }).join('');
    el.innerHTML = '<div class="pgroup-label">General Vacancies</div>' + (pageRows.length ? cards : '<div class="empty-state"><h3>Loading vacancies…</h3></div>') + vacPaginationBar(generalVacancyDisplayPage, totalPages, 'goToGeneralVacancyPage');
  }
  if (countLabel) countLabel.textContent = generalVacancyCount ? generalVacancyRows.length + ' of ' + generalVacancyCount + ' loaded' : generalVacancyRows.length + ' loaded';
  if (loadMore) loadMore.style.display = 'none';
}
async function goToGeneralVacancyPage(n) {
  if (allVacanciesFolder !== 'general') return;
  n = Math.max(1, n);
  while (generalVacancyRows.length < n * VAC_PAGE_SIZE && generalVacancyHasMore && !generalVacancyLoading) {
    await loadGeneralVacancies(false);
  }
  var totalPages = Math.max(1, Math.ceil((generalVacancyCount || generalVacancyRows.length) / VAC_PAGE_SIZE));
  generalVacancyDisplayPage = Math.max(1, Math.min(n, totalPages));
  renderGeneralVacancyCards(false);
  var listEl = document.getElementById('allvacancies-list');
  if (listEl && listEl.scrollIntoView) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadGeneralVacancies(reset) {
  var state = generalVacancyQueryState();
  var key = generalVacancyQueryKeyFor(state);
  var queryChanged = reset || key !== generalVacancyQueryKey;
  if (queryChanged) {
    generalVacancyRequestId++;
    generalVacancyQueryKey = key;
    generalVacancyPage = 0;
    generalVacancyNextCursor = null;
    generalVacancyRows = [];
    generalVacancyHasMore = true;
    generalVacancyLoading = false;
    generalVacancyError = false;
    generalVacancyDisplayPage = 1;
    var industrySel = document.getElementById('allvacancies-industry');
    if (industrySel) industrySel.style.display = 'none';
  }
  if (generalVacancyLoading || !generalVacancyHasMore) { renderGeneralVacancyCards(false); return; }
  var requestId = ++generalVacancyRequestId;
  generalVacancyLoading = true;
  renderGeneralVacancyCards(false);
  try {
    var page = await fetchGeneralVacancyPage(state, generalVacancyPage);
    if (requestId !== generalVacancyRequestId) return;
    generalVacancyError = false;
    var visiblePage = filterExpiredVacancies(page);
    matchVacanciesToAgencies(visiblePage, agenciesCache);
    visiblePage.forEach(function(v){
      if (v.agency_id && v.agency_id !== 'general' && !vacanciesCache.some(function(x){ return x.id === v.id; })) vacanciesCache.push(v);
    });
    // A matched record belongs in its agency section, not General Vacancies.
    generalVacancyRows = generalVacancyRows.concat(visiblePage.filter(isGeneralDirectoryVacancy));
    generalVacancyHasMore = page.length === generalVacancyPageSize;
    generalVacancyPage += 1;
    renderGeneralVacancyCards(true);
  } catch(e) {
    if (requestId !== generalVacancyRequestId) return;
    generalVacancyError = true;
    generalVacancyHasMore = true;
  } finally {
    if (requestId === generalVacancyRequestId) {
      generalVacancyLoading = false;
      renderGeneralVacancyCards(false);
    }
  }
}
function loadMoreGeneralVacancies() {
  if (allVacanciesFolder === 'general') loadGeneralVacancies(false);
  else if (DEDICATED_VACANCY_FOLDER_SOURCES[allVacanciesFolder]) loadDedicatedVacancies(false);
  else {
    vacancyFolderDisplayLimit += 30;
    renderAllVacanciesList();
  }
}
// Mirrors renderGeneralVacancyCards()/loadGeneralVacancies() above for the
// 5 dedicated-source folders (Himalayas/Adzuna/Government/Retail/
// Learnerships). One shared state machine since only one folder is open at
// a time — see dedicatedVacancy* globals in app-core.js.
var DEDICATED_VACANCY_FOLDER_LABELS = { himalayas: 'Himalayas Remote', adzuna: 'Adzuna Vacancies', government: 'Government Vacancies', retail: 'Retail Vacancies', learnerships: 'Learnerships', careers_page: 'Cruise careers' };
function renderDedicatedVacancyCards(append) {
  var el = document.getElementById('allvacancies-list');
  var loadMore = document.getElementById('allvacancies-loadmore');
  var countLabel = document.getElementById('allvacancies-result-count');
  if (!el) return;
  var folderLabel = DEDICATED_VACANCY_FOLDER_LABELS[dedicatedVacancyFolder] || 'Vacancies';
  var folderCount = (dedicatedVacancyCounts && dedicatedVacancyCounts[dedicatedVacancyFolder]) || 0;
  if (dedicatedVacancyError) {
    el.dataset.state = 'error';
    el.innerHTML = '<div class="empty-state"><h3>Could not load vacancies</h3><p>Check your connection and try again.</p><button class="vac-load-more" onclick="loadDedicatedVacancies(true)">Try again</button></div>';
  } else if (dedicatedVacancyLoading && !dedicatedVacancyRows.length) {
    el.dataset.state = 'loading';
    el.innerHTML = '<div class="empty-state"><h3>Loading vacancies…</h3><p>Fetching the latest opportunities.</p></div>';
  } else if (!dedicatedVacancyRows.length) {
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, !!dedicatedVacancyQueryKey && dedicatedVacancyQueryKey !== '__open__');
  } else {
    el.dataset.state = 'ready';
    var totalPages = Math.max(1, Math.ceil((folderCount || dedicatedVacancyRows.length) / VAC_PAGE_SIZE));
    if (dedicatedVacancyDisplayPage > totalPages) dedicatedVacancyDisplayPage = totalPages;
    var pageStart = (dedicatedVacancyDisplayPage - 1) * VAC_PAGE_SIZE;
    var pageRows = dedicatedVacancyRows.slice(pageStart, pageStart + VAC_PAGE_SIZE);
    var cards = pageRows.map(function(v){ return vacancyCard(v, {}, { hideBadges: true }); }).join('');
    el.innerHTML = '<div class="pgroup-label">' + escapeHtml(folderLabel) + '</div>' + (pageRows.length ? cards : '<div class="empty-state"><h3>Loading vacancies…</h3></div>') + vacPaginationBar(dedicatedVacancyDisplayPage, totalPages, 'goToDedicatedVacancyPage');
  }
  if (countLabel) countLabel.textContent = folderCount ? dedicatedVacancyRows.length + ' of ' + folderCount + ' loaded' : dedicatedVacancyRows.length + ' loaded';
  if (loadMore) loadMore.style.display = 'none';
}
async function goToDedicatedVacancyPage(n) {
  var folder = allVacanciesFolder;
  if (!DEDICATED_VACANCY_FOLDER_SOURCES[folder]) return;
  n = Math.max(1, n);
  var folderCount = (dedicatedVacancyCounts && dedicatedVacancyCounts[folder]) || 0;
  while (dedicatedVacancyRows.length < n * VAC_PAGE_SIZE && dedicatedVacancyHasMore && !dedicatedVacancyLoading) {
    await loadDedicatedVacancies(false);
  }
  var totalPages = Math.max(1, Math.ceil((folderCount || dedicatedVacancyRows.length) / VAC_PAGE_SIZE));
  dedicatedVacancyDisplayPage = Math.max(1, Math.min(n, totalPages));
  renderDedicatedVacancyCards(false);
  var listEl = document.getElementById('allvacancies-list');
  if (listEl && listEl.scrollIntoView) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadDedicatedVacancies(reset) {
  var folder = allVacanciesFolder;
  if (!DEDICATED_VACANCY_FOLDER_SOURCES[folder]) return;
  var state = generalVacancyQueryState();
  var key = folder + '|' + generalVacancyQueryKeyFor(state);
  var queryChanged = reset || folder !== dedicatedVacancyFolder || key !== dedicatedVacancyQueryKey;
  if (queryChanged) {
    dedicatedVacancyRequestId++;
    dedicatedVacancyFolder = folder;
    dedicatedVacancyQueryKey = key;
    dedicatedVacancyPage = 0;
    dedicatedVacancyNextCursor = null;
    dedicatedVacancyRows = [];
    dedicatedVacancyHasMore = true;
    dedicatedVacancyLoading = false;
    dedicatedVacancyError = false;
    dedicatedVacancyDisplayPage = 1;
  }
  if (dedicatedVacancyLoading || !dedicatedVacancyHasMore) { renderDedicatedVacancyCards(false); return; }
  var requestId = ++dedicatedVacancyRequestId;
  dedicatedVacancyLoading = true;
  renderDedicatedVacancyCards(false);
  try {
    var page = await fetchDedicatedVacancyPage(folder, state, dedicatedVacancyPage);
    if (requestId !== dedicatedVacancyRequestId) return;
    dedicatedVacancyError = false;
    dedicatedVacancyRows = dedicatedVacancyRows.concat(filterExpiredVacancies(page));
    dedicatedVacancyHasMore = page.length === dedicatedVacancyPageSize;
    dedicatedVacancyPage += 1;
    renderDedicatedVacancyCards(true);
  } catch(e) {
    if (requestId !== dedicatedVacancyRequestId) return;
    dedicatedVacancyError = true;
    dedicatedVacancyHasMore = true;
  } finally {
    if (requestId === dedicatedVacancyRequestId) {
      dedicatedVacancyLoading = false;
      renderDedicatedVacancyCards(false);
    }
  }
}
function renderAllVacanciesList() {
  updateVacanciesBackButton();

  if (allVacanciesFolder === 'general') {
    loadGeneralVacancies(false);
    return;
  }
  if (DEDICATED_VACANCY_FOLDER_SOURCES[allVacanciesFolder]) {
    loadDedicatedVacancies(false);
    return;
  }

  var el = document.getElementById('allvacancies-list');
  if (el) el.dataset.state = 'ready';
  // Employer-posted vacancies are exclusive to their employer's own hub card
  // (see employerHubVacancies) and are gated behind Talent Pool verification
  // there — they never appear in this general/public vacancies list.
  // Source folders are independent views: a vacancy may also belong to its
  // matched agency or employer. Keep source rows visible in Adzuna/Retail
  // even after they have been assigned to an organization.
  var visible = vacanciesCache.slice();
  (vacancyOverviewExtraRows || []).forEach(function(v) {
    if (v && !visible.some(function(existing) { return existing.id === v.id; })) visible.push(v);
  });
  var isHimalayasVacancy = function(v){ return v.source_type === 'himalayas' || String(v.id || '').indexOf('himalayas-') === 0; };
  var isAdzunaVacancy = function(v){ return v.source_type === 'adzuna' || String(v.id || '').indexOf('adzuna-') === 0; };
  var isGovernmentVacancy = function(v){ return ['government','dpsa'].indexOf(String(v.source_type || '').toLowerCase()) !== -1 || /^(government|dpsa)-/i.test(String(v.id || '')); };
  var isRetailVacancy = function(v){ return ['retail','shoprite','picknpay','woolworths','truworths','spar'].indexOf(String(v.source_type || '').toLowerCase()) !== -1 || /^(retail|shoprite|picknpay|woolworths|truworths|spar)-/i.test(String(v.id || '')); };
  var isLearnershipVacancy = function(v){ return v.source_type === 'learnerships' || String(v.id || '').indexOf('graduates24-') === 0; };
  var isCareersPageVacancy = function(v){ return v.source_type === 'careers_page' || String(v.id || '').indexOf('careers-page-') === 0; };
  var isExternalVacancy = function(v){ return isHimalayasVacancy(v) || isAdzunaVacancy(v) || isGovernmentVacancy(v) || isRetailVacancy(v) || isLearnershipVacancy(v) || isCareersPageVacancy(v); };

  var q = ((document.getElementById('allvacancies-search')||{}).value || '').trim().toLowerCase();
  var locationFilter = ((document.getElementById('allvacancies-location')||{}).value || '').trim().toLowerCase();
  var remoteFilter = ((document.getElementById('allvacancies-remote')||{}).value || '');
  var expFilter = ((document.getElementById('allvacancies-exp')||{}).value || '');
  var industryFilter = ((document.getElementById('allvacancies-industry')||{}).value || '');
  var displayKey = [allVacanciesFolder || 'overview', q, locationFilter, remoteFilter, expFilter, industryFilter].join('|').toLowerCase();
  if (displayKey !== vacancyFolderDisplayKey) {
    vacancyFolderDisplayKey = displayKey;
    vacancyFolderDisplayLimit = 30;
    agencyFolderDisplayPage = 1;
  }
  var list = allVacanciesFolder === 'agency'
    ? visible.filter(hasAssignedAgency)
    : allVacanciesFolder === 'general'
      ? visible.filter(isGeneralDirectoryVacancy)
      : allVacanciesFolder === 'himalayas'
        ? visible.filter(isHimalayasVacancy)
        : allVacanciesFolder === 'adzuna'
          ? visible.filter(isAdzunaVacancy)
                : allVacanciesFolder === 'government'
                  ? visible.filter(isGovernmentVacancy)
                  : allVacanciesFolder === 'retail'
                    ? visible.filter(isRetailVacancy)
                    : allVacanciesFolder === 'learnerships'
                      ? visible.filter(isLearnershipVacancy)
                      : allVacanciesFolder === 'careers_page'
                        ? visible.filter(isCareersPageVacancy)
              : visible.slice();
  var industrySel = document.getElementById('allvacancies-industry');
  if (industrySel) {
    var industries = new Set();
    list.forEach(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      if (agency && agency.trades) agency.trades.split(',').forEach(function(t){ t=t.trim(); if(t) industries.add(t); });
    });
    var sortedIndustries = Array.from(industries).sort();
    var current = industrySel.value;
    industrySel.innerHTML = '<option value="">Any industry</option>' + sortedIndustries.map(function(t){ return '<option value="'+escapeHtml(t)+'">'+escapeHtml(t)+'</option>'; }).join('');
    industrySel.value = sortedIndustries.indexOf(current) !== -1 ? current : '';
    industryFilter = industrySel.value;
  }
  if (locationFilter) list = list.filter(function(v){ return ((v.location||'') + ' ' + (v.address||'') + ' ' + (v.province||'')).toLowerCase().indexOf(locationFilter) !== -1; });
  if (remoteFilter) list = list.filter(function(v){
    var text = [v.remote, v.work_arrangement, v.work_schedule, v.notes].join(' ').toLowerCase();
    if (remoteFilter === 'remote') return /remote|telecommute|work[ -]?from[ -]?home|anywhere|distributed/.test(text);
    if (remoteFilter === 'hybrid') return /hybrid/.test(text);
    if (remoteFilter === 'onsite') return /on[ -]?site|office|in[ -]?person/.test(text) && !/remote|hybrid/.test(text);
    return text.indexOf(remoteFilter.toLowerCase()) !== -1;
  });
  if (expFilter) list = list.filter(function(v){
    var text = [v.experience_level, v.title, v.notes].join(' ').toLowerCase();
    if (expFilter === 'entry') return /entry|junior|graduate|intern|learnership|trainee|no experience/.test(text);
    if (expFilter === 'mid') return /mid|intermediate|experienced/.test(text) && !/senior|lead|principal|manager|executive/.test(text);
    if (expFilter === 'senior') return /senior|lead|principal|manager|executive|head of/.test(text);
    return text.indexOf(expFilter.toLowerCase()) !== -1;
  });
  if (industryFilter) {
    list = list.filter(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      var hay = [(agency && agency.trades) || '', v.industry || '', v.sector || '', v.category || '', v.notes || ''].join(' ');
      return hay.toLowerCase().indexOf(industryFilter.toLowerCase()) !== -1;
    });
  }
  if (q) {
    list = list.filter(function(v){
      var agency = agenciesCache.find(function(a){ return a.id === v.agency_id; });
      var hay = ((v.title||'')+' '+(v.notes||'')+' '+(v.location||'')+' '+(v.company||'')+' '+(agency?(agency.name||''):'')+' '+(agency?(agency.trades||''):'')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (!allVacanciesFolder && vacancyOverviewFilter !== 'all') {
    list = list.filter(vacancyMatchesOverviewFilter);
  }
  if (!allVacanciesFolder && vacancyOverviewSource !== 'all') {
    list = list.filter(vacancyMatchesOverviewSource);
  }
  if (!allVacanciesFolder) {
    // Keep the overview as a folder picker so new vacancy categories can be
    // added later without changing the listing screen. Counts still respond
    // to the shared search and filters above.
    var overviewLoadMore = document.getElementById('allvacancies-loadmore');
    if (overviewLoadMore) overviewLoadMore.style.display = 'none';
    var agencyCount = list.filter(hasAssignedAgency).length;
    var generalCount = generalVacancyCount;
    // These 5 folders no longer keep their rows in vacanciesCache (see
    // worker.js loadStartupData), so their counts come from the server-side
    // aggregate the same way generalCount does just above, rather than a
    // client-side filter that would now always read zero.
    var himalayasCount = dedicatedVacancyCounts.himalayas || 0;
    var adzunaCount = dedicatedVacancyCounts.adzuna || 0;
    var governmentCount = dedicatedVacancyCounts.government || 0;
    var retailCount = dedicatedVacancyCounts.retail || 0;
    var learnershipsCount = dedicatedVacancyCounts.learnerships || 0;
    var careersPageCount = dedicatedVacancyCounts.careers_page || 0;
    var folderCountLabel = function(count) {
      if (!generalVacancyCountLoaded || !dedicatedVacancyCountsLoaded) return 'Loading…';
      return count + ' vacanc' + (count === 1 ? 'y' : 'ies');
    };
    var sourceCards = [
      { type:'general', label:'General Vacancies', short:'General', count:generalCount, icon:'⌕' },
      { type:'agency', label:'Agency Vacancies', short:'Agency', count:agencyCount, icon:'▦' },
      { type:'government', label:'Government Vacancies', short:'Government', count:governmentCount, icon:'⌂' },
      { type:'retail', label:'Retail Vacancies', short:'Retail', count:retailCount, icon:'▤' },
      { type:'learnerships', label:'Learnerships', short:'Learnerships', count:learnershipsCount, icon:'✦' },
      { type:'himalayas', label:'Himalayas Remote', short:'Himalayas', count:himalayasCount, icon:'↗' },
      { type:'adzuna', label:'Adzuna Vacancies', short:'Adzuna', count:adzunaCount, icon:'A' },
      { type:'careers_page', label:'Cruise Careers', short:'Cruise', count:careersPageCount, icon:'⚓' }
    ];
    var sourceRow = function(item) {
      return '<button class="vac-cat-row" data-ripple onclick="openVacancyFolder(\'' + item.type + '\')" aria-label="Open ' + escapeHtml(item.label) + '">' +
        '<span class="vac-cat-row-left">' +
          '<span class="vac-cat-icon" aria-hidden="true">' + item.icon + '</span>' +
          '<span class="vac-cat-label">' + escapeHtml(item.label) + '</span>' +
        '</span>' +
        '<span class="vac-cat-count">' + folderCountLabel(item.count) + '</span>' +
        '<span class="vac-cat-chevron" aria-hidden="true">' + ICON_CHEVRON + '</span>' +
      '</button>';
    };
    var sourceRail =
      '<section class="vacancy-categories-card career-source-grid" aria-labelledby="vacancy-categories-title">' +
        '<div class="vacancy-categories-heading">' +
          '<span class="vacancy-categories-heading-icon" aria-hidden="true">' + VAC_ICONS.briefcase + '</span>' +
          '<h2 id="vacancy-categories-title">Vacancy Categories</h2>' +
        '</div>' +
        '<div class="vacancy-categories-list vacancy-swipe-rail" tabindex="0" aria-label="Vacancy categories, swipe left or right">' + sourceCards.map(sourceRow).join('') + '</div>' +
      '</section>';
    var publicCategories = [
      ['government', 'Government', 'Public-sector roles'],
      ['learnership', 'Learnerships', 'Training opportunities'],
      ['internship', 'Internships', 'Student and graduate roles'],
      ['graduate_programme', 'Graduate programmes', 'Graduate and trainee roles'],
      ['bursary', 'Bursaries', 'Study funding opportunities'],
      ['apprenticeship', 'Apprenticeships', 'Skilled-trade training'],
      ['part_time', 'Part-time', 'Flexible roles'],
      ['remote', 'Remote jobs', 'Work-from-home roles'],
      ['permanent', 'Permanent roles', 'Long-term employment'],
      ['contract', 'Contract roles', 'Fixed-term opportunities']
    ];
    var categoryRail =
      '<section class="vacancy-category-section" aria-label="Public vacancy categories">' +
        '<div class="vacancy-category-rail" aria-label="Public vacancy categories">' +
          publicCategories.map(function(category){
            return '<a class="vacancy-category-card" href="/browse/category/' + category[0] + '/">' +
              '<strong>' + escapeHtml(category[1]) + '</strong><small>' + escapeHtml(category[2]) + '</small>' +
            '</a>';
          }).join('') +
        '</div>' +
      '</section>';
    var overviewFilters = '<section class="career-recent-section"><div class="vacancy-overview-filters" role="group" aria-label="Filter recent vacancies">' +
      [['all','All Roles'],['government','Government'],['private','Private Sector'],['remote','Remote']].map(function(item){
        return '<button type="button" class="vacancy-overview-filter' + (vacancyOverviewFilter === item[0] ? ' active' : '') + '" onclick="setVacancyOverviewFilter(\'' + item[0] + '\')">' + item[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="career-recent-results vacancy-swipe-rail" tabindex="0" aria-label="Recent vacancies, swipe left or right" aria-live="polite">' +
        (vacancyOverviewLoading ? '<div class="empty-state"><p>Loading matching vacancies…</p></div>' :
          (list.length ? list.slice(0, 12).map(function(v) {
            var agency = v.agency_id && v.agency_id !== 'general' ? (agenciesCache.find(function(a){ return a.id === v.agency_id; }) || {}) : {};
            return vacancyCard(v, agency, { hideBadges: true });
          }).join('') : '<div class="empty-state"><p>No vacancies match this filter yet.</p></div>')) +
      '</div></section>';
    el.innerHTML = sourceRail +
      overviewFilters +
      '<div class="vacancy-browse-heading"><h2>Browse Vacancies</h2></div>' +
      categoryRail;
    return;
  }
  if (!list.length) {
    var hasFilters = !!(q || locationFilter || remoteFilter || expFilter || industryFilter);
    el.dataset.state = 'empty';
    el.innerHTML = vacancyScreenStateMarkup('all', false, hasFilters);
    var emptyLoadMore = document.getElementById('allvacancies-loadmore');
    if (emptyLoadMore) emptyLoadMore.style.display = 'none';
    return;
  }

  var totalFolderRows = list.length;
  var agencyTotalPages = Math.max(1, Math.ceil(totalFolderRows / VAC_PAGE_SIZE));
  if (agencyFolderDisplayPage > agencyTotalPages) agencyFolderDisplayPage = agencyTotalPages;
  var agencyPageStart = (agencyFolderDisplayPage - 1) * VAC_PAGE_SIZE;
  var displayList = list.slice(agencyPageStart, agencyPageStart + VAC_PAGE_SIZE);
  var resultCount = document.getElementById('allvacancies-result-count');
  if (resultCount) resultCount.textContent = displayList.length + ' of ' + totalFolderRows + ' loaded';
  var folderLoadMore = document.getElementById('allvacancies-loadmore');
  if (folderLoadMore) folderLoadMore.style.display = 'none';

  var groups = {};
  displayList.forEach(function(v){
    if (allVacanciesFolder !== 'agency' && isHimalayasVacancy(v)) {
      var himalayasKey = 'himalayas';
      if (!groups[himalayasKey]) groups[himalayasKey] = { name:'Himalayas remote vacancies', type:'Himalayas Remote', agency:null, items:[] };
      groups[himalayasKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isAdzunaVacancy(v)) {
      var adzunaKey = 'adzuna';
      if (!groups[adzunaKey]) groups[adzunaKey] = { name:'Adzuna vacancies', type:'Adzuna', agency:null, items:[] };
      groups[adzunaKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isGovernmentVacancy(v)) {
      var governmentKey = 'government';
      if (!groups[governmentKey]) groups[governmentKey] = { name:'Government vacancies', type:'Government', agency:null, items:[] };
      groups[governmentKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isRetailVacancy(v)) {
      var retailKey = 'retail';
      if (!groups[retailKey]) groups[retailKey] = { name:'Retail vacancies', type:'Retail', agency:null, items:[] };
      groups[retailKey].items.push(v);
      return;
    }
    if (allVacanciesFolder !== 'agency' && isLearnershipVacancy(v)) {
      var learnershipsKey = 'learnerships';
      if (!groups[learnershipsKey]) groups[learnershipsKey] = { name:'Learnerships', type:'Learnerships', agency:null, items:[] };
      groups[learnershipsKey].items.push(v);
      return;
    }
    var agency = v.agency_id && v.agency_id !== 'general' ? agenciesCache.find(function(a){ return a.id === v.agency_id; }) : null;
    var key, name, type;
    if (agency) { key='agency:'+agency.id; name=agency.name||'Agency'; type='Agency'; }
    else { key='general'; name='General vacancies'; type='General'; }
    if (!groups[key]) groups[key] = { name:name, type:type, agency:agency || null, items:[] };
    groups[key].items.push(v);
  });
  // Already scoped to one folder (agency-only or general-only) by the
  // filter above, so groups here are either several agencies (sorted by
  // most recent posting) or the single general group.
  var keys = Object.keys(groups).sort(function(a,b){
    var newestA = Math.max.apply(null, groups[a].items.map(function(v){ return new Date(v.created_at || 0).getTime(); }));
    var newestB = Math.max.apply(null, groups[b].items.map(function(v){ return new Date(v.created_at || 0).getTime(); }));
    return newestB - newestA;
  });
  var sectionTitle = allVacanciesFolder === 'agency' ? 'Agency Vacancies' : allVacanciesFolder === 'general' ? 'General Vacancies' : allVacanciesFolder === 'himalayas' ? 'Himalayas Remote Vacancies' : allVacanciesFolder === 'adzuna' ? 'Adzuna Vacancies' : allVacanciesFolder === 'government' ? 'Government Vacancies' : allVacanciesFolder === 'retail' ? 'Retail Vacancies' : allVacanciesFolder === 'careers_page' ? 'Cruise Careers' : 'Learnerships';
  el.innerHTML = '<div class="pgroup-label">' + sectionTitle + '</div>' + keys.map(function(key){
    var group = groups[key];
    group.items = sortVacancies(group.items);
    var agency = group.agency || {};
    // Plain cards only, no wrapping <section> — matches the flat General
    // Vacancies list exactly, so every folder's cards render identically
    // regardless of source.
    return group.items.map(function(v){ return vacancyCard(v, agency, { hideBadges: true }); }).join('');
  }).join('') + vacPaginationBar(agencyFolderDisplayPage, agencyTotalPages, 'goToAgencyFolderPage');
}
function goToAgencyFolderPage(n) {
  if (allVacanciesFolder !== 'agency') return;
  agencyFolderDisplayPage = Math.max(1, n);
  renderAllVacanciesList();
  var listEl = document.getElementById('allvacancies-list');
  if (listEl && listEl.scrollIntoView) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function switchSubTab(tab) {
  subCurrentTab = tab;
  document.getElementById('sub-tab-reports').classList.toggle('active', tab === 'reports');
  document.getElementById('sub-tab-suggestions').classList.toggle('active', tab === 'suggestions');
  renderSubmissionsList();
  // Load data if not yet loaded
  if (tab === 'reports' && subReportsCache.length === 0) loadReportsFromSupabase();
  if (tab === 'suggestions' && subSuggestionsCache.length === 0) loadSuggestionsFromSupabase();
}

async function loadReportsFromSupabase() {
  var list = document.getElementById('submissions-list');
  if (list) list.innerHTML = '<div class="empty-state"><h3>Loading reports…</h3></div>';
  var supaReports = [];
  var supaOk = false;
  try {
    var { data, error } = await supabaseClient.from('reports').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    supaReports = data || [];
    supaOk = true;
  } catch(e) {
    console.error('load reports supabase', e);
  }
  // Always merge localStorage backups so reports that failed to insert to
  // Supabase (or were submitted before the fix) still appear in the panel.
  var localReports = readLocalReports().slice().reverse();
  var seenKeys = {};
  var merged = [];
  // Add Supabase reports first (they have real IDs for toggle/delete)
  supaReports.forEach(function(r){
    var key = (r.agency_name||'') + '|' + (r.reason||'') + '|' + (r.details||'') + '|' + (r.created_at||'');
    if (!seenKeys[key]) { seenKeys[key] = true; merged.push(r); }
  });
  // Then add local-only reports that aren't already in Supabase
  localReports.forEach(function(r){
    var key = (r.agency_name||'') + '|' + (r.reason||'') + '|' + (r.details||'') + '|' + (r.created_at||'');
    if (!seenKeys[key]) {
      seenKeys[key] = true;
      // Generate a pseudo-id for local-only items so toggle/delete can work locally
      r._localId = r._localId || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
      merged.push(r);
    }
  });
  subReportsCache = merged;
  updateSubBadges();
  renderSubmissionsList();
  if (!supaOk && subReportsCache.length === 0) {
    if (list) list.innerHTML = '<div class="empty-state"><h3>Could not load reports</h3><p>Check your Supabase setup or run the SQL script.</p></div>';
  }
}

async function loadSuggestionsFromSupabase() {
  var list = document.getElementById('submissions-list');
  if (list) list.innerHTML = '<div class="empty-state"><h3>Loading suggestions…</h3></div>';
  var supaSugg = [];
  var supaOk = false;
  try {
    var { data, error } = await supabaseClient.from('suggestions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    supaSugg = data || [];
    supaOk = true;
  } catch(e) {
    console.error('load suggestions supabase', e);
  }
  // Merge localStorage backups so locally-saved suggestions also appear
  var localSugg = [];
  try { localSugg = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]').slice().reverse(); } catch(e2){}
  var seenKeys = {};
  var merged = [];
  supaSugg.forEach(function(s){
    var key = (s.type||'') + '|' + (s.agency_name||'') + '|' + (s.details||'') + '|' + (s.created_at||'');
    if (!seenKeys[key]) { seenKeys[key] = true; merged.push(s); }
  });
  localSugg.forEach(function(s){
    var key = (s.type||'') + '|' + (s.agency_name||'') + '|' + (s.details||'') + '|' + (s.created_at||'');
    if (!seenKeys[key]) {
      seenKeys[key] = true;
      s._localId = s._localId || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
      merged.push(s);
    }
  });
  subSuggestionsCache = merged;
  updateSubBadges();
  renderSubmissionsList();
  if (!supaOk && subSuggestionsCache.length === 0) {
    if (list) list.innerHTML = '<div class="empty-state"><h3>Could not load suggestions</h3><p>Check your Supabase setup or run the SQL script.</p></div>';
  }
}

function updateSubBadges() {
  var reportsOpen = subReportsCache.filter(function(r){ return (r.status || 'open') === 'open'; }).length;
  var suggOpen = subSuggestionsCache.filter(function(s){ return (s.status || 'open') === 'open'; }).length;
  var rb = document.getElementById('reports-badge');
  var sb = document.getElementById('suggestions-badge');
  if (reportsOpen > 0) { rb.textContent = reportsOpen; rb.style.display = 'inline-block'; }
  else { rb.style.display = 'none'; }
  if (suggOpen > 0) { sb.textContent = suggOpen; sb.style.display = 'inline-block'; }
  else { sb.style.display = 'none'; }
}

function renderSubmissionsList() {
  var list = document.getElementById('submissions-list');
  if (!list) return;
  var items = subCurrentTab === 'reports' ? subReportsCache : subSuggestionsCache;
  if (!items || items.length === 0) {
    var label = subCurrentTab === 'reports' ? 'reports' : 'suggestions';
    list.innerHTML = '<div class="empty-state"><h3>No ' + label + ' yet</h3><p>When users submit ' + label + ', they will appear here.</p>' +
      '<button class="sheet-cancel" data-ripple onclick="' + (subCurrentTab === 'reports' ? 'loadReportsFromSupabase' : 'loadSuggestionsFromSupabase') + '()" style="margin-top:12px;">Refresh</button></div>';
    return;
  }
  var html = items.map(function(item) {
    var isReport = subCurrentTab === 'reports';
    var iconClass = isReport ? 'report' : 'suggestion';
    var iconEmoji = isReport ? '⚠️' : '💡';
    var title = isReport ? (item.reason || 'Report') : (item.type || 'Suggestion');
    var agency = item.agency_name ? escapeHtml(item.agency_name) : '';
    var details = escapeHtml(item.details || '');
    var dateStr = item.created_at ? new Date(item.created_at).toLocaleString('en-ZA', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    var status = item.status || 'open';
    var statusClass = status === 'resolved' || status === 'closed' ? 'resolved' : 'open';
    var statusLabel = status === 'resolved' ? '✓ Resolved' : (status === 'closed' ? 'Closed' : 'Open');
    var id = item.id || item._localId || '';
    var metaLine = agency ? 'Agency: ' + agency : '';
    if (dateStr) metaLine += (metaLine ? ' · ' : '') + dateStr;
    return '<div class="sub-card">' +
      '<div class="sub-card-head">' +
        '<div class="sub-card-icon ' + iconClass + '">' + iconEmoji + '</div>' +
        '<div class="sub-card-title">' + escapeHtml(title) + (metaLine ? '<div class="sub-card-meta">' + metaLine + '</div>' : '') + '</div>' +
      '</div>' +
      (details ? '<div class="sub-card-body">' + details + '</div>' : '') +
      '<div class="sub-card-actions">' +
        '<button class="sub-status-pill ' + statusClass + '" data-ripple onclick="toggleSubStatus(\'' + (isReport ? 'reports' : 'suggestions') + '\',\'' + id + '\')">' + statusLabel + '</button>' +
        '<button class="sub-del-btn" data-ripple onclick="deleteSubmission(\'' + (isReport ? 'reports' : 'suggestions') + '\',\'' + id + '\')">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
  html += '<button class="sheet-cancel" data-ripple onclick="' + (subCurrentTab === 'reports' ? 'loadReportsFromSupabase' : 'loadSuggestionsFromSupabase') + '()" style="margin:12px auto 20px;max-width:180px;">Refresh</button>';
  list.innerHTML = html;
}

async function toggleSubStatus(table, id) {
  if (!id) { showToast('Cannot update — missing ID'); return; }
  var cache = table === 'reports' ? subReportsCache : subSuggestionsCache;
  // Support both real Supabase id and local _localId
  var item = cache.find(function(x){ return (x.id && x.id === id) || (x._localId && x._localId === id); });
  if (!item) return;
  var previousStatus = item.status;
  var newStatus = (item.status === 'resolved' || item.status === 'closed') ? 'open' : 'resolved';

  // Optimistic UI: apply and paint the change immediately rather than
  // waiting on the network, then reconcile with Supabase in the
  // background. If the write actually fails, revert the local state and
  // re-render so the toggle never silently drifts out of sync with the DB.
  item.status = newStatus;
  updateSubBadges();
  renderSubmissionsList();
  showToast(newStatus === 'resolved' ? 'Marked as resolved' : 'Reopened');

  // Only update Supabase if this is a real DB row (has numeric/uuid id, not _localId)
  if (item.id && !String(id).startsWith('local_')) {
    try {
      var res = await supabaseClient.from(table).update({ status: newStatus }).eq('id', id);
      if (res && res.error) throw res.error;
    } catch(e) {
      console.error('update status', e);
      item.status = previousStatus;
      updateSubBadges();
      renderSubmissionsList();
      showToast('Could not save — reverted');
    }
  } else {
    // Local-only item: update localStorage backup
    if (table === 'reports') {
      var local = readLocalReports();
      var li = local.findIndex(function(x){ return x._localId === id || ((x.agency_name||'')+'|'+(x.reason||'')+'|'+(x.details||'')+'|'+(x.created_at||'')) === ((item.agency_name||'')+'|'+(item.reason||'')+'|'+(item.details||'')+'|'+(item.created_at||'')); });
      if (li >= 0) { local[li].status = newStatus; writeLocalReports(local); }
    } else {
      try {
        var ls = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]');
        var si = ls.findIndex(function(x){ return x._localId === id; });
        if (si >= 0) { ls[si].status = newStatus; localStorage.setItem('sa_suggestions_local', JSON.stringify(ls)); }
      } catch(e2){}
    }
  }
}

async function deleteSubmission(table, id) {
  if (!id) { showToast('Cannot delete — missing ID'); return; }
  if (!confirm('Delete this submission? This cannot be undone.')) return;
  // Delete from Supabase only if it's a real DB row
  if (!String(id).startsWith('local_')) {
    try {
      await supabaseClient.from(table).delete().eq('id', id);
    } catch(e) { console.error('delete submission', e); }
  }
  // Also remove from localStorage backup
  if (table === 'reports') {
    var local = readLocalReports();
    local = local.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
    writeLocalReports(local);
  } else {
    try {
      var ls = JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]');
      ls = ls.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
      localStorage.setItem('sa_suggestions_local', JSON.stringify(ls));
    } catch(e2){}
  }
  // Remove from cache
  if (table === 'reports') subReportsCache = subReportsCache.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
  else subSuggestionsCache = subSuggestionsCache.filter(function(x){ return (x.id !== id) && (x._localId !== id); });
  updateSubBadges();
  renderSubmissionsList();
  showToast('Deleted');
}

// Homepage source cards use inline actions in rendered markup. Export the
// handler explicitly because the bundled UI code has its own scope.
window.openVacancyFolder = openVacancyFolder;

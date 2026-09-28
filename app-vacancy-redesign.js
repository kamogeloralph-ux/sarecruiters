/* SA Recruiters vacancy marketplace enhancement layer */
(function () {
  'use strict';

  var originalRender = window.renderAllVacanciesList;
  var sortState = 'newest';
  var sortSelect;
  var industryRail;
  var industrySelect;

  function escape(value) {
    return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }

  function agencyFor(v) {
    return (window.agenciesCache || []).find(function (a) { return a.id === v.agency_id; }) || {};
  }

  function industriesFor(v) {
    var agency = agencyFor(v);
    var raw = [v.industry, v.sector, v.category, agency.trades].filter(Boolean).join(',');
    var values = raw.split(/[,|;/]+/).map(function (item) { return item.trim(); }).filter(Boolean);
    return values.length ? values : ['General'];
  }

  function allIndustries() {
    var seen = {};
    (window.vacanciesCache || []).forEach(function (v) {
      industriesFor(v).forEach(function (industry) { seen[industry] = true; });
    });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
  }

  function populateIndustryControls() {
    var industries = allIndustries();
    industrySelect = document.getElementById('allvacancies-industry');
    var current = industrySelect && industrySelect.value || '';
    if (industrySelect) {
      industrySelect.innerHTML = '<option value="">All industries</option>' + industries.map(function (industry) { return '<option value="' + escape(industry) + '">' + escape(industry) + '</option>'; }).join('');
      industrySelect.value = industries.indexOf(current) > -1 ? current : '';
    }
    industryRail = document.getElementById('vacancy-industry-rail');
    if (industryRail) {
      industryRail.innerHTML = '<button type="button" class="vac-industry-chip' + (!current ? ' is-active' : '') + '" data-industry="">All roles</button>' + industries.slice(0, 10).map(function (industry) {
        return '<button type="button" class="vac-industry-chip' + (industry === current ? ' is-active' : '') + '" data-industry="' + escape(industry) + '">' + escape(industry) + '</button>';
      }).join('');
      industryRail.querySelectorAll('.vac-industry-chip').forEach(function (button) {
        button.addEventListener('click', function () {
          if (industrySelect) industrySelect.value = button.dataset.industry || '';
          syncControlState();
          if (typeof originalRender === 'function') originalRender();
        });
      });
    }
  }

  function syncControlState() {
    var activeCount = 0;
    ['allvacancies-search', 'allvacancies-location', 'allvacancies-remote', 'allvacancies-exp', 'allvacancies-industry'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value) activeCount += 1;
    });
    var summary = document.getElementById('vacancy-filter-summary');
    if (summary) summary.textContent = activeCount ? activeCount + ' filter' + (activeCount === 1 ? '' : 's') + ' active' : 'All roles';
    if (industryRail && industrySelect) industryRail.querySelectorAll('.vac-industry-chip').forEach(function (button) { button.classList.toggle('is-active', (button.dataset.industry || '') === industrySelect.value); });
    if (sortSelect) sortSelect.value = sortState;
  }

  function dateValue(v) { return new Date(v.created_at || v.updated_at || 0).getTime() || 0; }
  function salaryValue(v) { return Number(v.salary_max || v.max_salary || v.salary || 0) || 0; }
  function applyLocationFilter() {
    var location = (document.getElementById('allvacancies-location') || {}).value || '';
    location = location.trim().toLowerCase();
    var list = document.getElementById('allvacancies-list');
    if (!list || !window.allVacanciesFolder) return;
    var byId = {};
    (window.vacanciesCache || []).forEach(function (v) { byId[String(v.id)] = v; });
    Array.prototype.forEach.call(list.querySelectorAll(':scope > .vac-card'), function (card) {
      if (!location) { card.hidden = false; return; }
      var v = byId[card.dataset.vacancyId] || {};
      var hay = [v.location, v.address, v.province].filter(Boolean).join(' ').toLowerCase();
      card.hidden = hay.indexOf(location) === -1;
    });
  }

  function sortVacancyCards() {
    var list = document.getElementById('allvacancies-list');
    if (!list || !window.allVacanciesFolder) return;
    var cards = Array.prototype.slice.call(list.querySelectorAll(':scope > .vac-card'));
    if (!cards.length) return;
    var byId = {};
    (window.vacanciesCache || []).forEach(function (v) { byId[String(v.id)] = v; });
    cards.sort(function (a, b) {
      var av = byId[a.dataset.vacancyId] || {}, bv = byId[b.dataset.vacancyId] || {};
      if (sortState === 'title') return String(av.title || '').localeCompare(String(bv.title || ''));
      if (sortState === 'salary') return salaryValue(bv) - salaryValue(av) || dateValue(bv) - dateValue(av);
      if (sortState === 'industry') return industriesFor(av)[0].localeCompare(industriesFor(bv)[0]) || dateValue(bv) - dateValue(av);
      return dateValue(bv) - dateValue(av);
    });
    cards.forEach(function (card) { list.appendChild(card); });
  }

  function enhancedRender() {
    populateIndustryControls();
    if (typeof originalRender === 'function') originalRender.apply(this, arguments);
    sortVacancyCards();
    applyLocationFilter();
    syncControlState();
    var count = document.getElementById('vacancy-market-count');
    if (count && window.vacanciesCache) count.textContent = Number(window.vacanciesCache.length || 0).toLocaleString() + '+';
  }

  window.renderAllVacanciesList = enhancedRender;
  window.setVacancySort = function (value) { sortState = value || 'newest'; enhancedRender(); };
  window.clearVacancyFilters = function () {
    ['allvacancies-search', 'allvacancies-remote', 'allvacancies-exp', 'allvacancies-industry'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    sortState = 'newest';
    enhancedRender();
  };

  document.addEventListener('DOMContentLoaded', function () {
    sortSelect = document.getElementById('allvacancies-sort');
    if (sortSelect) sortSelect.addEventListener('change', function () { window.setVacancySort(sortSelect.value); });
    ['allvacancies-search', 'allvacancies-remote', 'allvacancies-exp', 'allvacancies-industry'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', syncControlState);
    });
    var clear = document.getElementById('vacancy-clear-filters');
    if (clear) clear.addEventListener('click', window.clearVacancyFilters);
    populateIndustryControls();
    syncControlState();
  });
}());

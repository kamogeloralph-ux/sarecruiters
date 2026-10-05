// ============================================================
//  SA RECRUITERS — generate-pages.js
// ============================================================
//  Runs via GitHub Actions (see .github/workflows/deploy.yml), on every
//  push to main and on a 3-hourly schedule.
//  Queries Supabase for agencies, branches and vacancies, and
//  writes a static HTML page per agency and per vacancy so
//  Google (and anyone sharing a link) sees real content instead
//  of the empty app shell.
//
//  Your existing index.html / app is untouched — this just adds
//  extra static pages alongside it in the GitHub Pages output.
//
//  Requires: npm install @supabase/supabase-js  (already in package.json)
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runBundle, buildSupabaseVendor } = require('./scripts/bundle-app');

// Bundle + minify the 8 app-*.js files into app.bundle.min.js and
// rewrite index.html's script tag, before anything else runs. Doing
// this first (and via require, not npm run) means the existing
// Cloudflare Pages build command — "npm install && node
// generate-pages.js" — doesn't need to change to pick this up.
runBundle(__dirname);
buildSupabaseVendor(__dirname);

// ------------------------------------------------------------
// Freshness: per-deploy cache busting
// ------------------------------------------------------------
// 1) Auto-bump the service worker VERSION on every build so the SW
//    update check sees new bytes on every deploy, installs, calls
//    skipWaiting() and activates — and the activate handler deletes
//    every old cache. Returning visitors get the new build on their
//    next visit with zero manual version bumps.
//    Hash (not timestamp) so the 3-hourly cron rebuilds with no source
//    changes keep the same VERSION and don't needlessly wipe caches.
// 2) Set ?v=<same hash> on every same-origin asset URL
//    (styles.css, content.js, content-manager.js, static-pages.css)
//    so stale-while-revalidate style caches treat each deploy as a new
//    resource and can never answer with a stale copy.
// ------------------------------------------------------------
const STATIC_ASSETS = [
  'index.html',
  'admin.html',
  'privacy.html',
  'privacy/index.html',
  'faq/index.html',
  'know-your-rights/index.html',
  'offline.html',
  'styles.css',
  'static-pages.css',
  'content.js',
  'content-manager.js',
  'manifest.json',
];

function computeDeployVersion() {
  const hash = crypto.createHash('sha256');
  for (const f of STATIC_ASSETS) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) {
      console.warn(`[version] warning: ${f} not found — hashing without it`);
      continue;
    }
    hash.update(fs.readFileSync(p));
  }
  return 'sa-recruiters-' + hash.digest('hex').slice(0, 10);
}

function rewriteAssetUrls(html, version) {
  // Replace an existing ?v= as well as versioning an unversioned asset.
  // The bundle script tag is already rewritten by bundle-app.js.
  // Handles relative (styles.css), ./relative (./styles.css) and
  // root-absolute (/static-pages.css) references.
  return html.replace(
    /((?:src|href)=")((?:\.\/|\/)?)(styles\.css|content\.js|content-manager\.js|static-pages\.css)(?:\?v=[^"]*)?("?)/g,
    (match, attr, base, file, suffix) => `${attr}${base}${file}?v=${version}${suffix}`,
  );
}

function applyDeployVersioning() {
  const version = computeDeployVersion();

  // --- 1) Bump sw.js VERSION ---
  const swPath = path.join(__dirname, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  if (!/const VERSION = 'sa-recruiters-/.test(sw)) {
    throw new Error(
      'sw.js: could not find the VERSION constant — refusing to deploy an unbumpable service worker',
    );
  }
  fs.writeFileSync(
    swPath,
    sw.replace(
      /const VERSION = '[^']*';/,
      `const VERSION = '${version}';`,
    ),
  );

  // --- 2) Append ?v=<version> to unversioned same-origin asset URLs ---
  let rewritten = 0;
  for (const f of STATIC_ASSETS.filter((f) => f.endsWith('.html'))) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const original = fs.readFileSync(p, 'utf8');
    const updated = rewriteAssetUrls(original, version);
    if (updated !== original) {
      fs.writeFileSync(p, updated);
      rewritten++;
    }
  }
  console.log(`[version] deploy version: ${version} (${rewritten} html files updated)`);
  return version;
}

const DEPLOY_VERSION = applyDeployVersioning();

// Same public values already used in index.html — safe to reuse,
// this is the anon/public key, not a secret.
const SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';

const SITE_URL = 'https://sa-recruiters.co.za';
const OUT_DIR = path.join(__dirname); // publish root — adjust if you move this script
// Kept in sync by hand with app-core.js (R2_WORKER_URL) and app-sheets.js
// (TURNSTILE_SITE_KEY) — the static /post-a-job/ page has no app bundle to
// read these from, since it must work with zero JS dependencies besides
// Turnstile itself.
const R2_WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
const TURNSTILE_SITE_KEY = '0x4AAAAAAE781UzzffMh7u8L';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- helpers ----------

function slugify(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'listing';
}

function escapeHtml(str) {
  return (str || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
function serializeJsonLd(value) {
  // Listing fields come from Supabase and may contain attacker-controlled
  // text. Escape the HTML-sensitive character so </script> cannot terminate
  // this JSON-LD element and become executable markup.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isExpiredVacancy(vacancy) {
  const value = String(vacancy?.closing_date || '').trim();
  if (!value) return false;
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let closing;
  if (match) closing = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  else if ((match = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) closing = new Date(Date.UTC(+match[3], +match[2] - 1, +match[1]));
  else return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return !Number.isNaN(closing.getTime()) && closing.getTime() < todayUtc;
}

function recordMapKey(record, index) {
  if (!record.__staticSlugKey) {
    const rawId = record.id === undefined || record.id === null || record.id === '' ? `row-${index}` : String(record.id);
    record.__staticSlugKey = `${rawId}__${index}`;
  }
  return record.__staticSlugKey;
}

function buildPublicSlugMap(records, getName) {
  const counts = new Map();
  records.forEach((record) => {
    const base = slugify(getName(record));
    counts.set(base, (counts.get(base) || 0) + 1);
  });

  const result = new Map();
  const usedSlugs = new Set();
  records.forEach((record, index) => {
    const base = slugify(getName(record));
    const key = recordMapKey(record, index);
    const hasStableId = record.id !== undefined && record.id !== null && record.id !== '';
    const suffix = counts.get(base) > 1 && hasStableId ? `-${String(record.id).slice(0, 6)}` : '';
    const fallbackSuffix = hasStableId ? '' : `-row-${index}`;
    let slug = `${base}${suffix || fallbackSuffix}`;
    if (usedSlugs.has(slug)) slug = `${slug}-row-${index}`;
    usedSlugs.add(slug);
    result.set(key, slug);
  });
  return result;
}

// ---------- shared UI (static pages) ----------
// CTX is filled in by main() BEFORE any page is written, so every page links
// only to hubs / pages that actually exist (no dead links).
const CTX = {
  provinces: new Set(),     // province hub slugs that were generated
  categories: new Set(),    // category hub slugs that were generated
  agencyById: new Map(),    // agency id -> { slug, name }
  vacancySlugs: new Map(),  // vacancy __staticSlugKey -> public slug
  latest: [],               // newest open vacancies: [{ vacancy, slug }]
};

const LOCATION_HUBS = [
  { name: 'Gauteng', slug: 'gauteng' },
  { name: 'Western Cape', slug: 'western-cape' },
  { name: 'Eastern Cape', slug: 'eastern-cape' },
  { name: 'KwaZulu-Natal', slug: 'kwazulu-natal' },
  { name: 'Free State', slug: 'free-state' },
  { name: 'Limpopo', slug: 'limpopo' },
  { name: 'Mpumalanga', slug: 'mpumalanga' },
  { name: 'North West', slug: 'north-west' },
  { name: 'Northern Cape', slug: 'northern-cape' },
];

// Matches firstjobly.co.za's "Browse by type": Government Vacancies,
// Learnerships, Internships, Graduate Programmes, Bursaries, Apprenticeships,
// Part-time, Remote, Permanent, Contract roles.
const CATEGORIES = [
  { slug: 'government', label: 'Government Vacancies', intro: 'Government and public-sector vacancies across South Africa, including municipal, SOE and department postings.', keywords: ['government', 'dpsa', 'municipal', 'municipality'] },
  { slug: 'learnership', label: 'Learnerships', intro: 'Learnership programmes across South African employers, agencies and government departments.', keywords: ['learnership', 'learnerships'] },
  { slug: 'internship', label: 'Internships', intro: 'Internship opportunities for graduates and students across South African employers.', keywords: ['internship', 'intern '] },
  { slug: 'graduate_programme', label: 'Graduate Programmes', intro: 'Graduate development and trainee programmes from South African employers.', keywords: ['graduate programme', 'graduate program', 'trainee', 'graduate-in-training', 'graduates in training'] },
  { slug: 'bursary', label: 'Bursaries', intro: 'Bursary opportunities for South African students.', keywords: ['bursary', 'bursaries'] },
  { slug: 'apprenticeship', label: 'Apprenticeships', intro: 'Apprenticeship opportunities across South African trades and industries.', keywords: ['apprentice', 'apprenticeship'] },
  { slug: 'part_time', label: 'Part-time roles', intro: 'Part-time job opportunities across South Africa.', keywords: ['part-time', 'part time'] },
  { slug: 'remote', label: 'Remote / Work from home jobs', intro: 'Remote and work-from-home job opportunities open to South African candidates.', keywords: ['remote', 'work from home', 'work-from-home'] },
  { slug: 'permanent', label: 'Permanent roles', intro: 'Permanent job opportunities across South African employers and agencies.', keywords: ['permanent'] },
  { slug: 'contract', label: 'Contract roles', intro: 'Contract and fixed-term job opportunities across South African employers.', keywords: ['contract', 'fixed-term', 'fixed term'] },
];

// Free-text locations often name only a city. Map the common ones to their
// province so they still link to (and appear on) the right province hub.
const CITY_PROVINCE = {
  johannesburg: 'Gauteng', pretoria: 'Gauteng', sandton: 'Gauteng', centurion: 'Gauteng', midrand: 'Gauteng',
  randburg: 'Gauteng', roodepoort: 'Gauteng', benoni: 'Gauteng', boksburg: 'Gauteng', germiston: 'Gauteng',
  'kempton park': 'Gauteng', soweto: 'Gauteng', rosebank: 'Gauteng', bryanston: 'Gauteng', fourways: 'Gauteng',
  'cape town': 'Western Cape', stellenbosch: 'Western Cape', paarl: 'Western Cape', 'somerset west': 'Western Cape',
  bellville: 'Western Cape', durbanville: 'Western Cape', 'century city': 'Western Cape', 'table bay': 'Western Cape',
  durban: 'KwaZulu-Natal', pietermaritzburg: 'KwaZulu-Natal', umhlanga: 'KwaZulu-Natal', 'richards bay': 'KwaZulu-Natal',
  pinetown: 'KwaZulu-Natal', ballito: 'KwaZulu-Natal',
  gqeberha: 'Eastern Cape', 'port elizabeth': 'Eastern Cape', 'east london': 'Eastern Cape',
  bloemfontein: 'Free State', polokwane: 'Limpopo', nelspruit: 'Mpumalanga', mbombela: 'Mpumalanga',
  rustenburg: 'North West', mahikeng: 'North West', kimberley: 'Northern Cape',
};

function provinceFor(text) {
  const region = inferAddressRegion(text);
  if (region) return region;
  const t = String(text || '').toLowerCase();
  if (!t) return undefined;
  const city = Object.keys(CITY_PROVINCE).find((c) => t.includes(c));
  return city ? CITY_PROVINCE[city] : undefined;
}

function locationInProvince(text, provinceName) {
  return locationContains(text, provinceName) || provinceFor(text) === provinceName;
}

function provinceHref(text) {
  const prov = provinceFor(text);
  const hub = prov && LOCATION_HUBS.find((h) => h.name === prov);
  return hub && CTX.provinces.has(hub.slug) ? `/jobs/${hub.slug}/` : '';
}

function categoryHref(text) {
  const hay = ` ${String(text || '').toLowerCase()} `;
  const cat = CATEGORIES.find((c) => CTX.categories.has(c.slug) && c.keywords.some((k) => hay.includes(k)));
  return cat ? `/browse/category/${cat.slug}/` : '';
}

const ICONS = {
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v.01M18 14v.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.2-4.6A8 8 0 1 1 21 12z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
  level: '<path d="M4 20V14M10 20V9M16 20V4M22 20H2"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
};

function icon(name, size = 18) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

const VERIFIED_SEAL = '<svg class="verified-seal" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2l2.4 2.1 3.2-.2 1 3 2.7 1.8-.9 3.1.9 3.1-2.7 1.8-1 3-3.2-.2L12 22l-2.4-2.1-3.2.2-1-3-2.7-1.8.9-3.1-.9-3.1 2.7-1.8 1-3 3.2.2z"/><path d="m8.5 12 2.4 2.4 4.6-4.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const verifiedPill = (text = 'Verified agency') => `<span class="pill-verified">${VERIFIED_SEAL} ${text}</span>`;

function hueFrom(str) {
  let h = 0;
  for (const ch of String(str || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function avatarHtml(name, photo, cls = '') {
  const initial = escapeHtml((String(name || '').trim().match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase());
  const img = safeHttpUrl(photo);
  return `<span class="av ${cls}" style="--h:${hueFrom(name)}"><span>${initial}</span>${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
}

function emailOk(value) {
  const v = String(value || '').trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? v : '';
}
function phoneFrom(text) {
  const m = String(text || '').match(/\+?\d[\d\s().-]{6,}\d/);
  return m ? m[0].trim() : '';
}
function telHref(text) {
  const digits = String(text || '').replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : '';
}
function mapsHref(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(query || ''))}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}
function splitList(value) {
  return String(value || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 24);
}
// Turn URLs / emails inside ALREADY-escaped text into links.
function linkify(escaped) {
  return escaped
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, (u) => `<a href="${u}" rel="nofollow noopener" target="_blank">${u}</a>`)
    .replace(/(^|[\s(>])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (m, pre, mail) => `${pre}<a href="mailto:${mail}">${mail}</a>`);
}
function proseHtml(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`).join('');
}
function newestFirst(a, b) {
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

function btn(label, href, kind = 'primary', ic = '') {
  const external = /^https?:\/\//.test(href);
  return `<a class="btn btn-${kind}" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${ic ? icon(ic, 18) : ''}${label}</a>`;
}

function chipHtml(label, ic, href) {
  const inner = `${ic ? icon(ic, 14) : ''}<span>${escapeHtml(label)}</span>`;
  return href
    ? `<a class="chip chip-link" href="${escapeHtml(href)}">${inner}</a>`
    : `<span class="chip">${inner}</span>`;
}
function locationChip(text) {
  return chipHtml(text, 'pin', provinceHref(text));
}

function secHead(title, { count, href, linkLabel, id } = {}) {
  return `<div class="sec-head"><h2${id ? ` id="${id}"` : ''}>${title}${count !== undefined ? ` <span class="count">${count}</span>` : ''}</h2>${href ? `<a class="sec-link" href="${escapeHtml(href)}">${linkLabel || 'View all'} →</a>` : ''}</div>`;
}

function tileHtml(href, label, ic, sub = '') {
  const external = /^https?:\/\//.test(href);
  return `<a class="tile" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}><span class="tile-ic">${icon(ic, 22)}</span><span class="tile-tx"><b>${escapeHtml(label)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span><span class="tile-arrow">${icon('arrow', 18)}</span></a>`;
}

// Deep links understood by the app (see SA_SECTION_LINKS in app-ui.js).
function appTiles() {
  return `<div class="tiles tiles-3">${[
    ['/?section=vacancies', 'Vacancies', 'search', 'Browse every listed vacancy'],
    ['/?section=agencies', 'Recruitment agencies', 'building', 'Verified agencies and branches'],
    ['/?section=candidates', 'Talent Pool', 'users', 'Get found by recruiters'],
    ['/?section=posters', 'Vacancy posters', 'image', 'Shareable hiring posters'],
    ['/?section=employers', 'Employers', 'briefcase', 'Companies that are hiring'],
    ['/post-a-job/', 'Post a job', 'tag', 'Free to list, admin reviewed'],
  ].map(([h, l, i, s]) => tileHtml(h, l, i, s)).join('')}</div>`;
}

function provinceChips(current = '') {
  const items = LOCATION_HUBS.filter((h) => CTX.provinces.has(h.slug));
  if (!items.length) return '';
  return `<div class="chip-row" role="list">${items.map((h) => `<a class="chip chip-lg${h.slug === current ? ' is-active' : ''}" role="listitem" href="/jobs/${h.slug}/"${h.slug === current ? ' aria-current="page"' : ''}>${icon('pin', 14)}<span>${escapeHtml(h.name)}</span></a>`).join('')}</div>`;
}
function categoryChips(current = '') {
  const items = CATEGORIES.filter((c) => CTX.categories.has(c.slug));
  if (!items.length) return '';
  return `<div class="chip-row" role="list">${items.map((c) => `<a class="chip chip-lg${c.slug === current ? ' is-active' : ''}" role="listitem" href="/browse/category/${c.slug}/"${c.slug === current ? ' aria-current="page"' : ''}>${icon('tag', 14)}<span>${escapeHtml(c.label)}</span></a>`).join('')}</div>`;
}

// Vacancy card. The title link is stretched over the whole card; the company,
// location and type chips keep their own destinations.
function vacancyCard(v, slug) {
  const agencyRef = v.agency_id !== undefined && v.agency_id !== null ? CTX.agencyById.get(String(v.agency_id)) : null;
  const company = v.company || (agencyRef && agencyRef.name) || '';
  const companyHtml = company
    ? (agencyRef ? `<a href="/agency/${agencyRef.slug}/">${escapeHtml(company)}</a>` : escapeHtml(company))
    : '';
  const chips = [];
  if (v.location) chips.push(locationChip(v.location));
  const seen = new Set();
  [v.employment_type, v.contract_type].filter(Boolean).forEach((t) => {
    const key = String(t).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    chips.push(chipHtml(t, 'briefcase', categoryHref(t)));
  });
  if (v.remote && /remote/i.test(v.remote) && !seen.has(String(v.remote).toLowerCase())) chips.push(chipHtml(v.remote, 'globe', categoryHref('remote')));
  if (v.salary) chips.push(chipHtml(v.salary, 'cash'));
  const closing = v.closing_date ? `Closes ${escapeHtml(fmtDate(v.closing_date) || v.closing_date)}` : (fmtDate(v.created_at) ? `Posted ${fmtDate(v.created_at)}` : 'Open vacancy');
  return `<article class="jc">
<div class="jc-top">${avatarHtml(company || v.title, v.company_photo)}<div class="jc-head"><h3 class="jc-title"><a href="/vacancy/${slug}/">${escapeHtml(v.title || 'Untitled vacancy')}</a></h3>${companyHtml ? `<div class="jc-company">${companyHtml}</div>` : ''}</div></div>
${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
<div class="jc-foot"><span class="jc-date">${icon('calendar', 14)} ${closing}</span><span class="jc-go">View role ${icon('arrow', 16)}</span></div>
</article>`;
}

function agencyCard(agency) {
  const ref = CTX.agencyById.get(String(agency.id));
  const slug = (ref && ref.slug) || slugify(agency.name);
  const tags = splitList(agency.trades).slice(0, 4);
  return `<article class="jc">
<div class="jc-top">${avatarHtml(agency.name, agency.photo)}<div class="jc-head"><h3 class="jc-title"><a href="/agency/${slug}/">${escapeHtml(agency.name || 'Recruitment agency')}</a></h3></div></div>
${agency.verified ? verifiedPill('Verified') : ''}
<div class="chips">${agency.location ? locationChip(agency.location) : ''}${tags.map((t) => chipHtml(t, 'tag')).join('')}</div>
<div class="jc-foot"><span class="jc-date">${icon('building', 14)} Recruitment agency</span><span class="jc-go">View profile ${icon('arrow', 16)}</span></div>
</article>`;
}

function heroHtml({ kicker = '', title, lead = '', crumbs = [], actions = '', stats = [], media = '', chips = '' }) {
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs.map(([label, href], i) => (href && i < crumbs.length - 1
      ? `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`
      : `<li aria-current="page">${escapeHtml(label)}</li>`)).join('')}</ol></nav>`
    : '';
  const statHtml = stats.length
    ? `<ul class="hero-stats">${stats.map((s) => `<li><a href="${escapeHtml(s.href)}"><b>${escapeHtml(String(s.n))}</b><span>${escapeHtml(s.label)}</span></a></li>`).join('')}</ul>`
    : '';
  return `<section class="sp-hero"><div class="sp-wrap">${crumbHtml}<div class="hero-row">${media}<div class="hero-copy">${kicker ? `<span class="kicker">${kicker}</span>` : ''}<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${chips ? `<div class="chips chips-dark" style="margin-top:16px">${chips}</div>` : ''}${actions ? `<div class="hero-actions">${actions}</div>` : ''}</div></div>${statHtml}</div></section>`;
}

function footerHtml() {
  const provs = LOCATION_HUBS.filter((h) => CTX.provinces.has(h.slug))
    .map((h) => `<a href="/jobs/${h.slug}/">${escapeHtml(h.name)}</a>`).join('');
  const cats = CATEGORIES.filter((c) => CTX.categories.has(c.slug))
    .map((c) => `<a href="/browse/category/${c.slug}/">${escapeHtml(c.label)}</a>`).join('');
  return `<footer class="sp-footer"><div class="sp-wrap">
<div class="sp-foot-grid">
<div class="sp-foot-brand">
<a class="sp-brand sp-brand-light" href="/"><img src="/icons/v2-icon-192.png" alt="" width="40" height="40"><span><b>SA Recruiters</b><small>South African Recruitment Agencies Directory</small></span></a>
<p>Vacancies, recruitment agencies and candidate resources across South Africa. Free for job seekers.</p>
<div class="sp-contact"><a href="tel:+27715531005">${icon('phone', 16)} 071 553 1005</a><a href="https://wa.me/27715531005" target="_blank" rel="noopener noreferrer">${icon('chat', 16)} WhatsApp us</a><a href="mailto:sarecruiters.directory@gmail.com">${icon('mail', 16)} Email us</a><a href="https://g.page/r/CbL3q0tBfGAsEBI" target="_blank" rel="noopener noreferrer">${icon('pin', 16)} Find us on Google</a></div>
</div>
<div><h3>Explore</h3><div class="sp-footer-links"><a href="/careers/">Careers</a><a href="/apply/">Apply</a><a href="/contact/">Contact</a><a href="/register/">Register</a><a href="/candidates/">Candidates</a><a href="/about/">About</a><a href="/post-a-job/">Post a job</a></div></div>
<div><h3>In the app</h3><div class="sp-foot-col"><a href="/?section=vacancies">Vacancies</a><a href="/?section=agencies">Agencies</a><a href="/?section=candidates">Talent Pool</a><a href="/?section=posters">Vacancy posters</a><a href="/?section=employers">Employers</a></div></div>
${provs ? `<div><h3>Jobs by province</h3><div class="sp-foot-col">${provs}</div></div>` : ''}
${cats ? `<div><h3>Browse by type</h3><div class="sp-foot-col">${cats}</div></div>` : ''}
</div>
<div class="sp-foot-bottom"><span>&copy; ${new Date().getUTCFullYear()} SA Recruiters</span><span><a href="/privacy/">Privacy</a> &middot; <a href="/terms/">Terms</a> &middot; <a href="/faq/">FAQ</a> &middot; <a href="/know-your-rights/">Know your rights</a></span></div>
</div></footer>`;
}

function pageShell({ title, description, canonical, bodyHtml, jsonLd, image, hero = '', active = '', narrow = false, applyBar = '' }) {
  const ogImage = image || `${SITE_URL}/icons/v2-icon-512.png`;
  const cur = (key) => (active === key ? ' aria-current="page"' : '');
  return `<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#06162c">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SA Recruiters">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
${image ? '' : '<meta property="og:image:width" content="512">\n<meta property="og:image:height" content="512">\n'}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="icon" href="/favicon-v2.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/v2-favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/v2-icon-192.png">
<link rel="apple-touch-icon" href="/icons/v2-icon-192.png">
<link rel="stylesheet" href="/static-pages.css?v=${DEPLOY_VERSION}">
${jsonLd ? `<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>` : ''}
</head>
<body${applyBar ? ' class="has-applybar"' : ''}>
<a class="sp-skip" href="#main">Skip to content</a>
<header class="sp-header"><div class="sp-bar sp-wrap">
<a class="sp-brand" href="/" aria-label="Back to SA Recruiters"><img src="/icons/v2-icon-192.png" alt="SA Recruiters logo" width="40" height="40"><span><b>SA Recruiters</b><small>South African recruitment directory</small></span></a>
<nav class="sp-nav" aria-label="SA Recruiters pages">
<a href="/careers/"${cur('careers')}>Careers</a><a href="/apply/"${cur('apply')}>Apply for a vacancy</a><a href="/contact/"${cur('contact')}>Contact Us</a><a href="/register/"${cur('register')}>Register</a><a href="/candidates/"${cur('candidates')}>Candidates</a><a href="/about/"${cur('about')}>About SA Recruiters</a>
</nav>
<a class="sp-cta" href="/post-a-job/">${icon('tag', 16)} Post a job</a>
</div></header>
${hero}
<main id="main" class="sp-main"><div class="sp-wrap${narrow ? ' sp-narrow' : ''}">
${bodyHtml}
</div></main>
${applyBar}
${footerHtml()}
</body>
</html>`;
}

// ---------- fetch data ----------

async function fetchAllRows(table) {
  // Explicit column lists (not select('*')): manage_token is revoked from the
  // anon role (supabase/migrations/20260918_lock_down_manager_tokens.sql) and
  // static pages must never carry Smart Manager tokens. If a new column is
  // added to these tables and needs to appear on static pages, add it here
  // explicitly.
  const COLUMNS = {
    agencies: 'id,name,website,contact,email,location,address,cvpref,photo,companies,trades,verified',
    branches: 'id,agency_id,name,location,phone,email',
    vacancies: 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,updated_at,source_type',
  };
  const pageSize = 1000;
  const rows = [];
  const columns = COLUMNS[table] || '*';
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

async function fetchAll() {
  const [{ data: agencies, error: aErr }, { data: branches, error: bErr }, { data: vacancies, error: vErr }] =
    await Promise.all([
      fetchAllRows('agencies'),
      fetchAllRows('branches'),
      fetchAllRows('vacancies'),
    ]);

  if (aErr) console.error('agencies fetch error:', JSON.stringify(aErr));
  if (bErr) console.error('branches fetch error:', JSON.stringify(bErr));
  if (vErr) console.error('vacancies fetch error:', JSON.stringify(vErr));

  // A real Supabase error here must stop the build. Without this, the
  // script logs the error and carries on with an empty array, writes zero
  // agency/vacancy pages, exits 0 (green check), and GitHub Pages happily
  // deploys that empty result OVER whatever was working before — every
  // public listing page 404s even though the workflow "succeeded".
  if (aErr || bErr || vErr) {
    throw new Error(
      'Aborting build: Supabase fetch failed, refusing to deploy an empty/partial site. ' +
      'See the fetch error(s) logged above.'
    );
  }

  // Belt-and-braces: this directory normally has dozens of agencies. A
  // clean (no-error) but empty result is still a red flag worth stopping
  // for rather than silently publishing an empty directory.
  if (!agencies || agencies.length === 0) {
    throw new Error(
      'Aborting build: agencies table returned 0 rows with no error — ' +
      'that is almost certainly wrong for this directory, refusing to deploy.'
    );
  }

  return {
    agencies: agencies || [],
    branches: branches || [],
    vacancies: (vacancies || []).filter((vacancy) => !isExpiredVacancy(vacancy)),
  };
}

// ---------- page builders ----------

function buildAgencyPage(agency, agencyBranches, agencyVacancies, slug, vacancySlugById) {
  const canonical = `${SITE_URL}/agency/${slug}/`;
  const title = `${agency.name} — SA Recruiters Directory`;
  const description = `${agency.name} is a recruitment agency listed on SA Recruiters${
    agency.location ? ` in ${agency.location}` : ''
  }. ${agency.trades ? `Specialising in: ${agency.trades}.` : ''} Find contact details, branches and current vacancies.`;

  const phone = phoneFrom(agency.contact);
  const email = emailOk(agency.email);
  const site = safeHttpUrl(agency.website);
  const mapQuery = agency.address || agency.location || '';

  const actions = [
    phone && telHref(phone) ? btn('Call', telHref(phone), 'primary', 'phone') : '',
    email ? btn('Email', `mailto:${email}`, 'ghost', 'mail') : '',
    site ? btn('Website', site, 'ghost', 'globe') : '',
    mapQuery ? btn('Directions', mapsHref(mapQuery), 'ghost', 'map') : '',
    btn('All agencies', '/?section=agencies', 'ghost', 'building'),
  ].join('');

  const row = (label, ic, valueHtml) => (valueHtml
    ? `<li><span class="dl-ic">${icon(ic, 18)}</span><div><small>${label}</small>${valueHtml}</div></li>`
    : '');
  const details = [
    row('Location', 'pin', agency.location ? locationChip(agency.location) : ''),
    row('Address', 'map', agency.address ? `<a class="txt-link" href="${escapeHtml(mapsHref(agency.address))}" target="_blank" rel="noopener noreferrer">${escapeHtml(agency.address)}</a>` : ''),
    row('Contact', 'phone', agency.contact ? (phone && telHref(phone) ? `<a class="txt-link" href="${escapeHtml(telHref(phone))}">${escapeHtml(agency.contact)}</a>` : escapeHtml(agency.contact)) : ''),
    row('Email', 'mail', agency.email ? (email ? `<a class="txt-link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : escapeHtml(agency.email)) : ''),
    row('Website', 'globe', site ? `<a class="txt-link" href="${escapeHtml(site)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(agency.website)}</a>` : ''),
  ].join('');

  const trades = splitList(agency.trades);
  const companies = splitList(agency.companies);
  const tagCard = (heading, ic, list) => (list.length
    ? `<section class="card"><h2 class="card-h">${heading}</h2><div class="chips">${list.map((t) => chipHtml(t, ic)).join('')}</div></section>`
    : '');

  const branchesHtml = agencyBranches.length
    ? `${secHead('Branches', { count: agencyBranches.length, id: 'branches' })}<div class="grid">${agencyBranches.map((b) => {
      const bPhone = b.phone && telHref(b.phone) ? `<li><a href="${escapeHtml(telHref(b.phone))}">${icon('phone', 15)} ${escapeHtml(b.phone)}</a></li>` : '';
      const bEmail = emailOk(b.email) ? `<li><a href="mailto:${escapeHtml(emailOk(b.email))}">${icon('mail', 15)} ${escapeHtml(b.email)}</a></li>` : '';
      return `<article class="card branch"><h3>${escapeHtml(b.name)}</h3>${b.location ? `<div class="chips">${locationChip(b.location)}</div>` : ''}${bPhone || bEmail ? `<ul class="branch-links">${bPhone}${bEmail}</ul>` : ''}</article>`;
    }).join('')}</div>`
    : '';

  const vacanciesHtml = agencyVacancies.length
    ? `${secHead('Current Vacancies', { count: agencyVacancies.length, id: 'vacancies' })}<div class="grid">${agencyVacancies.map((v) => {
      const vSlug = vacancySlugById.get(v.__staticSlugKey) || slugify(v.title);
      return vacancyCard(v, vSlug);
    }).join('')}</div>`
    : '';

  const body = `
<div class="two" style="margin-top:26px">
<section class="card" style="margin:0"><h2 class="card-h">Contact &amp; details</h2>${details ? `<ul class="dl">${details}</ul>` : '<p class="muted" style="margin:0">Contact details have not been added yet.</p>'}</section>
<div>${tagCard('Trades &amp; industries', 'tag', trades)}${tagCard('Companies', 'building', companies)}</div>
</div>
${branchesHtml}
${vacanciesHtml}
<p class="hub-note"><a href="/?section=agencies">Browse all recruitment agencies →</a> &middot; <a href="/careers/">Search vacancies</a></p>
`;

  const stats = [];
  if (agencyVacancies.length) stats.push({ n: agencyVacancies.length, label: 'Open vacancies', href: '#vacancies' });
  if (agencyBranches.length) stats.push({ n: agencyBranches.length, label: 'Branches', href: '#branches' });

  const hero = heroHtml({
    kicker: `${icon('building', 14)} Recruitment agency`,
    chips: agency.verified ? verifiedPill() : '',
    title: escapeHtml(agency.name),
    lead: agency.trades ? `Specialising in ${escapeHtml(agency.trades)}.` : `Listed on SA Recruiters${agency.location ? ` in ${escapeHtml(agency.location)}` : ''}.`,
    crumbs: [['Home', '/'], ['Agencies', '/?section=agencies'], [agency.name, '']],
    media: avatarHtml(agency.name, agency.photo, 'av-lg'),
    actions,
    stats,
  });

  return pageShell({ title, description, canonical, bodyHtml: body, hero });
}

// South African province names we can recognise inside a free-text
// `location` string, so jobLocation.address.addressRegion can be filled
// in without needing a separate structured field in the database.
const SA_PROVINCES = [
  'Gauteng',
  'Western Cape',
  'Eastern Cape',
  'KwaZulu-Natal',
  'Kwazulu Natal',
  'Kwazulu-Natal',
  'Free State',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
];

function inferAddressRegion(locationText) {
  if (!locationText) return undefined;
  const match = SA_PROVINCES.find((p) =>
    locationText.toLowerCase().includes(p.toLowerCase())
  );
  return match ? (match.startsWith('Kwazulu') ? 'KwaZulu-Natal' : match) : undefined;
}

function inferAddressLocality(locationText) {
  const text = String(locationText || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'South Africa';
  const firstPart = text.split(',')[0].trim();
  const locality = firstPart.split(/\s+-\s+/)[0].trim();
  return locality || 'South Africa';
}

// Google requires every JobPosting to have EITHER a jobLocation with at
// least addressCountry, OR jobLocationType: 'TELECOMMUTE' for fully
// remote roles. Previously this was `undefined` whenever vacancy.location
// was empty, which silently dropped the field and caused the "Missing
// field 'jobLocation'" critical error. We now always emit a location -
// falling back to a country-level address as a last resort, which is
// enough to satisfy the requirement even when we don't have city-level
// data. addressRegion is filled in opportunistically from the free-text
// location field where we can recognise a province name; streetAddress
// and postalCode remain genuinely unavailable for most listings sourced
// from third-party job boards, since none of those sources expose a
// street-level address - that gap is a real data limitation, not a bug.
function buildJobLocationFields(vacancy) {
  if (vacancy.remote === 'Remote') {
    return {
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: {
        '@type': 'Country',
        name: 'South Africa',
      },
    };
  }

  return {
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: inferAddressLocality(vacancy.location),
        addressRegion: inferAddressRegion(vacancy.location),
        addressCountry: 'ZA',
      },
    },
  };
}

const SCHEMA_MAX_AGE_DAYS = {
  adzuna: 45,
  himalayas: 45,
  simplify: 45,
  oracle: 60,
  government: 90,
};

// Use the source's explicit closing date when available. For feeds without a
// closing date, mirror the same maximum posting-age policy used by the app's
// stale-vacancy cleanup rather than omitting Google's recommended field.
function resolveValidThrough(vacancy) {
  if (vacancy.closing_date) return vacancy.closing_date;
  const created = new Date(vacancy.created_at || '');
  if (Number.isNaN(created.getTime())) return undefined;
  const days = SCHEMA_MAX_AGE_DAYS[vacancy.source_type] || 60;
  created.setUTCDate(created.getUTCDate() + days);
  return created.toISOString().slice(0, 10);
}

// schema.org expects baseSalary.value.value to be a NUMBER, and
// baseSalary.value.unitText (YEAR/MONTH/WEEK/HOUR) to be present.
// The previous code put the raw salary string (e.g. "R17,000/month CTC")
// directly into `value`, which is invalid regardless of the unitText gap
// Search Console flagged. We now try to actually parse a number and a
// unit out of the free-text salary field; if we can't confidently parse
// both, we omit baseSalary entirely rather than emit malformed data -
// vague values like "Market Related" or "Negotiable" have no numeric
// salary to report, so leaving the field out is the correct outcome for
// those, not a bug to fix.
function buildBaseSalary(vacancy) {
  if (!vacancy.salary) return undefined;

  const amountMatch = vacancy.salary.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!amountMatch) return undefined;
  const value = parseFloat(amountMatch[1]);
  if (Number.isNaN(value)) return undefined;

  const lower = vacancy.salary.toLowerCase();
  let unitText;
  if (lower.includes('hour')) unitText = 'HOUR';
  else if (lower.includes('week')) unitText = 'WEEK';
  else if (lower.includes('month')) unitText = 'MONTH';
  else if (lower.includes('annum') || lower.includes('year')) unitText = 'YEAR';
  else return undefined; // can't confidently determine the pay period

  return {
    '@type': 'MonetaryAmount',
    currency: 'ZAR',
    value: {
      '@type': 'QuantitativeValue',
      value,
      unitText,
    },
  };
}

function buildJobDescriptionHtml(vacancy, companyName) {
  const paragraphs = [
    vacancy.notes,
    vacancy.location ? `Location: ${vacancy.location}` : '',
    vacancy.employment_type ? `Employment type: ${vacancy.employment_type}` : '',
    vacancy.contract_type ? `Contract type: ${vacancy.contract_type}` : '',
    vacancy.hours ? `Hours: ${vacancy.hours}` : '',
    vacancy.work_schedule ? `Schedule: ${vacancy.work_schedule}` : '',
    vacancy.remote ? `Work style: ${vacancy.remote}` : '',
    vacancy.experience_level ? `Experience level: ${vacancy.experience_level}` : '',
    vacancy.salary ? `Salary: ${vacancy.salary}` : '',
    vacancy.closing_date ? `Closing date: ${vacancy.closing_date}` : '',
    vacancy.email ? `Application email: ${vacancy.email}` : '',
    vacancy.phone ? `Application phone: ${vacancy.phone}` : '',
    safeHttpUrl(vacancy.link) ? `Application link: ${safeHttpUrl(vacancy.link)}` : '',
  ].filter(Boolean).map((value) => `<p>${escapeHtml(String(value)).replace(/\n+/g, '</p><p>')}</p>`);
  if (!paragraphs.length) paragraphs.push(`<p>${escapeHtml(vacancy.title)} at ${escapeHtml(companyName)}. See the application instructions below.</p>`);
  return paragraphs.join('');
}

function buildVacancyPage(vacancy, agency, slug, extras = {}) {
  const canonical = `${SITE_URL}/vacancy/${slug}/`;
  const companyName = vacancy.company || (agency && agency.name) || 'A South African employer';
  const title = `${vacancy.title} — ${companyName} | SA Recruiters`;
  const description = `${vacancy.title} vacancy at ${companyName}${
    vacancy.location ? ` in ${vacancy.location}` : ''
  }. ${vacancy.employment_type || ''} ${vacancy.contract_type || ''}`.trim();

  const applyUrl = safeHttpUrl(vacancy.link);
  const hiringOrganization = {
    '@type': 'Organization',
    name: companyName,
    ...(safeHttpUrl(agency?.website) ? { sameAs: safeHttpUrl(agency.website) } : {}),
    ...(safeHttpUrl(vacancy.company_photo) ? { logo: safeHttpUrl(vacancy.company_photo) } : {}),
  };
  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: vacancy.title,
    description: buildJobDescriptionHtml(vacancy, companyName),
    datePosted: vacancy.created_at,
    dateModified: vacancy.updated_at || vacancy.created_at,
    validThrough: resolveValidThrough(vacancy),
    url: canonical,
    employmentType: vacancy.employment_type || undefined,
    hiringOrganization,
    directApply: Boolean(applyUrl || vacancy.email || vacancy.phone),
    ...buildJobLocationFields(vacancy),
    baseSalary: buildBaseSalary(vacancy),
  };

  const agencySlug = extras.agencySlug || (agency ? slugify(agency.name) : '');
  const email = emailOk(vacancy.email);
  const phone = vacancy.phone && telHref(vacancy.phone) ? vacancy.phone : '';
  const hasApply = Boolean(applyUrl || email || phone);

  // ---- fact tiles: each value links to the section it belongs to ----
  const fact = (label, ic, value, href) => {
    if (!value) return '';
    const inner = `${icon(ic, 20)}<div><small>${label}</small><b>${escapeHtml(value)}</b></div>`;
    return href ? `<a class="fact" href="${escapeHtml(href)}">${inner}</a>` : `<div class="fact">${inner}</div>`;
  };
  const facts = [
    fact('Location', 'pin', vacancy.location, provinceHref(vacancy.location)),
    fact('Employment type', 'briefcase', vacancy.employment_type, categoryHref(vacancy.employment_type)),
    fact('Contract type', 'tag', vacancy.contract_type, categoryHref(vacancy.contract_type)),
    fact('Work style', 'globe', vacancy.remote, categoryHref(vacancy.remote)),
    fact('Salary', 'cash', vacancy.salary, ''),
    fact('Hours', 'clock', vacancy.hours, ''),
    fact('Schedule', 'calendar', vacancy.work_schedule, ''),
    fact('Experience level', 'level', vacancy.experience_level, ''),
    fact('Start date', 'calendar', vacancy.start_date, ''),
    fact('Closing date', 'calendar', vacancy.closing_date ? (fmtDate(vacancy.closing_date) || vacancy.closing_date) : '', ''),
    fact('Posted', 'clock', fmtDate(vacancy.created_at), ''),
  ].join('');

  // ---- apply card ----
  const applyButtons = [
    applyUrl ? `<a class="btn btn-primary btn-block sp-apply" href="${escapeHtml(applyUrl)}" rel="nofollow noopener" target="_blank">Apply for this role →</a>` : '',
    email ? btn('Email your application', `mailto:${email}?subject=${encodeURIComponent(`Application: ${vacancy.title}`)}`, applyUrl ? 'outline' : 'primary', 'mail').replace('class="btn', 'class="btn btn-block') : '',
    phone ? btn(`Call ${escapeHtml(vacancy.phone)}`, telHref(vacancy.phone), 'outline', 'phone').replace('class="btn', 'class="btn btn-block') : '',
  ].join('');
  const provHref = provinceHref(vacancy.location);
  const agencyLink = agency && agencySlug ? `/agency/${escapeHtml(agencySlug)}/` : '';
  const sideLinks = [
    agencyLink ? `<li><a href="${agencyLink}">${icon('building', 16)} View agency profile</a></li>` : '',
    provHref ? `<li><a href="${provHref}">${icon('pin', 16)} More jobs in ${escapeHtml(provinceFor(vacancy.location))}</a></li>` : '',
    `<li><a href="/?section=vacancies">${icon('search', 16)} Browse all vacancies</a></li>`,
    `<li><a href="https://wa.me/?text=${encodeURIComponent(`${vacancy.title} at ${companyName} — ${canonical}`)}" target="_blank" rel="noopener noreferrer">${icon('share', 16)} Share on WhatsApp</a></li>`,
  ].join('');

  const companyLine = agencyLink
    ? `<a href="${agencyLink}">${escapeHtml(companyName)}</a>`
    : escapeHtml(companyName);

  const body = `
<div class="vp">
<div class="vp-main">
<section class="card"><h2 class="card-h">Role overview</h2><div class="facts">${facts}</div></section>
${vacancy.notes ? `<section class="card"><h2 class="card-h">Details</h2><div class="prose">${proseHtml(vacancy.notes)}</div></section>` : ''}
</div>
<aside class="vp-side"><div class="card apply-card">
<div class="apply-co">${avatarHtml(companyName, vacancy.company_photo)}<div><b>${companyLine}</b><small>${escapeHtml(vacancy.location || 'South Africa')}</small></div></div>
${hasApply ? applyButtons : '<p class="apply-note">To apply, visit the SA Recruiters app and use the contact details on the agency listing.</p>' + (agencyLink ? btn('View agency contact details', agencyLink, 'primary', 'building').replace('class="btn', 'class="btn btn-block') : btn('Open SA Recruiters', '/', 'primary', 'search').replace('class="btn', 'class="btn btn-block'))}
<ul class="side-links">${sideLinks}</ul>
</div></aside>
</div>
${extras.related && extras.related.length ? `${secHead('More vacancies you may like', { href: '/?section=vacancies', linkLabel: 'Browse all' })}<div class="grid">${extras.related.map((r) => vacancyCard(r.vacancy, r.slug)).join('')}</div>` : ''}
`;

  const heroChips = [
    vacancy.location ? locationChip(vacancy.location) : '',
    vacancy.employment_type ? chipHtml(vacancy.employment_type, 'briefcase', categoryHref(vacancy.employment_type)) : '',
    vacancy.contract_type && vacancy.contract_type !== vacancy.employment_type ? chipHtml(vacancy.contract_type, 'tag', categoryHref(vacancy.contract_type)) : '',
    vacancy.remote && /remote/i.test(vacancy.remote) ? chipHtml(vacancy.remote, 'globe', categoryHref('remote')) : '',
    vacancy.salary ? chipHtml(vacancy.salary, 'cash') : '',
  ].join('');

  const crumbs = [['Home', '/'], ['Vacancies', '/?section=vacancies']];
  if (provHref) crumbs.push([provinceFor(vacancy.location), provHref]);
  crumbs.push([vacancy.title || 'Vacancy', '']);

  const hero = heroHtml({
    kicker: `${icon('briefcase', 14)} Vacancy`,
    title: escapeHtml(vacancy.title),
    lead: `<span class="hero-company">${companyLine}</span>`,
    crumbs,
    media: avatarHtml(companyName, vacancy.company_photo, 'av-lg'),
    chips: heroChips,
  });

  const applyBar = hasApply
    ? `<div class="applybar">${applyUrl
      ? `<a class="btn btn-primary" href="${escapeHtml(applyUrl)}" rel="nofollow noopener" target="_blank">Apply for this role →</a>`
      : (email ? btn('Email application', `mailto:${email}?subject=${encodeURIComponent(`Application: ${vacancy.title}`)}`, 'primary', 'mail') : btn('Call now', telHref(vacancy.phone), 'primary', 'phone'))}</div>`
    : '';

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd, hero, applyBar, active: 'careers' });
}

// ---------- vacancy poster pages ----------
// Must match posterPublicSlug() in app-manager.js so in-app share links resolve.
function posterSlug(p) {
  const base = String(p.caption || 'vacancy-poster').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'vacancy-poster';
  return `${base}-${String(p.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase()}`;
}

function buildPosterPage(poster, slug) {
  const canonical = `${SITE_URL}/poster/${slug}/`;
  const heading = poster.caption || 'Vacancy poster';
  const title = `${heading} | SA Recruiters`;
  const description = `${heading} — recruitment poster on SA Recruiters, South Africa's recruitment directory.`;
  const imageUrl = safeHttpUrl(poster.image_url);
  const body = `
${imageUrl
    ? `<figure class="poster-frame" style="margin-bottom:0"><a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open the full-size poster"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(heading)}"></a></figure>`
    : '<div class="empty"><p>The poster image is unavailable.</p></div>'}
<div class="poster-actions">${btn('Browse vacancies', '/?section=vacancies', 'primary', 'search')}${btn('More posters', '/?section=posters', 'outline', 'image')}${btn('Post a job', '/post-a-job/', 'outline', 'tag')}</div>
<p class="hub-note"><a href="/">Browse all agencies and vacancies on SA Recruiters →</a></p>
`;
  const hero = heroHtml({
    kicker: `${icon('image', 14)} Vacancy poster`,
    title: escapeHtml(heading),
    crumbs: [['Home', '/'], ['Posters', '/?section=posters'], [heading, '']],
  });
  return pageShell({ title, description, canonical, bodyHtml: body, hero, image: imageUrl || undefined });
}

// ---------- location hub pages ----------

function isOpenVacancy(vacancy) {
  if (!vacancy.closing_date) return true;
  const closing = new Date(vacancy.closing_date);
  // Keep unparseable free-text dates visible for manual review rather than
  // accidentally hiding a legitimate opportunity.
  return Number.isNaN(closing.getTime()) || closing >= new Date();
}

function locationContains(value, locationName) {
  // Normalise hyphens/spaces so "KwaZulu-Natal" (slug-derived name) still
  // matches free-text locations written as "Kwazulu Natal" or "kwa-zulu natal".
  const norm = (s) => String(s || '').toLowerCase().replace(/[-\s]+/g, ' ').trim();
  return norm(value).includes(norm(locationName));
}

function buildLocationHubPage({ locationName, slug, vacancies, agencies, branches }) {
  const currentVacancies = vacancies
    .filter((vacancy) => isOpenVacancy(vacancy))
    .filter((vacancy) => locationInProvince(vacancy.location, locationName))
    .sort(newestFirst);

  const matchingAgencyIds = new Set(
    agencies
      .filter((agency) => locationInProvince(agency.location, locationName))
      .map((agency) => String(agency.id))
  );

  branches
    .filter((branch) => locationInProvince(branch.location, locationName))
    .forEach((branch) => matchingAgencyIds.add(String(branch.agency_id)));

  const matchingAgencies = agencies.filter((agency) => matchingAgencyIds.has(String(agency.id)));

  // Do not publish a thin, empty hub. The caller should also omit this URL
  // from the sitemap when the function returns null.
  if (currentVacancies.length === 0 && matchingAgencies.length === 0) return null;

  const canonical = `${SITE_URL}/jobs/${slug}/`;
  const title = `${locationName} Jobs & Vacancies — SA Recruiters`;
  const description = `Find current job vacancies and recruitment agencies in ${locationName}, South Africa. Browse roles by employer, agency and job type on SA Recruiters.`;

  const shown = currentVacancies.slice(0, 50);
  const slugFor = (vacancy) => CTX.vacancySlugs.get(vacancy.__staticSlugKey) || slugify(vacancy.title);

  const vacancyList = currentVacancies.length
    ? `${secHead(`Current ${escapeHtml(locationName)} vacancies`, { count: currentVacancies.length, id: 'vacancies', href: '/?section=vacancies', linkLabel: 'Open in app' })}
       <div class="grid">${shown.map((vacancy) => vacancyCard(vacancy, slugFor(vacancy))).join('')}</div>
       ${currentVacancies.length > shown.length ? `<p class="hub-note">Showing the ${shown.length} newest of ${currentVacancies.length} vacancies. <a href="/?section=vacancies">See every vacancy in the app →</a></p>` : ''}`
    : `${secHead(`Current ${escapeHtml(locationName)} vacancies`, { id: 'vacancies' })}<div class="empty"><p>No current ${escapeHtml(locationName)} vacancies are available in the directory at this time. Check back soon or browse the agencies below.</p>${btn('Browse all vacancies', '/?section=vacancies', 'primary', 'search')}</div>`;

  const agencyList = matchingAgencies.length
    ? `${secHead(`Recruitment agencies in ${escapeHtml(locationName)}`, { count: matchingAgencies.length, id: 'agencies', href: '/?section=agencies', linkLabel: 'Open in app' })}
       <div class="grid">${matchingAgencies.slice(0, 50).map((agency) => agencyCard(agency)).join('')}</div>`
    : '';

  const itemList = shown.map((vacancy, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: vacancy.title || 'Vacancy',
    url: `${SITE_URL}/vacancy/${slugFor(vacancy)}/`,
  }));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'SA Recruiters', url: `${SITE_URL}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: itemList.length,
      itemListElement: itemList,
    },
  };

  const body = `
${secHead('Browse by province')}${provinceChips(slug)}
${secHead('Browse by type')}${categoryChips()}
${vacancyList}
${agencyList}
<p class="hub-note"><a href="/">Return to the SA Recruiters directory</a> to browse all agencies and vacancies.</p>
`;

  const stats = [];
  if (currentVacancies.length) stats.push({ n: currentVacancies.length, label: 'Open vacancies', href: '#vacancies' });
  if (matchingAgencies.length) stats.push({ n: matchingAgencies.length, label: 'Agencies', href: '#agencies' });

  const hero = heroHtml({
    kicker: `${icon('pin', 14)} Jobs by province`,
    title: `${escapeHtml(locationName)} jobs and vacancies`,
    lead: `Explore current job opportunities and recruitment agencies serving ${escapeHtml(locationName)}, South Africa. Select a vacancy for the full job description and application details.`,
    crumbs: [['Home', '/'], ['Careers', '/careers/'], [locationName, '']],
    actions: `${btn('Browse all vacancies', '/?section=vacancies', 'primary', 'search')}${btn('Post a job', '/post-a-job/', 'ghost', 'tag')}`,
    stats,
  });

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd, hero, active: 'careers' });
}

// ---------- category hubs (Government/Learnerships/Internships/etc, see
// firstjobly.co.za "Browse by type") ----------
// employment_type/contract_type are free-text fields (not an enum), so we
// match the same way locationContains() does for province hubs: a
// case-insensitive substring check across the fields most likely to carry
// the category keyword, plus source_type for the vacancies we already tag
// at ingestion time (government/dpsa, learnerships).
function vacancyMatchesCategory(vacancy, category) {
  const haystack = [
    vacancy.title, vacancy.employment_type, vacancy.contract_type,
    vacancy.notes, vacancy.experience_level, vacancy.source_type,
  ].filter(Boolean).join(' ').toLowerCase();
  return category.keywords.some((kw) => haystack.includes(kw));
}

function buildCategoryHubPage({ category, vacancies, vacancySlugById }) {
  const currentVacancies = vacancies
    .filter((vacancy) => isOpenVacancy(vacancy))
    .filter((vacancy) => vacancyMatchesCategory(vacancy, category))
    .sort(newestFirst);

  // Do not publish a thin, empty hub. The caller should also omit this URL
  // from the sitemap when the function returns null.
  if (currentVacancies.length === 0) return null;

  const canonical = `${SITE_URL}/browse/category/${category.slug}/`;
  const title = `${category.label} in South Africa — SA Recruiters`;
  const description = `Browse current ${category.label.toLowerCase()} in South Africa. Updated listings from recruitment agencies and employers on SA Recruiters.`;

  const shown = currentVacancies.slice(0, 50);
  const vacancyList = `${secHead(`Current ${escapeHtml(category.label)}`, { count: currentVacancies.length, id: 'vacancies', href: '/?section=vacancies', linkLabel: 'Open in app' })}
    <div class="grid">${shown.map((vacancy) => {
      const slug = vacancySlugById?.get(recordMapKey(vacancy, vacancies.indexOf(vacancy))) || slugify(vacancy.title);
      return vacancyCard(vacancy, slug);
    }).join('')}</div>
    ${currentVacancies.length > shown.length ? `<p class="hub-note">Showing the ${shown.length} newest of ${currentVacancies.length} listings. <a href="/?section=vacancies">See every vacancy in the app →</a></p>` : ''}`;

  const itemList = shown.map((vacancy, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: vacancy.title || 'Vacancy',
    url: `${SITE_URL}/vacancy/${vacancySlugById?.get(recordMapKey(vacancy, vacancies.indexOf(vacancy))) || slugify(vacancy.title)}/`,
  }));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'SA Recruiters', url: `${SITE_URL}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: itemList.length,
      itemListElement: itemList,
    },
  };

  const body = `
${secHead('Browse by type')}${categoryChips(category.slug)}
${secHead('Browse by province')}${provinceChips()}
${vacancyList}
<p class="hub-note"><a href="/">Return to the SA Recruiters directory</a> to browse all agencies, employers and vacancies.</p>
`;

  const hero = heroHtml({
    kicker: `${icon('tag', 14)} Browse by type`,
    title: `${escapeHtml(category.label)} in South Africa`,
    lead: escapeHtml(category.intro),
    crumbs: [['Home', '/'], ['Careers', '/careers/'], [category.label, '']],
    actions: `${btn('Browse all vacancies', '/?section=vacancies', 'primary', 'search')}${btn('Post a job', '/post-a-job/', 'ghost', 'tag')}`,
    stats: [{ n: currentVacancies.length, label: 'Open listings', href: '#vacancies' }],
  });

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd, hero, active: 'careers' });
}

// ---------- static "Post a job" page (firstjobly.co.za/post-a-job style) ----------
// A real, crawlable, always-open lead-capture page — see the "Fix all
// issues" request: unlike the in-app sheet, this needs no JS bundle or
// Supabase client to load; it posts straight to the Worker's
// /api/submit/job-enquiry endpoint (public_submit_job_enquiry RPC,
// 20260923_add_job_post_enquiries.sql), gated only by Cloudflare
// Turnstile, exactly like the in-app "Post a job" sheet.
function buildPostAJobPage() {
  const canonical = `${SITE_URL}/post-a-job/`;
  const title = 'Post a job on SA Recruiters — reach South African job seekers';
  const description = "Tell us about the roles you're hiring for. An admin reviews every request before anything is published. SA Recruiters never charges employers to list vacancies.";

  const roleTypes = ['Internships', 'Learnerships', 'Entry-Level', 'Graduate Programmes', 'Bursaries', 'Apprenticeships', 'Permanent', 'Contract'];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'SA Recruiters', url: `${SITE_URL}/` },
  };

  const trustTile = (ic, b, small) => `<div class="tile"><span class="tile-ic">${icon(ic, 22)}</span><span class="tile-tx"><b>${b}</b><small>${small}</small></span></div>`;
  const body = `
<div class="trust">${trustTile('tag', 'Free to list', 'SA Recruiters never charges employers')}${trustTile('shield', 'Admin reviewed', 'Nothing goes live until approved')}${trustTile('users', 'Reach candidates', 'Across every South African province')}</div>
<div class="card pj-card">
<form id="pj-form" class="pj-form" novalidate>
  <label>Company name<input id="pj-company" name="company_name" required></label>
  <label>Contact person<input id="pj-contact" name="contact_person"></label>
  <label>Work email<input id="pj-email" name="work_email" type="email" required></label>
  <label>Phone number <span class="pj-optional">optional</span><input id="pj-phone" name="phone" type="tel"></label>
  <label>Industry <span class="pj-optional">optional</span><input id="pj-industry" name="industry"></label>
  <label>Positions to fill <span class="pj-optional">optional</span>
    <select id="pj-positions" name="positions_to_fill">
      <option value="">Select</option>
      <option>1</option><option>2-5</option><option>6-10</option><option>10+</option>
    </select>
  </label>
  <fieldset class="pj-roles">
    <legend>What kind of roles? <span class="pj-optional">optional</span></legend>
    ${roleTypes.map((r) => `<label class="pj-role-check"><input type="checkbox" name="role_types" value="${escapeHtml(r)}"> ${escapeHtml(r)}</label>`).join('')}
  </fieldset>
  <label>Additional details <span class="pj-optional">optional</span><textarea id="pj-details" name="additional_details" rows="4"></textarea></label>
  <label>Website <span class="pj-optional">optional</span><input id="pj-website" name="website"></label>
  <div id="pj-turnstile" class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}"></div>
  <button type="submit" id="pj-submit">Submit for admin review</button>
  <p id="pj-status" role="status" aria-live="polite"></p>
</form>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
document.getElementById('pj-form').addEventListener('submit', async function(e){
  e.preventDefault();
  var form = e.target, status = document.getElementById('pj-status'), btn = document.getElementById('pj-submit');
  var roleTypes = Array.prototype.slice.call(form.querySelectorAll('input[name="role_types"]:checked')).map(function(c){ return c.value; });
  var token = '';
  try { if (window.turnstile) token = window.turnstile.getResponse() || ''; } catch (err) {}
  var payload = {
    company_name: form.company_name.value.trim(),
    contact_person: form.contact_person.value.trim(),
    work_email: form.work_email.value.trim(),
    phone: form.phone.value.trim(),
    industry: form.industry.value.trim(),
    positions_to_fill: form.positions_to_fill.value,
    role_types: roleTypes,
    additional_details: form.additional_details.value.trim(),
    website: form.website.value.trim()
  };
  if (!payload.company_name || !payload.work_email) { status.textContent = 'Add your company name and work email.'; return; }
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    var res = await fetch('${R2_WORKER_URL}/api/submit/job-enquiry', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'cf-turnstile-response': token } : {}),
      body: JSON.stringify(payload)
    });
    var data = await res.json().catch(function(){ return null; });
    if (res.ok) {
      status.textContent = 'Submitted for admin review — it will not be published until approved.';
      form.reset();
      if (window.turnstile) window.turnstile.reset();
    } else {
      status.textContent = (data && data.error) || 'Could not send your enquiry — please try again.';
    }
  } catch (err) {
    status.textContent = 'Could not reach SA Recruiters — please try again or WhatsApp us on 071 553 1005.';
  }
  btn.disabled = false; btn.textContent = 'Submit for admin review';
});
</script>
`;

  const hero = heroHtml({
    kicker: `${icon('tag', 14)} For employers`,
    title: 'Post a job',
    lead: "Tell us about the roles you're hiring for. An admin will review your request before anything is published &mdash; SA Recruiters never charges employers to list vacancies.",
    crumbs: [['Home', '/'], ['Post a job', '']],
  });
  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd, hero, narrow: true });
}

// Permanent, crawlable landing pages for the site's primary user journeys.
// These use normal anchor links instead of JavaScript-only actions so search
// engines can discover a stable internal-link graph for sitelink candidates.
const SEO_LANDING_PAGES = [
  { slug: 'careers', title: 'Careers and Vacancies in South Africa | SA Recruiters', description: 'Browse current careers and job vacancies from recruitment agencies and employers across South Africa.', heading: 'Careers and Vacancies', intro: 'Find your next opportunity through SA Recruiters. Browse current vacancies by location, category and work style.', links: [['/jobs/gauteng/', 'Browse Gauteng vacancies'], ['/browse/category/remote/', 'Find remote and work-from-home jobs'], ['/browse/category/government/', 'Browse government vacancies'], ['/browse/category/learnership/', 'Find learnerships'], ['/candidates/', 'Candidate resources and Talent Pool']] },
  { slug: 'apply', title: 'Apply for a Vacancy | SA Recruiters', description: 'Learn how to apply for jobs listed by South African recruitment agencies and employers on SA Recruiters.', heading: 'Apply for a Vacancy', intro: 'Open a vacancy, review the employer or agency instructions, and use the application link or contact details provided on the listing.', links: [['/careers/', 'Browse careers and vacancies'], ['/browse/category/remote/', 'Browse remote vacancies'], ['/contact/', 'Contact SA Recruiters']] },
  { slug: 'contact', title: 'Contact Us | SA Recruiters', description: 'Contact SA Recruiters about recruitment agencies, vacancies, candidate support and employer listings.', heading: 'Contact Us', intro: 'Need help with a listing, agency information or the SA Recruiters platform? Contact our team using the details below.', contact: true, links: [['/careers/', 'Browse vacancies'], ['/post-a-job/', 'Post a job'], ['/register/', 'Register as a candidate or employer']] },
  { slug: 'register', title: 'Register as a Candidate or Employer | SA Recruiters', description: 'Register with SA Recruiters to join the Talent Pool or submit recruitment opportunities for your company.', heading: 'Register with SA Recruiters', intro: 'Candidates can join the Talent Pool and employers can submit vacancies for consideration. Registration is free.', links: [['/candidates/', 'Join the Candidate Talent Pool'], ['/post-a-job/', 'Post a job as an employer'], ['/contact/', 'Contact us for registration help']] },
  { slug: 'candidates', title: 'Candidates and Talent Pool | SA Recruiters', description: 'Candidate resources, job-search guidance and Talent Pool registration for South African job seekers.', heading: 'Candidates', intro: 'Discover vacancies, prepare for your job search and make it easier for recruitment agencies and employers to find you.', links: [['/careers/', 'Search careers and vacancies'], ['/register/', 'Join the Talent Pool'], ['/browse/category/learnership/', 'Browse learnerships'], ['/browse/category/internship/', 'Browse internships']] },
  { slug: 'about', title: 'About SA Recruiters | South African Recruitment Directory', description: 'Learn how SA Recruiters helps candidates, recruitment agencies and employers connect through a practical South African jobs directory.', heading: 'About SA Recruiters', intro: 'SA Recruiters is a practical starting point for South African hiring. We bring vacancies, recruitment agencies, employers and candidate resources together in one easy-to-use directory.', about: true, links: [['/careers/', 'Browse vacancies'], ['/candidates/', 'Candidate resources'], ['/post-a-job/', 'Post a job'], ['/contact/', 'Contact Us']] },
];

const LANDING_CTAS = {
  careers: [['/?section=vacancies', 'Browse all vacancies', 'primary', 'search'], ['/post-a-job/', 'Post a job', 'ghost', 'tag']],
  apply: [['/careers/', 'Browse vacancies', 'primary', 'search'], ['/contact/', 'Need help?', 'ghost', 'chat']],
  contact: [['tel:+27715531005', 'Call 071 553 1005', 'primary', 'phone'], ['https://wa.me/27715531005', 'WhatsApp us', 'ghost', 'chat']],
  register: [['/?section=candidates', 'Join the Talent Pool', 'primary', 'users'], ['/post-a-job/', 'Post a job', 'ghost', 'tag']],
  candidates: [['/?section=candidates', 'Join the Talent Pool', 'primary', 'users'], ['/careers/', 'Search vacancies', 'ghost', 'search']],
  about: [['/careers/', 'Browse vacancies', 'primary', 'search'], ['/contact/', 'Contact us', 'ghost', 'mail']],
};

const TILE_INFO = {
  '/careers/': ['search', 'Vacancies by location, category and work style'],
  '/apply/': ['briefcase', 'How to apply the right way'],
  '/contact/': ['chat', 'Talk to the SA Recruiters team'],
  '/register/': ['users', 'Free for candidates and employers'],
  '/candidates/': ['users', 'Resources and the Talent Pool'],
  '/post-a-job/': ['tag', 'Free to list, reviewed by an admin'],
};

function tileIconFor(href) {
  if (TILE_INFO[href]) return TILE_INFO[href][0];
  if (href.startsWith('/jobs/')) return 'pin';
  if (href.startsWith('/browse/category/')) return 'tag';
  return 'arrow';
}

// Only link to hubs that were actually generated (thin hubs are skipped).
function landingLinkIsLive(href) {
  if (href.startsWith('/jobs/')) return CTX.provinces.has(href.split('/')[2]);
  if (href.startsWith('/browse/category/')) return CTX.categories.has(href.split('/')[3]);
  return true;
}

function buildSeoLandingPage(page) {
  const canonical = `${SITE_URL}/${page.slug}/`;
  const contactHtml = page.contact ? `${secHead('Contact details')}<div class="tiles tiles-3">${[
    ['tel:+27715531005', '071 553 1005', 'phone', 'Call us'],
    ['mailto:sarecruiters.directory@gmail.com', 'Email SA Recruiters', 'mail', 'sarecruiters.directory@gmail.com'],
    ['https://wa.me/27715531005', 'Message us on WhatsApp', 'chat', 'Fast replies'],
  ].map(([h, l, i, s]) => tileHtml(h, l, i, s)).join('')}</div>` : '';
  const live = page.links.filter(([href]) => landingLinkIsLive(href));
  const linksHtml = live.map(([href, label]) => tileHtml(href, label, tileIconFor(href), (TILE_INFO[href] || [])[1] || '')).join('');
  const aboutHtml = page.about ? `
    <section class="about-section">
      <h2>A better way to start your job search</h2>
      <p>Finding the right opportunity can take time. Finding the right person can take even longer. SA Recruiters makes that first step simpler by giving candidates, agencies and employers a shared place to discover what is available across South Africa.</p>
      <p>Whether you are searching for your next role, building a team or looking for a recruitment partner, the directory helps you move from scattered searches to a clearer shortlist.</p>
    </section>
    <section class="about-section">
      <h2>For employers and hiring teams</h2>
      <p>Reach people with experience across administration, finance, technology, sales, marketing, operations, retail, logistics, skilled trades and other fields. Use SA Recruiters to make your opportunity easier to find, then review applications through the contact or application instructions attached to each vacancy.</p>
      <p>Our aim is to reduce the time spent searching in disconnected places. We help you put the opportunity in front of a broader South African audience while keeping the hiring decision in your hands.</p>
    </section>
    <section class="about-section">
      <h2>For candidates</h2>
      <p>Explore current vacancies by category, location and work style. Each listing should be read carefully because the relevant agency or employer sets the requirements, application process and closing date. When a role interests you, follow the application link or contact details shown on the vacancy page.</p>
      <p>You can also use the Candidate Talent Pool to make your skills easier for participating recruiters and employers to discover.</p>
    </section>
    <section class="about-section">
      <h2>Quality, clarity and responsible browsing</h2>
      <p>SA Recruiters is a directory and connection platform. We organise publicly available recruitment information and submissions reviewed for publication; we do not promise employment, guarantee an interview or replace the agency or employer responsible for a vacancy.</p>
      <p>Always confirm the company, role, location and application instructions before sharing personal information. Never pay a recruiter to apply for a job, and contact us if a listing appears inaccurate or suspicious.</p>
    </section>` : '';

  // Careers / Candidates / Apply: surface real inventory so every visitor has
  // something to click straight away.
  const showBrowse = ['careers', 'candidates', 'apply'].includes(page.slug);
  const browseHtml = showBrowse
    ? `${provinceChips() ? `${secHead('Browse by province')}${provinceChips()}` : ''}${categoryChips() ? `${secHead('Browse by type')}${categoryChips()}` : ''}`
    : '';
  const latestHtml = showBrowse && CTX.latest.length
    ? `${secHead('Latest vacancies', { href: '/?section=vacancies', linkLabel: 'Browse all' })}<div class="grid">${CTX.latest.slice(0, 6).map((r) => vacancyCard(r.vacancy, r.slug)).join('')}</div>`
    : '';

  const body = `${aboutHtml}${contactHtml}${browseHtml}${latestHtml}${secHead('Explore SA Recruiters')}<div class="tiles">${linksHtml}</div>${secHead('Jump into the app')}${appTiles()}<p class="hub-note"><a href="/">Return to the SA Recruiters homepage →</a></p>`;
  const jsonLd = { '@context': 'https://schema.org', '@type': page.about ? 'AboutPage' : 'WebPage', name: page.title, description: page.description, url: canonical, isPartOf: { '@type': 'WebSite', name: 'SA Recruiters', url: `${SITE_URL}/` }, ...(page.about ? { about: { '@type': 'Organization', name: 'SA Recruiters', url: `${SITE_URL}/` } } : {}) };

  const hero = heroHtml({
    kicker: `${icon('briefcase', 14)} SA Recruiters`,
    title: escapeHtml(page.heading),
    lead: escapeHtml(page.intro),
    crumbs: [['Home', '/'], [page.heading, '']],
    actions: (LANDING_CTAS[page.slug] || []).map(([h, l, k, i]) => btn(l, h, k, i)).join(''),
  });
  return pageShell({ title: page.title, description: page.description, canonical, bodyHtml: body, jsonLd, hero, active: page.slug });
}

// ---------- main ----------

async function main() {
  console.log('Fetching data from Supabase...');
  const { agencies, branches, vacancies } = await fetchAll();
  console.log(`Fetched ${agencies.length} agencies, ${branches.length} branches, ${vacancies.length} vacancies.`);

  // ---- Link targets, computed ONCE up front so every page can link to every
  // other page (and only to pages that will really exist). ----
  const agencySlugById = buildPublicSlugMap(agencies, (a) => a.name);
  const vacancySlugById = buildPublicSlugMap(vacancies, (v) => v.title);
  agencies.forEach((agency, index) => {
    CTX.agencyById.set(String(agency.id), { slug: agencySlugById.get(recordMapKey(agency, index)), name: agency.name });
  });
  CTX.vacancySlugs = vacancySlugById;

  // Dry-run the hubs to learn which ones are non-empty. Thin/empty hubs are
  // not published, so nothing may link to them.
  LOCATION_HUBS.forEach(({ name, slug }) => {
    if (buildLocationHubPage({ locationName: name, slug, vacancies, agencies, branches })) CTX.provinces.add(slug);
  });
  CATEGORIES.forEach((category) => {
    if (buildCategoryHubPage({ category, vacancies, vacancySlugById })) CTX.categories.add(category.slug);
  });

  const slugForVacancy = (v) => vacancySlugById.get(v.__staticSlugKey) || slugify(v.title);
  CTX.latest = vacancies.filter(isOpenVacancy).sort(newestFirst).slice(0, 12)
    .map((vacancy) => ({ vacancy, slug: slugForVacancy(vacancy) }));

  // Indexes for "more vacancies" strips and agency pages.
  const byAgency = new Map();
  const byProvince = new Map();
  [...vacancies].sort(newestFirst).forEach((v) => {
    if (v.agency_id !== undefined && v.agency_id !== null) {
      const key = String(v.agency_id);
      if (!byAgency.has(key)) byAgency.set(key, []);
      byAgency.get(key).push(v);
    }
    const prov = provinceFor(v.location);
    if (prov) {
      if (!byProvince.has(prov)) byProvince.set(prov, []);
      byProvince.get(prov).push(v);
    }
  });
  const relatedFor = (vacancy) => {
    const out = [];
    const seen = new Set([vacancy.__staticSlugKey]);
    const add = (list) => {
      for (const v of list || []) {
        if (out.length >= 4) return;
        if (seen.has(v.__staticSlugKey)) continue;
        seen.add(v.__staticSlugKey);
        out.push({ vacancy: v, slug: slugForVacancy(v) });
      }
    };
    if (vacancy.agency_id !== undefined && vacancy.agency_id !== null) add(byAgency.get(String(vacancy.agency_id)));
    add(byProvince.get(provinceFor(vacancy.location)));
    return out;
  };
  const agencyRecordById = new Map(agencies.map((a) => [String(a.id), a]));

  const sitemapUrls = [`${SITE_URL}/`, `${SITE_URL}/privacy/`, `${SITE_URL}/faq/`, `${SITE_URL}/know-your-rights/`];

  // Permanent navigation pages are written on every build, independent of
  // vacancy inventory, so their URLs stay indexable and stable.
  SEO_LANDING_PAGES.forEach((page) => {
    const dir = path.join(OUT_DIR, page.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), buildSeoLandingPage(page));
    sitemapUrls.push(`${SITE_URL}/${page.slug}/`);
  });

  // Location hubs: one per province.
  const jobsDir = path.join(OUT_DIR, 'jobs');
  ensureDir(jobsDir);
  LOCATION_HUBS.forEach(({ name, slug }) => {
    const html = buildLocationHubPage({
      locationName: name,
      slug,
      vacancies,
      agencies,
      branches,
    });
    // No useful inventory means no page and no sitemap entry.
    if (!html) return;
    const dir = path.join(jobsDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/jobs/${slug}/`);
  });

  // Category hubs.
  const categoryDir = path.join(OUT_DIR, 'browse', 'category');
  ensureDir(categoryDir);
  CATEGORIES.forEach((category) => {
    const html = buildCategoryHubPage({ category, vacancies, vacancySlugById });
    // No useful inventory means no page and no sitemap entry.
    if (!html) return;
    const dir = path.join(categoryDir, category.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/browse/category/${category.slug}/`);
  });

  // "Post a job" — always-open, crawlable public lead-capture page (see
  // buildPostAJobPage()). No inventory dependency, so it's always written.
  const postAJobDir = path.join(OUT_DIR, 'post-a-job');
  ensureDir(postAJobDir);
  fs.writeFileSync(path.join(postAJobDir, 'index.html'), buildPostAJobPage());
  sitemapUrls.push(`${SITE_URL}/post-a-job/`);

  // Agency + vacancy pages: one static, crawlable page per record, written
  // to /agency/{slug}/index.html and /vacancy/{slug}/index.html. app.js's
  // "View public listing page ↗" links (publicAgencySlug / publicVacancySlug)
  // point at exactly these paths using the same slugify() + collision-suffix
  // logic as buildPublicSlugMap, so the two stay in sync.
  const agencyDir = path.join(OUT_DIR, 'agency');
  ensureDir(agencyDir);
  agencies.forEach((agency, index) => {
    const slug = agencySlugById.get(recordMapKey(agency, index));
    const agencyBranches = branches.filter((b) => String(b.agency_id) === String(agency.id));
    const agencyVacancies = byAgency.get(String(agency.id)) || [];
    const html = buildAgencyPage(agency, agencyBranches, agencyVacancies, slug, vacancySlugById);
    const dir = path.join(agencyDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/agency/${slug}/`);
  });

  const vacancyDir = path.join(OUT_DIR, 'vacancy');
  ensureDir(vacancyDir);
  vacancies.forEach((vacancy, index) => {
    const slug = vacancySlugById.get(recordMapKey(vacancy, index));
    const agency = agencyRecordById.get(String(vacancy.agency_id));
    const extras = {
      agencySlug: agency ? (CTX.agencyById.get(String(agency.id)) || {}).slug : '',
      related: relatedFor(vacancy),
    };
    const html = buildVacancyPage(vacancy, agency, slug, extras);
    const dir = path.join(vacancyDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    const lastmodSource = vacancy.updated_at || vacancy.created_at;
    const lastmod = lastmodSource ? new Date(lastmodSource).toISOString().slice(0, 10) : '';
    sitemapUrls.push({ loc: `${SITE_URL}/vacancy/${slug}/`, lastmod });
  });

  // Poster pages: one shareable page per active poster. A failed/missing
  // poster table must never fail the whole build.
  let posters = [];
  try {
    const { data, error } = await supabase.from('employer_posters')
      .select('id,image_url,caption,expires_at')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) console.warn('poster fetch error (skipping poster pages):', JSON.stringify(error));
    else posters = data || [];
  } catch (e) { console.warn('poster fetch failed (skipping poster pages):', e.message); }
  const posterDir = path.join(OUT_DIR, 'poster');
  ensureDir(posterDir);
  posters.filter((p) => p.image_url).forEach((poster) => {
    const slug = posterSlug(poster);
    const dir = path.join(posterDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), buildPosterPage(poster, slug));
    sitemapUrls.push(`${SITE_URL}/poster/${slug}/`);
  });

  // Sitemap
  const sitemapEntries = sitemapUrls.map((entry) => {
    if (typeof entry === 'string') return `  <url><loc>${entry}</loc></url>`;
    const loc = entry.loc;
    const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : '';
    return `  <url><loc>${loc}</loc>${lastmod}</url>`;
  }).join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</urlset>`;
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemap);

  // NOTE: static-pages.css is now a committed source file (the design system
  // for every generated page). It is intentionally NOT rewritten here any more,
  // and it is part of STATIC_ASSETS so editing it busts caches on next deploy.

  console.log(`Done. Wrote ${agencies.length} agency page(s), ${vacancies.length} vacancy page(s), ${CTX.provinces.size} province hub(s), ${CTX.categories.size} category hub(s) (thin/empty ones skipped), the /post-a-job/ page, and sitemap.xml.`);
}

main().catch((err) => {
  console.error('generate-pages.js failed:', err);
  process.exit(1);
});

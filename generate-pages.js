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
const { runBundle } = require('./scripts/bundle-app');

// Bundle + minify the 8 app-*.js files into app.bundle.min.js and
// rewrite index.html's script tag, before anything else runs. Doing
// this first (and via require, not npm run) means the existing
// Cloudflare Pages build command — "npm install && node
// generate-pages.js" — doesn't need to change to pick this up.
runBundle(__dirname);

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
// 2) Append ?v=<same hash> to every unversioned same-origin asset
//    (styles.css, content.js, content-manager.js, static-pages.css)
//    so stale-while-revalidate style caches treat each deploy as a new
//    resource and can never answer with a stale copy.
// ------------------------------------------------------------
const STATIC_ASSETS = [
  'index.html',
  'admin.html',
  'privacy.html',
  'offline.html',
  'styles.css',
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
  // Only same-origin assets that have NO ?v= already get the hash.
  // The bundle script tag is already rewritten by bundle-app.js.
  // Handles relative (styles.css), ./relative (./styles.css) and
  // root-absolute (/static-pages.css) references.
  return html.replace(
    /((?:src|href)=")((?:\.\/|\/)?)(styles\.css|content\.js|content-manager\.js|static-pages\.css)(\?|")/g,
    (match, attr, base, file, suffix) =>
      suffix === '?' ? match : `${attr}${base}${file}?v=${version}${suffix}`,
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

function pageShell({ title, description, canonical, bodyHtml, jsonLd, image }) {
  const ogImage = image || `${SITE_URL}/icons/v2-icon-512.png`;
  return `<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
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
<body>
<header class="sp-header"><a href="/"><img src="/icons/v2-icon-192.png" alt="SA Recruiters logo" width="36" height="36"> <span>Back to SA Recruiters</span></a></header>
<nav class="sp-nav" aria-label="SA Recruiters pages">
<a href="/careers/">Careers</a><a href="/apply/">Apply for a vacancy</a><a href="/contact/">Contact Us</a><a href="/register/">Register</a><a href="/candidates/">Candidates</a><a href="/about/">About SA Recruiters</a>
</nav>
<main class="sp-main">
${bodyHtml}
</main>
<footer class="sp-footer">
<a href="/">SA Recruiters — South African Recruitment Agencies Directory</a>
<div class="sp-footer-links"><a href="/careers/">Careers</a><a href="/apply/">Apply</a><a href="/contact/">Contact</a><a href="/register/">Register</a><a href="/candidates/">Candidates</a><a href="/about/">About</a></div>
<div class="sp-contact"><a href="tel:+27715531005">071 553 1005</a><span aria-hidden="true"> · </span><a href="https://g.page/r/CbL3q0tBfGAsEBI" target="_blank" rel="noopener noreferrer">Find us on Google</a></div>
</footer>
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
    vacancies: 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type',
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

  const branchesHtml = agencyBranches.length
    ? `<h2>Branches</h2><ul>${agencyBranches
        .map(
          (b) =>
            `<li><strong>${escapeHtml(b.name)}</strong>${b.location ? ` — ${escapeHtml(b.location)}` : ''}${
              b.phone ? ` — ${escapeHtml(b.phone)}` : ''
            }${b.email ? ` — ${escapeHtml(b.email)}` : ''}</li>`
        )
        .join('')}</ul>`
    : '';

  const vacanciesHtml = agencyVacancies.length
    ? `<h2>Current Vacancies</h2><ul>${agencyVacancies
        .map((v) => {
          const vSlug = vacancySlugById.get(v.__staticSlugKey) || slugify(v.title);
          return `<li><a href="/vacancy/${vSlug}/">${escapeHtml(v.title)}</a>${
            v.location ? ` — ${escapeHtml(v.location)}` : ''
          }</li>`;
        })
        .join('')}</ul>`
    : '';

  const body = `
<h1>${escapeHtml(agency.name)}</h1>
${agency.verified ? '<p><em>✔ Verified agency</em></p>' : ''}
<p>${agency.location ? `<strong>Location:</strong> ${escapeHtml(agency.location)}<br>` : ''}
${agency.address ? `<strong>Address:</strong> ${escapeHtml(agency.address)}<br>` : ''}
${agency.contact ? `<strong>Contact:</strong> ${escapeHtml(agency.contact)}<br>` : ''}
${agency.email ? `<strong>Email:</strong> ${escapeHtml(agency.email)}<br>` : ''}
 ${safeHttpUrl(agency.website) ? `<strong>Website:</strong> <a href="${escapeHtml(safeHttpUrl(agency.website))}" rel="nofollow">${escapeHtml(agency.website)}</a><br>` : ''}
${agency.trades ? `<strong>Trades / Industries:</strong> ${escapeHtml(agency.trades)}<br>` : ''}
${agency.companies ? `<strong>Companies:</strong> ${escapeHtml(agency.companies)}<br>` : ''}</p>
${branchesHtml}
${vacanciesHtml}
`;

  return pageShell({ title, description, canonical, bodyHtml: body });
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

function buildVacancyPage(vacancy, agency, slug) {
  const canonical = `${SITE_URL}/vacancy/${slug}/`;
  const companyName = vacancy.company || (agency && agency.name) || 'A South African employer';
  const title = `${vacancy.title} — ${companyName} | SA Recruiters`;
  const description = `${vacancy.title} vacancy at ${companyName}${
    vacancy.location ? ` in ${vacancy.location}` : ''
  }. ${vacancy.employment_type || ''} ${vacancy.contract_type || ''}`.trim();

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: vacancy.title,
    description: vacancy.notes || description,
    datePosted: vacancy.created_at,
    validThrough: resolveValidThrough(vacancy),
    url: canonical,
    employmentType: vacancy.employment_type || undefined,
    hiringOrganization: {
      '@type': 'Organization',
      name: companyName,
    },
    ...buildJobLocationFields(vacancy),
    baseSalary: buildBaseSalary(vacancy),
  };

  const body = `
<h1>${escapeHtml(vacancy.title)}</h1>
<p><strong>Company:</strong> ${escapeHtml(companyName)}<br>
${vacancy.location ? `<strong>Location:</strong> ${escapeHtml(vacancy.location)}<br>` : ''}
${vacancy.employment_type ? `<strong>Employment type:</strong> ${escapeHtml(vacancy.employment_type)}<br>` : ''}
${vacancy.contract_type ? `<strong>Contract type:</strong> ${escapeHtml(vacancy.contract_type)}<br>` : ''}
${vacancy.salary ? `<strong>Salary:</strong> ${escapeHtml(vacancy.salary)}<br>` : ''}
${vacancy.hours ? `<strong>Hours:</strong> ${escapeHtml(vacancy.hours)}<br>` : ''}
${vacancy.work_schedule ? `<strong>Schedule:</strong> ${escapeHtml(vacancy.work_schedule)}<br>` : ''}
${vacancy.remote ? `<strong>Work style:</strong> ${escapeHtml(vacancy.remote)}<br>` : ''}
${vacancy.experience_level ? `<strong>Experience level:</strong> ${escapeHtml(vacancy.experience_level)}<br>` : ''}
${vacancy.closing_date ? `<strong>Closing date:</strong> ${escapeHtml(vacancy.closing_date)}<br>` : ''}</p>
${vacancy.notes ? `<h2>Details</h2><p>${escapeHtml(vacancy.notes).replace(/\n/g, '<br>')}</p>` : ''}
${
  safeHttpUrl(vacancy.link)
    ? `<p><a class="sp-apply" href="${escapeHtml(safeHttpUrl(vacancy.link))}" rel="nofollow">Apply for this role →</a></p>`
    : '<p>To apply, visit the SA Recruiters app and use the contact details on the agency listing.</p>'
}
`;

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd });
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
<h1>${escapeHtml(heading)}</h1>
${imageUrl ? `<p><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(heading)}" style="max-width:100%;height:auto;border-radius:12px"></p>` : '<p>The poster image is unavailable.</p>'}
<p class="hub-note"><a href="/">Browse all agencies and vacancies on SA Recruiters →</a></p>
`;
  return pageShell({ title, description, canonical, bodyHtml: body, image: imageUrl || undefined });
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
    .filter((vacancy) => locationContains(vacancy.location, locationName));

  const matchingAgencyIds = new Set(
    agencies
      .filter((agency) => locationContains(agency.location, locationName))
      .map((agency) => String(agency.id))
  );

  branches
    .filter((branch) => locationContains(branch.location, locationName))
    .forEach((branch) => matchingAgencyIds.add(String(branch.agency_id)));

  const matchingAgencies = agencies.filter((agency) => matchingAgencyIds.has(String(agency.id)));

  // Do not publish a thin, empty hub. The caller should also omit this URL
  // from the sitemap when the function returns null.
  if (currentVacancies.length === 0 && matchingAgencies.length === 0) return null;

  const canonical = `${SITE_URL}/jobs/${slug}/`;
  const title = `${locationName} Jobs & Vacancies — SA Recruiters`;
  const description = `Find current job vacancies and recruitment agencies in ${locationName}, South Africa. Browse roles by employer, agency and job type on SA Recruiters.`;

  const vacancyList = currentVacancies.length
    ? `<h2>Current ${escapeHtml(locationName)} vacancies</h2>
       <ul class="hub-list">${currentVacancies.slice(0, 50).map((vacancy) => {
         return `<li><strong>${escapeHtml(vacancy.title || 'Untitled vacancy')}</strong>${vacancy.company ? ` — ${escapeHtml(vacancy.company)}` : ''}${vacancy.location ? ` <span class="muted">(${escapeHtml(vacancy.location)})</span>` : ''}</li>`;
       }).join('')}</ul>`
    : `<p>No current ${escapeHtml(locationName)} vacancies are available in the directory at this time. Check back soon or browse the agencies below.</p>`;

  const agencyList = matchingAgencies.length
    ? `<h2>Recruitment agencies in ${escapeHtml(locationName)}</h2>
       <ul class="hub-list">${matchingAgencies.slice(0, 50).map((agency) => {
         return `<li><strong>${escapeHtml(agency.name || 'Recruitment agency')}</strong>${agency.trades ? ` — ${escapeHtml(agency.trades)}` : ''}${agency.location ? ` <span class="muted">(${escapeHtml(agency.location)})</span>` : ''}</li>`;
       }).join('')}</ul>`
    : '';

  const itemList = currentVacancies.slice(0, 50).map((vacancy, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: vacancy.title || 'Vacancy',
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
<h1>${escapeHtml(locationName)} jobs and vacancies</h1>
<p>Explore current job opportunities and recruitment agencies serving ${escapeHtml(locationName)}, South Africa. Select a vacancy for the full job description and application details.</p>
${vacancyList}
${agencyList}
<p class="hub-note"><a href="/">Return to the SA Recruiters directory</a> to browse all agencies and vacancies.</p>
`;

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd });
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

function buildCategoryHubPage({ category, vacancies }) {
  const currentVacancies = vacancies
    .filter((vacancy) => isOpenVacancy(vacancy))
    .filter((vacancy) => vacancyMatchesCategory(vacancy, category));

  // Do not publish a thin, empty hub. The caller should also omit this URL
  // from the sitemap when the function returns null.
  if (currentVacancies.length === 0) return null;

  const canonical = `${SITE_URL}/browse/category/${category.slug}/`;
  const title = `${category.label} in South Africa — SA Recruiters`;
  const description = `Browse current ${category.label.toLowerCase()} in South Africa. Updated listings from recruitment agencies and employers on SA Recruiters.`;

  const vacancyList = `<h2>Current ${escapeHtml(category.label)}</h2>
    <ul class="hub-list">${currentVacancies.slice(0, 50).map((vacancy) => {
      return `<li><strong>${escapeHtml(vacancy.title || 'Untitled vacancy')}</strong>${vacancy.company ? ` — ${escapeHtml(vacancy.company)}` : ''}${vacancy.location ? ` <span class="muted">(${escapeHtml(vacancy.location)})</span>` : ''}</li>`;
    }).join('')}</ul>`;

  const itemList = currentVacancies.slice(0, 50).map((vacancy, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: vacancy.title || 'Vacancy',
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
<h1>${escapeHtml(category.label)} in South Africa</h1>
<p>${escapeHtml(category.intro)}</p>
${vacancyList}
<p class="hub-note"><a href="/">Return to the SA Recruiters directory</a> to browse all agencies, employers and vacancies.</p>
`;

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd });
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

  const body = `
<h1>Post a job</h1>
<p>Tell us about the roles you're hiring for. An admin will review your request before anything is published &mdash; SA Recruiters never charges employers to list vacancies.</p>
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

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd });
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
  { slug: 'about', title: 'About SA Recruiters | South African Recruitment Directory', description: 'Learn about SA Recruiters, a free directory connecting South African candidates, recruitment agencies and employers.', heading: 'About SA Recruiters', intro: 'SA Recruiters connects South African job seekers, recruitment agencies and employers through a free recruitment directory and vacancy platform.', links: [['/careers/', 'Browse vacancies'], ['/candidates/', 'Candidate resources'], ['/post-a-job/', 'Post a job'], ['/contact/', 'Contact Us']] },
];

function buildSeoLandingPage(page) {
  const canonical = `${SITE_URL}/${page.slug}/`;
  const contactHtml = page.contact ? '<h2>Contact details</h2><p><strong>Phone:</strong> <a href="tel:+27715531005">071 553 1005</a><br><strong>Email:</strong> <a href="mailto:sarecruiters.directory@gmail.com">sarecruiters.directory@gmail.com</a><br><strong>WhatsApp:</strong> <a href="https://wa.me/27715531005">Message SA Recruiters on WhatsApp</a></p>' : '';
  const linksHtml = page.links.map(([href, label]) => `<li><a href="${href}">${escapeHtml(label)}</a></li>`).join('');
  const body = `<h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.intro)}</p>${contactHtml}<h2>Explore SA Recruiters</h2><ul class="hub-list">${linksHtml}</ul><p class="hub-note"><a href="/">Return to the SA Recruiters homepage →</a></p>`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.description, url: canonical, isPartOf: { '@type': 'WebSite', name: 'SA Recruiters', url: `${SITE_URL}/` } };
  return pageShell({ title: page.title, description: page.description, canonical, bodyHtml: body, jsonLd });
}

// ---------- main ----------

async function main() {
  console.log('Fetching data from Supabase...');
  const { agencies, branches, vacancies } = await fetchAll();
  console.log(`Fetched ${agencies.length} agencies, ${branches.length} branches, ${vacancies.length} vacancies.`);

  const sitemapUrls = [`${SITE_URL}/`];

  // Permanent navigation pages are written on every build, independent of
  // vacancy inventory, so their URLs stay indexable and stable.
  SEO_LANDING_PAGES.forEach((page) => {
    const dir = path.join(OUT_DIR, page.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), buildSeoLandingPage(page));
    sitemapUrls.push(`${SITE_URL}/${page.slug}/`);
  });

  // Location hubs: one per province (matches firstjobly.co.za/browse/province/*
  // coverage — previously only Gauteng was generated here).
  const locationHubs = [
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
  const jobsDir = path.join(OUT_DIR, 'jobs');
  ensureDir(jobsDir);
  locationHubs.forEach(({ name, slug }) => {
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

  // Category hubs (matches firstjobly.co.za's "Browse by type": Government
  // Vacancies, Learnerships, Internships, Graduate Programmes, Bursaries,
  // Apprenticeships, Part-time, Remote, Permanent, Contract roles).
  const categories = [
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
  const categoryDir = path.join(OUT_DIR, 'browse', 'category');
  ensureDir(categoryDir);
  categories.forEach((category) => {
    const html = buildCategoryHubPage({ category, vacancies });
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
  // logic as buildPublicSlugMap below, so the two stay in sync.
  const agencySlugById = buildPublicSlugMap(agencies, (a) => a.name);
  const vacancySlugById = buildPublicSlugMap(vacancies, (v) => v.title);

  const agencyDir = path.join(OUT_DIR, 'agency');
  ensureDir(agencyDir);
  agencies.forEach((agency) => {
    const slug = agencySlugById.get(recordMapKey(agency, agencies.indexOf(agency)));
    const agencyBranches = branches.filter((b) => String(b.agency_id) === String(agency.id));
    const agencyVacancies = vacancies.filter((v) => String(v.agency_id) === String(agency.id));
    const html = buildAgencyPage(agency, agencyBranches, agencyVacancies, slug, vacancySlugById);
    const dir = path.join(agencyDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/agency/${slug}/`);
  });

  const vacancyDir = path.join(OUT_DIR, 'vacancy');
  ensureDir(vacancyDir);
  vacancies.forEach((vacancy) => {
    const slug = vacancySlugById.get(recordMapKey(vacancy, vacancies.indexOf(vacancy)));
    const agency = agencies.find((a) => String(a.id) === String(vacancy.agency_id));
    const html = buildVacancyPage(vacancy, agency, slug);
    const dir = path.join(vacancyDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/vacancy/${slug}/`);
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
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemap);

  // Minimal stylesheet for the static pages (kept separate from the app's own styling)
  const css = `body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px;line-height:1.6;color:#111}
.sp-header,.sp-footer{padding:12px 0}
.sp-header a,.sp-footer a{color:#0a66c2;text-decoration:none;display:inline-flex;align-items:center;gap:8px}
.sp-nav,.sp-footer-links{display:flex;flex-wrap:wrap;gap:8px 14px;margin:12px 0 18px;font-size:.9rem}
.sp-nav a,.sp-footer-links a{color:#0a66c2;text-decoration:none}
.sp-nav a:hover,.sp-footer-links a:hover{text-decoration:underline}
.sp-contact{margin-top:6px;font-size:.95rem}
.sp-header img{border-radius:9px;display:block}
h1{font-size:1.6rem;margin-bottom:.5rem}
h2{font-size:1.2rem;margin-top:1.5rem}
.hub-list{padding-left:1.25rem}
.hub-list li{margin:.55rem 0}
.muted{color:#667085}
.hub-note{border-top:1px solid #e5e7eb;margin-top:2rem;padding-top:1rem}
.pj-form{display:flex;flex-direction:column;gap:16px;margin-top:1.5rem}
.pj-form label{display:flex;flex-direction:column;gap:6px;font-size:.85rem;font-weight:700;color:#111}
.pj-optional{font-size:.7rem;font-weight:500;color:#0a66c2;text-transform:none}
.pj-form input,.pj-form select,.pj-form textarea{font:inherit;font-weight:400;min-height:48px;border:1px solid #d0d5dd;border-radius:12px;padding:11px 13px;background:#fff;color:#111}
.pj-form textarea{min-height:84px;resize:vertical}
.pj-roles{border:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
.pj-roles legend{font-size:.85rem;font-weight:700;padding:0;margin-bottom:4px}
.pj-role-check{flex-direction:row!important;align-items:center;gap:8px!important;font-weight:500!important}
.pj-role-check input{min-height:auto;width:16px;height:16px}
.pj-form button{min-height:50px;background:#0a66c2;color:#fff;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer}
.pj-form button:disabled{opacity:.6;cursor:wait}
#pj-status{font-size:.85rem;color:#0a66c2;min-height:1.2em}`;
  fs.writeFileSync(path.join(OUT_DIR, 'static-pages.css'), css);

  console.log(`Done. Wrote ${agencies.length} agency page(s), ${vacancies.length} vacancy page(s), ${locationHubs.length} province hub(s), ${categories.length} category hub(s) (thin/empty ones skipped), the /post-a-job/ page, and sitemap.xml.`);
}

main().catch((err) => {
  console.error('generate-pages.js failed:', err);
  process.exit(1);
});

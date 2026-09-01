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
const fs = require('fs');
const path = require('path');

// Same public values already used in index.html — safe to reuse,
// this is the anon/public key, not a secret.
const SUPABASE_URL = 'https://ythznnktswgymerdcxky.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PU5_htQ0UZQoMrD6aY3rVQ_tzE3ztjH';

const SITE_URL = 'https://sa-recruiters.co.za';
const OUT_DIR = path.join(__dirname); // publish root — adjust if you move this script

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function pageShell({ title, description, canonical, bodyHtml, jsonLd }) {
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
<meta property="og:image" content="${SITE_URL}/icons/v2-icon-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<meta name="twitter:image" content="${SITE_URL}/icons/v2-icon-512.png">
<link rel="icon" href="/favicon-v2.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/v2-favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/v2-icon-192.png">
<link rel="apple-touch-icon" href="/icons/v2-icon-192.png">
<link rel="stylesheet" href="/static-pages.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<header class="sp-header"><a href="/"><img src="/icons/v2-icon-192.png" alt="SA Recruiters logo" width="36" height="36"> <span>Back to SA Recruiters</span></a></header>
<main class="sp-main">
${bodyHtml}
</main>
<footer class="sp-footer">
<a href="/">SA Recruiters — South African Recruitment Agencies Directory</a>
<div class="sp-contact"><a href="tel:+27715531005">071 553 1005</a><span aria-hidden="true"> · </span><a href="https://g.page/r/CbL3q0tBfGAsEBI" target="_blank" rel="noopener noreferrer">Find us on Google</a></div>
</footer>
</body>
</html>`;
}

// ---------- fetch data ----------

async function fetchAll() {
  const [{ data: agencies, error: aErr }, { data: branches, error: bErr }, { data: vacancies, error: vErr }] =
    await Promise.all([
      supabase.from('agencies').select('*'),
      supabase.from('branches').select('*'),
      supabase.from('vacancies').select('*'),
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
    vacancies: vacancies || [],
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
${agency.website ? `<strong>Website:</strong> <a href="${escapeHtml(agency.website)}" rel="nofollow">${escapeHtml(agency.website)}</a><br>` : ''}
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
    return { jobLocationType: 'TELECOMMUTE' };
  }

  return {
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: vacancy.location || undefined,
        addressRegion: inferAddressRegion(vacancy.location),
        addressCountry: 'ZA',
      },
    },
  };
}

// validThrough is only "recommended", not required, but leaving it out
// makes Google treat the posting as having no defined expiry, and many
// of our listings (sourced from job boards that don't expose a real
// closing date) had this dropped entirely. Where we have a genuine
// closing_date we use it; otherwise we fall back to 60 days after the
// post date, which is a conservative, commonly-used default for job
// boards and keeps the listing from looking permanently open.
function resolveValidThrough(vacancy) {
  if (vacancy.closing_date) return vacancy.closing_date;
  if (!vacancy.created_at) return undefined;
  const posted = new Date(vacancy.created_at);
  if (Number.isNaN(posted.getTime())) return undefined;
  const fallback = new Date(posted.getTime() + 60 * 24 * 60 * 60 * 1000);
  return fallback.toISOString().slice(0, 10);
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
  vacancy.link
    ? `<p><a href="${escapeHtml(vacancy.link)}" rel="nofollow">Apply for this role →</a></p>`
    : '<p>To apply, visit the SA Recruiters app and use the contact details on the agency listing.</p>'
}
`;

  return pageShell({ title, description, canonical, bodyHtml: body, jsonLd });
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
  return String(value || '').toLowerCase().includes(locationName.toLowerCase());
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

// ---------- main ----------

async function main() {
  console.log('Fetching data from Supabase...');
  const { agencies, branches, vacancies } = await fetchAll();
  console.log(`Fetched ${agencies.length} agencies, ${branches.length} branches, ${vacancies.length} vacancies.`);

  const sitemapUrls = [`${SITE_URL}/`];

  // Location hubs: generate only curated, useful landing pages.
  const locationHubs = [
    { name: 'Gauteng', slug: 'gauteng' },
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
.sp-contact{margin-top:6px;font-size:.95rem}
.sp-header img{border-radius:9px;display:block}
h1{font-size:1.6rem;margin-bottom:.5rem}
h2{font-size:1.2rem;margin-top:1.5rem}
.hub-list{padding-left:1.25rem}
.hub-list li{margin:.55rem 0}
.muted{color:#667085}
.hub-note{border-top:1px solid #e5e7eb;margin-top:2rem;padding-top:1rem}`;
  fs.writeFileSync(path.join(OUT_DIR, 'static-pages.css'), css);

  console.log(`Done. Wrote ${agencies.length} agency page(s), ${vacancies.length} vacancy page(s), ${locationHubs.length} configured location hub(s) when non-empty, and sitemap.xml.`);
}

main().catch((err) => {
  console.error('generate-pages.js failed:', err);
  process.exit(1);
});

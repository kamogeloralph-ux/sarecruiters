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

function buildPublicSlugMap(records, getName) {
  const counts = new Map();
  records.forEach((record) => {
    const base = slugify(getName(record));
    counts.set(base, (counts.get(base) || 0) + 1);
  });

  const result = new Map();
  records.forEach((record) => {
    const base = slugify(getName(record));
    const id = String(record.id);
    result.set(id, counts.get(base) > 1 ? `${base}-${id.slice(0, 6)}` : base);
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
<footer class="sp-footer"><a href="/">SA Recruiters — South African Recruitment Agencies Directory</a></footer>
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
          const vSlug = vacancySlugById.get(String(v.id)) || slugify(v.title);
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

// ---------- location hub pages (SEO) ----------
//
// WHY THIS EXISTS: "paste a list of keywords on the site" is keyword
// stuffing and Google actively penalises it. What actually works is real
// content structured around the terms people search - a genuine page per
// location, listing genuine current vacancies, that a person would
// actually want to click through to. This also fixes a real bug: every
// vacancy with agency_id 'general' (the majority of listings - sourced
// from Indeed/Pnet/government portals rather than a registered agency)
// had ZERO internal links pointing to its page anywhere on the site. It
// only ever existed in sitemap.xml, which is very likely why Search
// Console was reporting a growing pile of "Discovered - currently not
// indexed" pages: Google found the URL but had no signal it was worth
// crawling. These hub pages are real internal links to every one of
// those pages, grouped by the thing people actually search for.
//
// Known Gauteng towns/areas we recognise inside the free-text `location`
// field on each vacancy. Order matters: more specific names are matched
// before the generic 'Gauteng' fallback catches everything else.
const GAUTENG_LOCATIONS = [
  'Sandton',
  'Randburg',
  'Roodepoort',
  'Midrand',
  'Centurion',
  'Pretoria',
  'Boksburg',
  'Kempton Park',
  'Krugersdorp',
  'Vanderbijlpark',
  'Alberton',
  'Germiston',
  'Benoni',
  'Springs',
  'Edenvale',
  'Johannesburg',
];

// Buckets a vacancy's free-text location into one recognised Gauteng town,
// or 'Gauteng' generically if none match / the listing isn't in Gauteng at
// all (kept in a catch-all rather than silently dropped, so nothing goes
// unlinked).
function resolveLocationBucket(locationText) {
  if (!locationText) return null;
  const match = GAUTENG_LOCATIONS.find((town) =>
    locationText.toLowerCase().includes(town.toLowerCase())
  );
  if (match) return match;
  if (locationText.toLowerCase().includes('gauteng')) return 'Gauteng';
  return null; // not a Gauteng listing at all (e.g. Cape Town, Eastern Cape) - no Gauteng hub page for it
}

function buildLocationHubPage(bucketName, bucketVacancies, agencies, vacancySlugById) {
  const slug = `jobs-in-${slugify(bucketName)}`;
  const canonical = `${SITE_URL}/${slug}/`;
  const count = bucketVacancies.length;
  const title = `${count} Jobs in ${bucketName}, Gauteng — Current Vacancies | SA Recruiters`;
  const description = `Browse ${count} current job vacancies in ${bucketName}, Gauteng. Updated listings from recruitment agencies, employers and public job boards across South Africa.`;

  // Sort newest first so the page itself stays genuinely useful, not just
  // a keyword target - real freshness is also a ranking signal.
  const sorted = [...bucketVacancies].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  const listHtml = sorted
    .map((v) => {
      const vSlug = vacancySlugById.get(String(v.id)) || slugify(v.title);
      const agency = agencies.find((a) => a.id === v.agency_id);
      const companyName = v.company || (agency && agency.name) || '';
      return `<li><a href="/vacancy/${vSlug}/">${escapeHtml(v.title)}</a>${
        companyName ? ` — ${escapeHtml(companyName)}` : ''
      }${v.location ? ` — ${escapeHtml(v.location)}` : ''}${
        v.closing_date ? ` (closes ${escapeHtml(v.closing_date)})` : ''
      }</li>`;
    })
    .join('');

  const body = `
<h1>Jobs in ${escapeHtml(bucketName)}, Gauteng</h1>
<p>${count} current vacanc${count === 1 ? 'y' : 'ies'} in ${escapeHtml(
    bucketName
  )} and the surrounding area, sourced from recruitment agencies, direct employers and public job boards. Updated regularly — check back for the latest ${escapeHtml(
    bucketName
  )} job opportunities.</p>
<h2>Current Vacancies</h2>
<ul>${listHtml}</ul>
<p><a href="/jobs/">Browse jobs in other Gauteng locations →</a> · <a href="/job-categories/">Browse by category →</a></p>
`;

  return { slug, html: pageShell({ title, description, canonical, bodyHtml: body }) };
}

function buildJobsIndexPage(buckets) {
  const canonical = `${SITE_URL}/jobs/`;
  const title = 'Jobs in Gauteng by Location — SA Recruiters';
  const description =
    'Browse current job vacancies across Gauteng by location, including Johannesburg, Pretoria, Centurion, Sandton, Midrand and more.';

  const listHtml = buckets
    .map(
      ({ name, count }) =>
        `<li><a href="/jobs-in-${slugify(name)}/">Jobs in ${escapeHtml(name)}</a> (${count})</li>`
    )
    .join('');

  const body = `
<h1>Jobs in Gauteng by Location</h1>
<p>Browse current vacancies across Gauteng, grouped by town and city.</p>
<ul>${listHtml}</ul>
<p><a href="/job-categories/">Browse jobs by category instead →</a></p>
`;

  return pageShell({ title, description, canonical, bodyHtml: body });
}

// ---------- job category hub pages (SEO) ----------
//
// Same real-content, real-links approach as the location hubs above -
// this time grouping by the type of role rather than where it is, which
// targets a different (and often higher-intent) set of real search terms
// like "retail jobs Gauteng" or "warehouse jobs Gauteng". Matching is done
// by keyword against the vacancy TITLE only (not notes/description), kept
// deliberately conservative: a title has to clearly say what kind of role
// it is before we categorise it. Vacancies that don't clearly match any
// category simply don't get a category page - they're still fully
// reachable via their location hub page, so nothing is orphaned by this
// not being exhaustive.
const JOB_CATEGORIES = [
  {
    name: 'Healthcare & Nursing',
    keywords: ['nurse', 'nursing', 'medical', 'clinical', 'pharmac', 'dental', 'psychiat', 'physiotherap', 'radiograph'],
  },
  {
    name: 'Security',
    keywords: ['security', 'cctv', 'guard'],
  },
  {
    name: 'Warehouse & Logistics',
    keywords: ['warehouse', 'logistics', 'forklift', 'dispatch', 'courier', 'driver', 'stock control', 'inventory'],
  },
  {
    name: 'Finance & Accounting',
    keywords: ['accountant', 'bookkeep', 'finance', 'payroll', 'creditors', 'debtors', 'tax'],
  },
  {
    name: 'Engineering & Technical',
    keywords: ['engineer', 'technician', 'electrician', 'millwright', 'artisan', 'mechanic'],
  },
  {
    name: 'Customer Service & Call Centre',
    keywords: ['call cent', 'customer service', 'customer care', 'customer compl'],
  },
  {
    name: 'Hospitality & Food Service',
    keywords: ['chef', 'waiter', 'hotel', 'hospitality', 'front desk', 'guest relations'],
  },
  {
    name: 'Sales & Business Development',
    keywords: ['sales rep', 'sales exec', 'sales consultant', 'business development', 'account manager'],
  },
  {
    name: 'Admin & Clerical',
    keywords: ['admin', 'clerk', 'receptionist', 'secretary', 'data captur', 'personal assistant'],
  },
  {
    name: 'Retail',
    keywords: ['shop assistant', 'cashier', 'merchandis', 'retail', 'store ', 'stock assistant'],
  },
];

// Order matters: this list is checked top-to-bottom and the FIRST match
// wins, so more specific categories (e.g. "Customer Service" catching
// "Customer Compliance & Service Officer") are listed before broader ones
// that might otherwise catch the same title for the wrong reason.
function resolveJobCategory(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  const match = JOB_CATEGORIES.find((cat) => cat.keywords.some((kw) => lower.includes(kw)));
  return match ? match.name : null;
}

function buildCategoryHubPage(categoryName, categoryVacancies, agencies, vacancySlugById) {
  const slug = `${slugify(categoryName)}-jobs-gauteng`;
  const canonical = `${SITE_URL}/${slug}/`;
  const count = categoryVacancies.length;
  const title = `${count} ${categoryName} Jobs in Gauteng — Current Vacancies | SA Recruiters`;
  const description = `Browse ${count} current ${categoryName.toLowerCase()} job vacancies across Gauteng. Updated listings from recruitment agencies, employers and public job boards.`;

  const sorted = [...categoryVacancies].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  const listHtml = sorted
    .map((v) => {
      const vSlug = vacancySlugById.get(String(v.id)) || slugify(v.title);
      const agency = agencies.find((a) => a.id === v.agency_id);
      const companyName = v.company || (agency && agency.name) || '';
      return `<li><a href="/vacancy/${vSlug}/">${escapeHtml(v.title)}</a>${
        companyName ? ` — ${escapeHtml(companyName)}` : ''
      }${v.location ? ` — ${escapeHtml(v.location)}` : ''}${
        v.closing_date ? ` (closes ${escapeHtml(v.closing_date)})` : ''
      }</li>`;
    })
    .join('');

  const body = `
<h1>${escapeHtml(categoryName)} Jobs in Gauteng</h1>
<p>${count} current ${escapeHtml(categoryName.toLowerCase())} vacanc${
    count === 1 ? 'y' : 'ies'
  } across Gauteng, sourced from recruitment agencies, direct employers and public job boards. Updated regularly.</p>
<h2>Current Vacancies</h2>
<ul>${listHtml}</ul>
<p><a href="/job-categories/">Browse other job categories →</a></p>
`;

  return { slug, html: pageShell({ title, description, canonical, bodyHtml: body }) };
}

function buildJobCategoriesIndexPage(categories) {
  const canonical = `${SITE_URL}/job-categories/`;
  const title = 'Jobs in Gauteng by Category — SA Recruiters';
  const description =
    'Browse current job vacancies across Gauteng by category, including retail, admin, warehouse, sales, engineering, healthcare and more.';

  const listHtml = categories
    .map(
      ({ name, count }) =>
        `<li><a href="/${slugify(name)}-jobs-gauteng/">${escapeHtml(name)} Jobs</a> (${count})</li>`
    )
    .join('');

  const body = `
<h1>Jobs in Gauteng by Category</h1>
<p>Browse current vacancies across Gauteng, grouped by job category.</p>
<ul>${listHtml}</ul>
<p><a href="/jobs/">Browse jobs by location instead →</a></p>
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

// ---------- main ----------

async function main() {
  console.log('Fetching data from Supabase...');
  const { agencies, branches, vacancies } = await fetchAll();
  console.log(`Fetched ${agencies.length} agencies, ${branches.length} branches, ${vacancies.length} vacancies.`);

  const sitemapUrls = [`${SITE_URL}/`];
  const agencySlugById = buildPublicSlugMap(agencies, (a) => a.name);
  const vacancySlugById = buildPublicSlugMap(vacancies, (v) => v.title);

  // Agencies
  const agencyDir = path.join(OUT_DIR, 'agency');
  ensureDir(agencyDir);
  agencies.forEach((agency) => {
    const slug = agencySlugById.get(String(agency.id)) || slugify(agency.name);

    const agencyBranches = branches.filter((b) => b.agency_id === agency.id);
    const agencyVacancies = vacancies.filter((v) => v.agency_id === agency.id);

    const dir = path.join(agencyDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), buildAgencyPage(agency, agencyBranches, agencyVacancies, slug, vacancySlugById));
    sitemapUrls.push(`${SITE_URL}/agency/${slug}/`);

    // stash slug on the agency object so vacancy pages can link back correctly
    agency._slug = slug;
  });

  // Vacancies
  const vacancyDir = path.join(OUT_DIR, 'vacancy');
  ensureDir(vacancyDir);
  vacancies.forEach((vacancy) => {
    const slug = vacancySlugById.get(String(vacancy.id)) || slugify(vacancy.title);

    const agency = agencies.find((a) => a.id === vacancy.agency_id);

    const dir = path.join(vacancyDir, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), buildVacancyPage(vacancy, agency, slug));
    sitemapUrls.push(`${SITE_URL}/vacancy/${slug}/`);
  });

  // Location hub pages (SEO) — real, keyword-targeted landing pages that
  // also give every 'general' (non-agency) vacancy its first real
  // internal link on the site. Only build a hub for locations with at
  // least 2 vacancies — a 1-listing page is too thin to be a useful page
  // for anyone, and thin pages are themselves a cause of non-indexing.
  const bucketed = new Map();
  vacancies.forEach((v) => {
    const bucket = resolveLocationBucket(v.location);
    if (!bucket) return;
    if (!bucketed.has(bucket)) bucketed.set(bucket, []);
    bucketed.get(bucket).push(v);
  });

  const hubBuckets = [...bucketed.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([name, list]) => ({ name, count: list.length, vacancies: list }));

  hubBuckets.forEach(({ name, vacancies: bucketVacancies }) => {
    const { slug, html } = buildLocationHubPage(name, bucketVacancies, agencies, vacancySlugById);
    const dir = path.join(OUT_DIR, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/${slug}/`);
  });

  if (hubBuckets.length) {
    const jobsIndexDir = path.join(OUT_DIR, 'jobs');
    ensureDir(jobsIndexDir);
    fs.writeFileSync(
      path.join(jobsIndexDir, 'index.html'),
      buildJobsIndexPage(hubBuckets.map(({ name, count }) => ({ name, count })))
    );
    sitemapUrls.push(`${SITE_URL}/jobs/`);
  }

  // Job category hub pages (SEO) — same pattern as location hubs, scoped
  // to Gauteng vacancies only (consistent with the rest of the static
  // site's Gauteng focus). Only categories with at least 2 matches get a
  // page, for the same thin-content reason as above.
  const categorised = new Map();
  vacancies.forEach((v) => {
    if (!resolveLocationBucket(v.location)) return; // Gauteng-only, same test as location hubs
    const category = resolveJobCategory(v.title);
    if (!category) return;
    if (!categorised.has(category)) categorised.set(category, []);
    categorised.get(category).push(v);
  });

  const categoryBuckets = [...categorised.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([name, list]) => ({ name, count: list.length, vacancies: list }));

  categoryBuckets.forEach(({ name, vacancies: categoryVacancies }) => {
    const { slug, html } = buildCategoryHubPage(name, categoryVacancies, agencies, vacancySlugById);
    const dir = path.join(OUT_DIR, slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/${slug}/`);
  });

  if (categoryBuckets.length) {
    const categoriesIndexDir = path.join(OUT_DIR, 'job-categories');
    ensureDir(categoriesIndexDir);
    fs.writeFileSync(
      path.join(categoriesIndexDir, 'index.html'),
      buildJobCategoriesIndexPage(categoryBuckets.map(({ name, count }) => ({ name, count })))
    );
    sitemapUrls.push(`${SITE_URL}/job-categories/`);
  }

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
.sp-header img{border-radius:9px;display:block}
h1{font-size:1.6rem;margin-bottom:.5rem}
h2{font-size:1.2rem;margin-top:1.5rem}`;
  fs.writeFileSync(path.join(OUT_DIR, 'static-pages.css'), css);

  console.log(`Done. Wrote ${agencies.length} agency pages, ${vacancies.length} vacancy pages, ${hubBuckets.length} location hub pages, ${categoryBuckets.length} category hub pages, and sitemap.xml.`);
}

main().catch((err) => {
  console.error('generate-pages.js failed:', err);
  process.exit(1);
});

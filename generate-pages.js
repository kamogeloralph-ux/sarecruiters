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
    validThrough: vacancy.closing_date || undefined,
    employmentType: vacancy.employment_type || undefined,
    hiringOrganization: {
      '@type': 'Organization',
      name: companyName,
    },
    jobLocation: vacancy.location
      ? {
          '@type': 'Place',
          address: {
            '@type': 'PostalAddress',
            addressLocality: vacancy.location,
            addressCountry: 'ZA',
          },
        }
      : undefined,
    baseSalary: vacancy.salary
      ? {
          '@type': 'MonetaryAmount',
          currency: 'ZAR',
          value: { '@type': 'QuantitativeValue', value: vacancy.salary },
        }
      : undefined,
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

  console.log(`Done. Wrote ${agencies.length} agency pages, ${vacancies.length} vacancy pages, and sitemap.xml.`);
}

main().catch((err) => {
  console.error('generate-pages.js failed:', err);
  process.exit(1);
});

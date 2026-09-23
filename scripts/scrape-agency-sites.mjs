import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

// Scrapes vacancies directly off individual recruitment agencies' own
// websites, for agencies that don't (yet) have a Pnet company page
// (scrape-pnet.mjs already covers agencies that do -- that's the preferred
// path since Pnet gives clean structured JobPosting data; this script is
// for the rest).
//
// This version is DB-driven rather than a hand-maintained URL list: it
// reads every agency's `website` column, tries a short list of common
// vacancy-page paths under it (plus the homepage itself), and picks
// whichever candidate is (a) allowed by robots.txt, (b) actually fetchable,
// and (c) yields parseable jobs. Whatever wins is cached to
// agencies.site_vacancy_url so future runs skip straight to it instead of
// re-discovering. Sites that fail every candidate are marked with a
// site_scrape_status (skipped_robots / skipped_unreachable /
// skipped_no_jobs) and reason instead of erroring the run -- see
// classifySite() for exactly what each status means.
//
// With ~140 agencies in the directory, one run does not attempt all of
// them: agencies are processed oldest-site_scraped_at-first (same rotation
// pattern scrape-pnet.mjs uses for last_scraped_at), capped at
// AGENCY_SITES_BATCH_SIZE per run, so a 6-hourly cron cycles through the
// whole directory over a day or two rather than hammering 140 sites at once.
//
// NOTE ON SELECTOR STRATEGY: a spot-check of 6 of the original 14 target
// sites (fetched directly, not guessed) found a generic CSS-selector guess
// does NOT reliably work across agency websites -- every site checked
// needed something different:
//   - izweplacements.co.za/vacancies/ and affirmativeportfolios.co.za/vacancies/
//     -- both 404, the URLs are dead
//   - jcmconsultants.co.za/jobs/ and assegai.co.za/vacancies/
//     -- disallow automated fetches via robots.txt
//   - headhunters.co.za/vacancies/ -- vacancy list is injected by
//     client-side JS, nothing to scrape in the static HTML
//   - annswann.co.za/vacancies/ -- doesn't host vacancies itself, embeds a
//     third-party widget (webapp.placementpartner.com)
//   - abantustaffingsolutions.co.za/jobs/ -- works well, but it's really
//     Dittojobs (another shared ATS) rendering each field (title,
//     "Reference No: 1976879110", location, description, "Salary: ...")
//     as plain text. Confirmed the field pattern and ordering live; the
//     exact DOM tags weren't visible through the tool used to check it
//     (only rendered text), so tierB's block-element assumption below is
//     inferred, not directly confirmed -- dry-run this one specifically
//     before trusting it.
// So this script tries two independent parsing strategies per candidate URL
// -- tierA (CSS card selectors, then a raw anchor-scan fallback) and tierB
// (the Dittojobs-style "Reference No: ... / Salary: ..." text-block
// pattern) -- and a candidate only counts as a hit if either finds
// something. The robots.txt check and the unreachable/404 handling above
// generalize the jcmconsultants/assegai/izweplacements/affirmativeportfolios
// cases automatically; a site that comes back with 0 jobs from every
// candidate (headhunters, annswann) is not necessarily broken code -- it
// may need bespoke handling the way jobmail/careerjunction/retail/pnet each
// got. Do a real dry run (node scripts/scrape-agency-sites.mjs) and check
// the log output / site_scrape_reason before assuming a site is a lost
// cause -- see scrape-agency-sites.test.mjs for the fixtures this was built
// and tested against.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.AGENCY_SITES_REQUEST_TIMEOUT_MS, 15_000);
const FETCH_ATTEMPTS = parsePositiveInt(process.env.AGENCY_SITES_FETCH_ATTEMPTS, 2);
const REQUEST_DELAY_MS = parsePositiveInt(process.env.AGENCY_SITES_REQUEST_DELAY_MS, 1_500);
const CONCURRENCY = parsePositiveInt(process.env.AGENCY_SITES_CONCURRENCY, 3);
const BATCH_SIZE = parsePositiveInt(process.env.AGENCY_SITES_BATCH_SIZE, 40);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersAgencySiteScraper/1.0 (+https://sa-recruiters.co.za)';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

// Common vacancy-page paths across agency sites, tried in this order after
// the cached/known URL. Kept short and generic on purpose -- an aggressive
// list of guesses just means more requests to sites that will 404 on all of
// them anyway; the robots + unreachable + no-jobs classification handles
// whatever's left.
export const CANDIDATE_PATHS = [
  '', // the homepage itself -- some sites list vacancies right there
  '/vacancies/', '/vacancies', '/jobs/', '/jobs', '/careers/', '/careers',
  '/career/', '/current-vacancies/', '/job-vacancies/', '/vacancy/',
];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function absoluteUrl(href, baseUrl) {
  if (href == null) return null; // note: '' is a valid href (resolves to baseUrl itself)
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeWebsite(website) {
  if (!website) return null;
  const withScheme = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try { return new URL(withScheme).toString(); } catch { return null; }
}

// Tags an error as either 'http' (the host responded, just not with 2xx --
// worth trying a different path on the same host) or 'network' (DNS
// failure, connection refused, timeout -- the host itself is unreachable,
// so trying more paths on it is pointless and just burns time). Discovery
// uses this to stop probing a dead host after one failure instead of
// waiting out the same timeout on every remaining candidate path.
function taggedFetchError(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

async function fetchText(url, { timeoutMs = REQUEST_TIMEOUT_MS, attempts = FETCH_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
        });
      } catch (networkError) {
        throw taggedFetchError('network', networkError instanceof Error ? networkError.message : String(networkError));
      }
      if (!response.ok) throw taggedFetchError('http', `HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/html/i.test(contentType)) throw taggedFetchError('http', `unsupported content-type: ${contentType}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1_500 * attempt);
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

// Minimal robots.txt parser: honours Disallow rules under a matching
// User-agent group (our own UA if a group targets it, else the wildcard
// group), using simple prefix matching. Good enough to respect an explicit
// "don't scrape me"; on any fetch/parse failure we treat robots.txt as
// absent, which per convention means "no restrictions".
function parseRobots(robotsTxt, userAgent) {
  const groups = []; // { agents: string[], disallow: string[], finished: boolean }
  let current = null;
  for (const rawLine of robotsTxt.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [rawField, ...rest] = line.split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (field === 'user-agent') {
      if (!current || current.finished) {
        current = { agents: [], disallow: [], finished: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current.finished = true;
      if (value) current.disallow.push(value);
    }
  }
  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  return (specific || wildcard)?.disallow || [];
}

const robotsCache = new Map(); // origin -> Promise<string[] disallow rules>
async function robotsAllows(url, userAgent = USER_AGENT) {
  const target = new URL(url);
  const origin = target.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const text = await fetchText(`${origin}/robots.txt`, { timeoutMs: 8_000, attempts: 1 });
        return parseRobots(text, userAgent);
      } catch {
        return []; // missing/unreadable robots.txt -- treat as unrestricted
      }
    })());
  }
  const disallow = await robotsCache.get(origin);
  return !disallow.some((rule) => target.pathname.startsWith(rule));
}

function jobId(siteName, link) {
  return `agency-${crypto.createHash('sha1').update(`${siteName}-${link}`).digest('hex').slice(0, 20)}`;
}

// A recruitment agency's own site almost always also has a blog ("Top
// Roles in Admin Recruitment Today", "Why Cape Town is a FinTech
// Powerhouse"), usually with each post wrapped in a generic <article> tag
// and linked from URLs containing words like "career" ("/career-advice/...")
// that a loose vacancy-link regex will happily match. Both of the checks
// below exist specifically to keep blog/news content out of what's meant to
// be a vacancies-only scrape:
//   - BLOG_PATH_RX matches path segments that mean "this is an article",
//     even on a URL that also happens to contain "job" or "career".
//   - looksLikeJobTitle() rejects headline-shaped text (starts with "How
//     to"/"Why"/"Top N"/etc., ends in "?", or is implausibly long for a job
//     title) that a real vacancy title essentially never looks like.
// A false negative here (a real vacancy skipped) just shows up as
// site_scrape_status 'skipped_no_jobs' for manual follow-up; a false
// positive (a blog post saved as a vacancy) ships wrong data straight into
// the live listings, so this errs firmly toward skipping.
// "resource(s)" deliberately excluded from BLOG_PATH_RX's keyword list --
// see below.
const BLOG_PATH_RX = /[/-](blog|news|articles?|insights?|advice|guides?|tips?|press|media|about)([/-]|$)/i;
// "resource(s)" needs a stricter leading boundary than the rest: unlike
// blog/news/tips/etc., it collides with real job *titles* often enough
// that the same hyphen-tolerant boundary used above produces false
// positives -- confirmed real: AGC Recruitment's "Mineral Resource
// Manager" (a genuine posting) would get rejected because "resource"
// sits mid-slug as "mineral-RESOURCE-manager", hyphen-bounded on both
// sides, same shape as the compound blog-path segments this regex family
// exists to catch. Keeping this one on a strict slash-only leading
// boundary means it still catches a real /resources/ or /our-resources/
// section link, just not the word appearing inside an unrelated slug.
const RESOURCES_SECTION_RX = /\/resources?([/-]|$)/i;
const JOB_PATH_RX = /[/-](vacanc(y|ies)|jobs?|positions?|openings?|current-vacancies)([/-]|$)/i;
// Matches the *index/landing* page for a job section rather than an
// individual posting -- e.g. "/vacancies", "/vacancies/", "/jobs",
// "/job-seekers/", "/current-vacancies" with nothing after it. A real
// posting almost always has a slug or numeric id after the section
// keyword ("/vacancies/electrician-cape-town", "/jobs/1234"); the bare
// section root is just navigation to the listing page itself.
//
// Also matches a WP Job Manager-style TAXONOMY archive
// ("/job-category/south-africa/", "/vacancy-type/permanent/") -- these have
// the same path depth as a real posting ("/job-category/south-africa/" has
// as many segments as "/vacancies/electrician-cape-town"), so a
// segment-count heuristic alone can't tell them apart; a real posting's
// last segment/query is a specific slug or numeric id, "south-africa" here
// is a taxonomy *term*, i.e. still every job in that province/category,
// which is exactly the "index page, not one posting" case this exists to
// catch. Confirmed real: welovesalt.com's "Jobs in SA" ->
// /job-category/south-africa/.
const JOB_SECTION_ROOT_RX = /[/-](vacanc(y|ies)|jobs?|careers?|positions?|openings?|current-vacancies|job-seekers?)\/?(\?.*)?(#.*)?$|[/-](job|vacancy|jobs|vacancies)-(categor(y|ies)|region|type|location|department)\/[^/]+\/?(\?.*)?(#.*)?$/i;
// A handful of agency sites link out to a WordPress theme's own demo
// content instead of their real listings, apparently left over from
// whoever built the site never swapping the theme's placeholder data --
// confirmed real: Dynamic Labour Solutions' "Explore all jobs" resolves to
// wordpress-theme.spider-themes.net/jobi/job-list-1/, a theme *marketplace*
// demo site, not their own domain at all.
const THEME_DEMO_HOST_RX = /(^|\.)(spider-themes|theme-?fusion|elegantthemes|envato|themeforest|wpbakery|demo\d*)\./i;
// Generic calls-to-action and nav labels that keep getting scraped as if
// they were a job title, because the text sits right next to (or inside)
// a link whose href happens to match JOB_PATH_RX. None of these are ever
// an actual vacancy title.
const GENERIC_CTA_TITLE_RX = /^(vacanc(y|ies)|jobs?|careers?|positions?( available)?|openings?|current vacanc(y|ies)|available (jobs?|positions?|openings?|vacanc(y|ies))|open vacanc(y|ies)|view( all|s)? (jobs?|vacanc(y|ies)|positions?|openings?|categories|details)|view job\b|view more vacanc(y|ies)|browse jobs?|search vacanc(y|ies)|job (search|listings?|categories|seekers?|market news|dashboard|board)|find (a |your )?(next )?(job|role|position|vacancy|career)( now)?|find out more|more info(rmation)?|learn more|read more( articles?| jobs?| vacanc(y|ies)| about (us|this))?|explore (all |our )?(the )?(jobs?|vacanc(y|ies)|positions?|fields|opportunities)|register( your)? cv( here)?|register now|submit( your)? cv|apply now|(save|bookmark|share|email|print)( this)? job|career opportunities)$/i;
function looksLikeJobTitle(title) {
  if (!title || title.length < 4 || title.length > 90) return false;
  if (/\?\s*$/.test(title)) return false;
  if (/^(how|why|what|when|where|top\s+\w|the\s+(difference|complete|ultimate)s?\b|guide\s+to|\d+\s+(tips|ways|reasons|things))/i.test(title)) return false;
  if (GENERIC_CTA_TITLE_RX.test(title.trim())) return false;
  return true;
}
function isRealPageLink(href) {
  // Reject mailto:/tel:/javascript:/bare-# links -- these are contact or
  // no-op links that occasionally sit first inside a "job card" and were
  // getting picked up as the job's own link (see isLikelyJobLink note).
  return !/^\s*(mailto|tel|javascript):/i.test(href) && href !== '#' && href.trim() !== '';
}
function isThemeDemoLink(link) {
  try { return THEME_DEMO_HOST_RX.test(new URL(link).hostname); } catch { return false; }
}
function isLikelyJobLink(href) {
  return isRealPageLink(href) && JOB_PATH_RX.test(href) && !BLOG_PATH_RX.test(href) && !RESOURCES_SECTION_RX.test(href) && !JOB_SECTION_ROOT_RX.test(href);
}

// Used only by the anchor-scan fallback below. Many agency sites structure
// each listing as a heading plus a SEPARATE "View Details"/"Read More"/
// "Apply Now" button linking to the same job -- the button's own text is
// never the job title, but naively grabbing $(anchor).text() as the title
// (the previous behaviour) captured exactly that button text instead of
// the real heading sitting right next to it. This climbs a few ancestor
// levels from the anchor looking for a heading-shaped element and prefers
// it over the anchor's own text when one is found and looks title-like --
// capped at 3 hops so it can't reach past the current card into a
// neighbouring one's heading in a shared list wrapper.
function findNearbyHeading($, anchorEl) {
  let node = $(anchorEl);
  for (let hop = 0; hop < 3 && node.length; hop += 1) {
    const heading = node.find('h1, h2, h3, h4, h5, .title, .job-title, [class*="title"], [class*="position"]').first();
    const text = clean(heading.text());
    if (text) return text;
    node = node.parent();
  }
  return '';
}

// Tier A -- structural card scan: try known vacancy-card container
// selectors first; if none match, fall back to a raw anchor scan for links
// that look like individual job pages. Deliberately does NOT include a
// bare "article" selector -- see the blog-vs-vacancy note above.
function parseTierA(html, site) {
  const $ = cheerio.load(html);
  const jobs = [];
  const seen = new Set();
  function push({ title, location, href }) {
    title = clean(title);
    if (!looksLikeJobTitle(title)) return;
    if (!href || !isRealPageLink(href)) return;
    const link = absoluteUrl(href, site.url) || site.url;
    if (BLOG_PATH_RX.test(link) || RESOURCES_SECTION_RX.test(link) || JOB_SECTION_ROOT_RX.test(link) || isThemeDemoLink(link) || seen.has(link)) return;
    seen.add(link);
    jobs.push({ title, location: clean(location), link });
  }
  $('.job, .vacancy, .job-item, .job-listing, tr.job_listing, .career-item, .vacancy-item, [class*="job-card"], [class*="vacancy-card"]').each((_, el) => {
    const card = $(el);
    // Prefer an anchor whose href actually looks job/vacancy-shaped; only
    // fall back to "whatever the first link in the card is" if none of
    // its links do. A bare comma-separated selector list here (as this
    // used to be: 'a[href*="job"], a[href*="vacan"], a') is an OR across
    // all three -- since a bare "a" matches every anchor, .first() just
    // returned the first anchor in the card regardless of where it
    // pointed (a "contact us" mailto:, a share button, etc.).
    var candidateHref = card.find('a[href*="job"], a[href*="vacan"]').filter((i, a) => isRealPageLink($(a).attr('href') || '')).first().attr('href');
    if (!candidateHref) candidateHref = card.find('a').filter((i, a) => isRealPageLink($(a).attr('href') || '')).first().attr('href');
    push({
      title: card.find('h1, h2, h3, h4, a.job-title, .title, td.job-title').first().text(),
      location: card.find('.location, .job-location, .region, .address').first().text(),
      href: candidateHref,
    });
  });
  if (!jobs.length) {
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!isLikelyJobLink(href)) return;
      const anchorText = clean($(el).text());
      // A CTA button's own text ("View Details", "Read More", "Explore
      // all jobs", "Apply Now"...) is never the job title -- when the
      // anchor text itself is one of these (or too short to be a title
      // at all), the real title is almost always a heading sitting right
      // next to it, not the button. Only fall through to the anchor's own
      // text when no such heading exists nearby.
      const looksLikeCta = anchorText.length < 6 || GENERIC_CTA_TITLE_RX.test(anchorText);
      const heading = looksLikeCta ? findNearbyHeading($, el) : '';
      const title = heading && looksLikeJobTitle(heading) ? heading : anchorText;
      push({ title, location: '', href });
    });
  }
  return jobs;
}

// Tier B -- Dittojobs-style plain text block pattern: title line, then
// "Reference No: <digits>", then a location line ("<City>, South Africa").
// Confirmed live against abantustaffingsolutions.co.za/jobs/. Deliberately
// walks the DOM in document order collecting one text chunk per leaf
// block element, rather than regexing $('body').text() as one flattened
// string -- once flattened, adjacent entries run together with no
// reliable boundary (an earlier version of this function mismatched
// titles for exactly that reason), whereas each field reliably renders as
// its own block element in the source markup.
function parseTierB(html, site) {
  const $ = cheerio.load(html);
  const blocks = [];
  $('body')
    .find('*')
    .filter((_, el) => $(el).children().length === 0)
    .each((_, el) => {
      const text = clean($(el).text());
      if (text) blocks.push(text);
    });
  const jobs = [];
  for (let i = 1; i < blocks.length - 1; i += 1) {
    const refMatch = blocks[i].match(/^Reference No:\s*(\d+)/);
    if (!refMatch) continue;
    const title = blocks[i - 1];
    const location = blocks[i + 1];
    if (!title || !/, South Africa$/.test(location)) continue;
    const link = `${site.url.replace(/\/$/, '')}#ref-${refMatch[1]}`;
    jobs.push({ title, location, link });
  }
  return jobs;
}

// Extracts fuller detail (location, salary, closing date, a description
// blurb) from a job's OWN detail page -- the listing/card page a site's
// vacancy index shows usually has just a title (sometimes a location),
// nothing else, even though the individual job page has the full posting.
// Confirmed real: every currently-scraped agency vacancy has location,
// salary, closing_date and notes all blank, despite the source sites
// visibly listing all of that on the job's own page. This is best-effort
// and generic (there's no shared template across ~140 different agency
// sites) -- it tries known content-area selectors first, then falls back
// to the largest text block in the page body outside nav/header/footer.
const DETAIL_CONTENT_SELECTORS = 'article, main, .job-description, .vacancy-description, .job-detail, .job-details, .vacancy-detail, .entry-content, .content, [class*="description"], #content';
export function extractJobDetail(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .menu, .navigation, .breadcrumbs').remove();
  let container = $(DETAIL_CONTENT_SELECTORS).first();
  if (!container.length || clean(container.text()).length < 40) {
    // No matching content area, or it matched something too thin to be
    // the actual posting (e.g. a one-line header) -- fall back to
    // whichever top-level body element has the most text, which is
    // usually the main content column even on an unfamiliar template.
    let best = null;
    let bestLength = 0;
    $('body').children().each((_, el) => {
      const text = clean($(el).text());
      if (text.length > bestLength) { bestLength = text.length; best = $(el); }
    });
    if (best) container = best;
  }
  const text = clean(container.text ? container.text() : '');
  const salary = text.match(/(?:salary|remuneration|package)\s*:?\s*([^\n.]{3,80})/i)?.[1]?.trim() || '';
  const closingDateRaw = text.match(/closing date\s*:?\s*([^\n.]{3,40})/i)?.[1]?.trim() || '';
  const location = text.match(/(?:location|centre|based in)\s*:?\s*([^\n.]{2,60})/i)?.[1]?.trim() || '';
  // Capped: this is meant to give a useful blurb, not mirror the whole page
  // (and keeps the eventual `notes` column from growing unbounded across
  // ~150 agencies' worth of postings).
  const description = text.slice(0, 1500);
  return { location, salary, closingDateRaw, description };
}

// Bounded, OPT-IN enrichment: fetches each discovered job's own detail
// page and fills in what extractJobDetail finds. Off by default
// (AGENCY_SITES_FETCH_DETAILS) because it multiplies request volume by
// roughly the average jobs-per-site instead of one fetch per site -- with
// ~40 sites/run and a 15-minute total budget, this needs a real dry run
// (see the file-level comment) to confirm it doesn't blow the timeout
// before it's turned on in the scheduled workflow. AGENCY_SITES_DETAIL_LIMIT
// caps it further per site regardless.
const FETCH_DETAILS = /^(1|true|yes)$/i.test(process.env.AGENCY_SITES_FETCH_DETAILS || '');
const DETAIL_FETCH_LIMIT = parsePositiveInt(process.env.AGENCY_SITES_DETAIL_LIMIT, 8);
async function enrichWithDetailPages(jobs) {
  if (!FETCH_DETAILS) return jobs;
  const enriched = [];
  for (const [index, job] of jobs.entries()) {
    if (index >= DETAIL_FETCH_LIMIT) { enriched.push(job); continue; }
    try {
      const html = await fetchText(job.link, { timeoutMs: DISCOVERY_TIMEOUT_MS, attempts: 1 });
      const detail = extractJobDetail(html);
      enriched.push({
        ...job,
        location: job.location || detail.location,
        salary: detail.salary,
        closing_date: detail.closingDateRaw,
        notes: detail.description,
      });
    } catch (error) {
      console.warn(`[agency-sites] detail fetch failed for ${job.link}: ${error instanceof Error ? error.message : String(error)}`);
      enriched.push(job);
    }
    if (index < jobs.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  return enriched;
}

export function parseAgencySiteJobs(html, site) {
  const tierA = parseTierA(html, site);
  if (tierA.length) return tierA;
  return parseTierB(html, site);
}

export function buildCandidateUrls(agency) {
  const base = normalizeWebsite(agency.website);
  if (!base) return [];
  const candidates = [];
  const seen = new Set();
  function add(url) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(url);
  }
  if (agency.site_vacancy_url) add(agency.site_vacancy_url); // cached winner first
  for (const path of CANDIDATE_PATHS) add(absoluteUrl(path, base));
  return candidates;
}

// Discovery probes use a short timeout and a single attempt -- across up to
// 12 candidate paths per agency, waiting out the full REQUEST_TIMEOUT_MS /
// FETCH_ATTEMPTS budget on every one of them would make a single dead site
// eat minutes. A candidate that times out here just gets picked up again
// on a later scheduled run (rotation), so there's little lost by probing
// fast and moving on.
const DISCOVERY_TIMEOUT_MS = parsePositiveInt(process.env.AGENCY_SITES_DISCOVERY_TIMEOUT_MS, 8_000);

// Tries each candidate URL in order and returns the first one that's
// robots-allowed, fetchable, and parses to at least one job. Every
// candidate is recorded in `attempts` (with why it didn't work) so a total
// failure can be classified and explained rather than just logged as "0
// jobs". Stops early on a 'network' error (DNS/connection/timeout) since
// that means the host itself is down -- the remaining paths on the same
// host would all fail the same way, so there's no point burning the time
// to prove it 11 more times.
async function discoverVacancyPage(agency) {
  const attempts = [];
  for (const url of buildCandidateUrls(agency)) {
    const site = { name: agency.name, url };
    if (!(await robotsAllows(url))) { attempts.push({ url, reason: 'blocked by robots.txt' }); continue; }
    let html;
    try {
      html = await fetchText(url, { timeoutMs: DISCOVERY_TIMEOUT_MS, attempts: 1 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ url, reason: `unreachable (${message})` });
      if (error?.kind === 'network') break; // host itself is down -- stop probing it
      continue;
    }
    const jobs = parseAgencySiteJobs(html, site);
    if (jobs.length) return { url, jobs, attempts };
    attempts.push({ url, reason: 'fetched OK but no parseable jobs' });
  }
  return { url: null, jobs: [], attempts };
}

// Classifies a fully-failed site (no candidate produced jobs) from its
// attempt log, for the site_scrape_status column.
export function classifySite(attempts) {
  if (!attempts.length) return { status: 'skipped_unreachable', reason: 'agency has no usable website URL' };
  if (attempts.every((a) => a.reason.includes('robots.txt'))) {
    return { status: 'skipped_robots', reason: 'every candidate page is disallowed by robots.txt' };
  }
  if (attempts.every((a) => a.reason.startsWith('unreachable'))) {
    return { status: 'skipped_unreachable', reason: `all candidates unreachable: ${attempts.map((a) => `${a.url} (${a.reason})`).join('; ')}` };
  }
  return { status: 'skipped_no_jobs', reason: `no candidate yielded parseable jobs: ${attempts.map((a) => `${a.url} (${a.reason})`).join('; ')}` };
}

async function upsertJobs(jobs) {
  if (!jobs.length) return 0;
  const links = jobs.map((j) => j.link);
  const { data: existingJobs, error: existingError } = await supabase.from('vacancies').select('id,link').in('link', links).limit(500);
  if (existingError) throw existingError;
  const existingByLink = new Map((existingJobs || []).map((j) => [j.link, j.id]));
  const rows = jobs.map((j) => ({ ...j, id: existingByLink.get(j.link) || j.id }));
  const { error } = await supabase.from('vacancies').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows.length;
}

async function markStatus(agencyId, fields) {
  const { error } = await supabase.from('agencies').update({ ...fields, site_scraped_at: new Date().toISOString() }).eq('id', agencyId);
  if (error) console.error(`[agency-sites] failed to save status for agency ${agencyId}: ${error.message}`);
}

async function scrapeSite(agency) {
  const { url, jobs: parsed, attempts } = await discoverVacancyPage(agency);
  if (!url) {
    const { status, reason } = classifySite(attempts);
    console.log(`[agency-sites] ${agency.name}: ${status} -- ${reason}`);
    await markStatus(agency.id, { site_scrape_status: status, site_scrape_reason: reason, site_vacancy_url: null });
    return 0;
  }
  const detailed = await enrichWithDetailPages(parsed);
  const jobs = detailed.map((job) => ({
    ...job,
    id: jobId(agency.name, job.link),
    employer_id: null,
    email: '', phone: '', remote: null, experience_level: '', employment_type: '',
    contract_type: '', work_schedule: '', hours: '', start_date: '',
    salary: job.salary || '', notes: job.notes || '', closing_date: job.closing_date || '',
    source_type: 'agency',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    agency_id: agency.id,
    company: agency.name,
    company_photo: agency.photo || null,
  }));
  const count = await upsertJobs(jobs);
  console.log(`[agency-sites] ${agency.name}: parsed ${jobs.length}, upserted ${count} (${url})`);
  await markStatus(agency.id, { site_scrape_status: 'ok', site_scrape_reason: null, site_vacancy_url: url });
  return count;
}

export async function runAgencySiteScraper() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  // Agencies without a Pnet page are ours to cover, oldest-checked first so
  // a single run rotates through the whole ~140-agency directory over
  // several scheduled runs instead of hammering every site every time.
  const { data: agencies, error } = await supabase
    .from('agencies')
    .select('id,name,photo,website,site_vacancy_url,site_scraped_at')
    .not('website', 'is', null)
    .neq('website', '')
    .is('pnet_url', null)
    .order('site_scraped_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) throw error;

  const sites = agencies || [];
  let cursor = 0;
  let total = 0;
  let failures = 0;
  async function worker() {
    while (cursor < sites.length) {
      const agency = sites[cursor++];
      try {
        total += await scrapeSite(agency);
      } catch (err) {
        failures += 1;
        console.error(`[agency-sites] ${agency.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        await markStatus(agency.id, { site_scrape_status: 'error', site_scrape_reason: err instanceof Error ? err.message : String(err) });
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));

  return { sitesAttempted: sites.length, vacanciesUpserted: total, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runAgencySiteScraper();
  console.log(`[agency-sites] completed: ${JSON.stringify(results)}`);
  if (results.failures) process.exitCode = 1;
}

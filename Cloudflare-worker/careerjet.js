// ============================================================================
//  SA RECRUITERS — Cloudflare-worker/careerjet.js
//
//  GET /api/jobs/careerjet?keywords=python+developer&location=Durban&page=1
//
//  Server-side proxy for the Careerjet Partner API (v4). The browser never sees
//  the API key. Careerjet requires, on every call:
//    - HTTP Basic auth, API key as the username and an empty password
//    - user_ip / user_agent of the real visitor (not of this Worker)
//    - a Referer naming the page that shows the results (our /find-jobs/ page)
//
//  Secret (never in wrangler.toml):   npx wrangler secret put CAREERJET_API_KEY
//  Optional plain variables:          CAREERJET_LOCALE (default en_ZA)
//
//  Everything except careerjetSearchResponse() is pure and unit-tested in
//  scripts/careerjet.test.mjs.
// ============================================================================

const ENDPOINT = "https://search.api.careerjet.net/v4/query";
const DEFAULT_LOCALE = "en_ZA";
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;
// Careerjet v4 documents page values from 1 through 10. Keeping this limit in
// the proxy also prevents the frontend from requesting an upstream-invalid page.
const MAX_PAGE = 10;
const SORTS = ["relevance", "date", "salary"];
const TIMEOUT_MS = 8000;

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function intInRange(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Validates and normalises the visitor's search. Returns { error } or { query }.
export function parseSearchParams(searchParams) {
  const keywords = clean(searchParams.get("keywords"), 100);
  const location = clean(searchParams.get("location"), 80);
  if (!keywords && !location) {
    return { error: "Enter a job title, skill or location to search." };
  }
  const sort = SORTS.includes(searchParams.get("sort")) ? searchParams.get("sort") : "relevance";
  return {
    query: {
      keywords,
      location,
      page: intInRange(searchParams.get("page"), 1, 1, MAX_PAGE),
      pageSize: intInRange(searchParams.get("page_size"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
      sort
    }
  };
}

// The Referer must be the page that displays the results. Only pages on our own
// site are accepted; anything else falls back to /find-jobs/.
export function refererFor(pageUrl, siteUrl) {
  const site = new URL(siteUrl || "https://sa-recruiters.co.za");
  const fallback = `${site.origin}/find-jobs/`;
  if (!pageUrl) return fallback;
  try {
    const u = new URL(pageUrl);
    const bare = (h) => h.replace(/^www\./, "");
    if (u.protocol === "https:" && bare(u.hostname) === bare(site.hostname)) return u.href.slice(0, 500);
  } catch (_) {}
  return fallback;
}

export function visitorIp(request) {
  const direct = request.headers.get("CF-Connecting-IP");
  if (direct) return direct.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  return forwarded ? forwarded.split(",")[0].trim() : "";
}

export function buildCareerjetUrl(query, { locale, ip, userAgent }) {
  const url = new URL(ENDPOINT);
  const set = (k, v) => { if (v !== "" && v != null) url.searchParams.set(k, String(v)); };
  set("locale_code", locale || DEFAULT_LOCALE);
  set("keywords", query.keywords);
  set("location", query.location);
  set("page", query.page);
  set("page_size", query.pageSize);
  set("sort", query.sort);
  set("user_ip", ip);
  set("user_agent", userAgent);
  return url.toString();
}

// Careerjet descriptions carry <b> highlighting and HTML entities. The page
// renders plain text only, so strip all of it here.
export function plainText(html, max) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 400);
}

function httpsUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch (_) {
    return "";
  }
}

export function mapJob(job) {
  const url = httpsUrl(job && job.url);
  if (!url) return null;
  return {
    title: plainText(job.title, 160) || "Untitled role",
    company: plainText(job.company, 120),
    location: plainText(job.locations, 120),
    salary: plainText(job.salary, 80),
    date: plainText(job.date, 40),
    description: plainText(job.description, 320),
    source: plainText(job.site, 60),
    url
  };
}

// Turns Careerjet's reply into the small shape the page uses.
//   JOBS       -> { type: "jobs", total, pages, jobs: [...] }
//   LOCATIONS  -> { type: "locations", locations: ["Durban, KwaZulu-Natal", ...] }
// Throws on ERROR or anything unrecognised.
export function mapCareerjetResponse(data, page) {
  if (!data || typeof data !== "object") throw new Error("Empty reply from Careerjet.");
  if (data.type === "ERROR") throw new Error(String(data.error || "Careerjet returned an error."));
  if (data.type === "LOCATIONS") {
    const list = Array.isArray(data.solveLocations) ? data.solveLocations
      : Array.isArray(data.locations) ? data.locations : [];
    const names = list
      .map((l) => (typeof l === "string" ? l : l && (l.name || l.location || l.label)))
      .map((l) => plainText(l, 100))
      .filter(Boolean)
      .slice(0, 8);
    return { type: "locations", locations: names };
  }
  if (data.type === "JOBS" || Array.isArray(data.jobs)) {
    const jobs = (Array.isArray(data.jobs) ? data.jobs : []).map(mapJob).filter(Boolean);
    return {
      type: "jobs",
      total: Number.isFinite(Number(data.hits)) ? Number(data.hits) : jobs.length,
      pages: Number.isFinite(Number(data.pages)) ? Number(data.pages) : (jobs.length ? page : 0),
      page,
      jobs
    };
  }
  throw new Error("Unrecognised reply from Careerjet.");
}

// Secrets copied from a dashboard or CI variable occasionally contain a
// trailing newline. Careerjet treats that newline as part of the Basic-auth
// username, so normalize the value at the boundary without ever logging it.
export function normaliseApiKey(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "");
}

function fail(json, origin, status, error) {
  return json({ ok: false, error }, status, origin);
}

// `json` is the Worker's own helper (adds CORS headers for the caller's origin).
export async function careerjetSearchResponse(request, env, origin, json) {
  const apiKey = normaliseApiKey(env && env.CAREERJET_API_KEY);
  if (!apiKey) return fail(json, origin, 503, "Job search is not switched on yet.");

  const url = new URL(request.url);
  const parsed = parseSearchParams(url.searchParams);
  if (parsed.error) return fail(json, origin, 400, parsed.error);

  const ip = visitorIp(request);
  if (!ip) return fail(json, origin, 400, "Could not read your connection details. Please try again.");
  const userAgent = clean(request.headers.get("User-Agent") || "Mozilla/5.0", 300);
  const referer = refererFor(url.searchParams.get("page_url"), env.SITE_URL);

  const target = buildCareerjetUrl(parsed.query, { locale: env.CAREERJET_LOCALE, ip, userAgent });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(target, {
      headers: {
        Authorization: "Basic " + btoa(apiKey + ":"),
        Referer: referer,
        Accept: "application/json"
      },
      signal: controller.signal
    });
  } catch (err) {
    console.warn("careerjet fetch failed", err && err.name);
    return fail(json, origin, 504, "Job search took too long. Please try again.");
  } finally {
    clearTimeout(timer);
  }

  // Read once so both JSON and plain-text upstream errors can be diagnosed.
  // Never include the API key or the full request URL in logs.
  const responseText = await response.text().catch(() => "");
  let data = null;
  try { data = responseText ? JSON.parse(responseText) : null; } catch (_) {}

  if (response.status === 401 || response.status === 403) {
    console.error("careerjet rejected credentials", response.status, data && data.error ? String(data.error).slice(0, 240) : "");
    return fail(json, origin, 502, "Job search is temporarily unavailable.");
  }
  if (!response.ok && !(data && data.type)) {
    console.warn("careerjet http error", response.status, data && data.error ? String(data.error).slice(0, 240) : responseText.slice(0, 240));
    return fail(json, origin, 502, "Job search is temporarily unavailable.");
  }

  let result;
  try {
    result = mapCareerjetResponse(data, parsed.query.page);
  } catch (err) {
    console.warn("careerjet reply rejected", err && err.message);
    return fail(json, origin, 502, "Job search is temporarily unavailable.");
  }

  // Results depend on the visitor's IP, so they must not be shared between people.
  const res = json({ ok: true, ...result }, 200, origin);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

// ============================================================================
//  SA RECRUITERS — Cloudflare-worker/adzuna.js
//
//  GET /api/jobs/adzuna?keywords=python+developer&location=Durban&page=1
//
//  Live search proxy for the Adzuna South Africa API (/jobs/za/search/{page}).
//  Powers /find-jobs/. Adzuna authenticates with an App ID + App Key only (no
//  visitor IP, referer or host registration), so it works straight from a Worker.
//  The browser never sees the credentials.
//
//  Secrets (never in wrangler.toml):
//    npx wrangler secret put ADZUNA_APP_ID
//    npx wrangler secret put ADZUNA_APP_KEY
//  Optional plain variable: ADZUNA_COUNTRY (default "za")
//
//  The background sync (scripts/sync-adzuna.mjs) uses the same field mapping
//  (title / company / location / salary / created / description / redirect_url).
//  That script is a Node job tied to Supabase, so the mapping is mirrored here
//  rather than imported.
//
//  Everything except adzunaSearchResponse() is pure and unit-tested in
//  scripts/adzuna.test.mjs.
// ============================================================================

const API_BASE = "https://api.adzuna.com/v1/api/jobs";
const DEFAULT_COUNTRY = "za";
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;
const MAX_PAGE = 10;
const SORTS = ["relevance", "date", "salary"];
const TIMEOUT_MS = 8000;
// Adzuna's free tier is ~250 calls/day and the background sync uses some of it.
// Results no longer depend on the visitor, so identical searches are shared
// between visitors from the edge cache for a few minutes.
const CACHE_TTL_SECONDS = 600;

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

// Secrets pasted from a dashboard or CI variable sometimes carry a trailing newline.
export function normaliseCredential(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "");
}

export function buildAdzunaUrl(query, { appId, appKey, country }) {
  const c = String(country || DEFAULT_COUNTRY).toLowerCase().replace(/[^a-z]/g, "") || DEFAULT_COUNTRY;
  const url = new URL(`${API_BASE}/${c}/search/${query.page}`);
  const set = (k, v) => { if (v !== "" && v != null) url.searchParams.set(k, String(v)); };
  set("app_id", appId);
  set("app_key", appKey);
  set("results_per_page", query.pageSize);
  set("what", query.keywords);
  set("where", query.location);
  if (query.sort !== "relevance") set("sort_by", query.sort);
  set("content-type", "application/json");
  return url.toString();
}

// Adzuna wraps matched words in <strong> and uses HTML entities. The page renders
// plain text only, so strip all of it here.
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

function httpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch (_) {
    return "";
  }
}

export function formatSalary(min, max, isPredicted) {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (!lo && !hi) return "";
  const fmt = (v) => `R${Math.round(v).toLocaleString("en-US")}`;
  const text = lo && hi && lo !== hi ? `${fmt(lo)} - ${fmt(hi)}` : fmt(lo || hi);
  const predicted = isPredicted === "1" || isPredicted === 1 || isPredicted === true;
  return predicted ? `${text} (estimated)` : text;
}

export function mapJob(item) {
  const url = httpUrl(item && item.redirect_url);
  const title = plainText(item && item.title, 160);
  if (!url || !title) return null;
  return {
    title,
    company: plainText(item.company && item.company.display_name, 120),
    location: plainText(item.location && item.location.display_name, 120),
    salary: formatSalary(item.salary_min, item.salary_max, item.salary_is_predicted),
    date: plainText(item.created, 40),
    description: plainText(item.description, 320),
    source: "Adzuna",
    url
  };
}

// Turns Adzuna's reply into the small shape the page uses:
//   { type: "jobs", total, pages, page, jobs: [...] }
// Throws on anything unrecognised.
export function mapAdzunaResponse(data, page, pageSize) {
  if (!data || typeof data !== "object" || !Array.isArray(data.results)) {
    throw new Error("Unrecognised reply from Adzuna.");
  }
  const jobs = data.results.map(mapJob).filter(Boolean);
  const count = Number(data.count);
  const total = Number.isFinite(count) && count >= 0 ? count : jobs.length;
  const pages = Math.min(MAX_PAGE, Math.ceil(total / (pageSize || DEFAULT_PAGE_SIZE)));
  return { type: "jobs", total, pages, page, jobs };
}

function fail(json, origin, status, error) {
  return json({ ok: false, error }, status, origin);
}

function ok(json, origin, result, hit) {
  const res = json({ ok: true, ...result }, 200, origin);
  res.headers.set("Cache-Control", "public, max-age=300");
  res.headers.set("X-Adzuna-Cache", hit ? "hit" : "miss");
  return res;
}

// `json` is the Worker's own helper (adds CORS headers for the caller's origin).
export async function adzunaSearchResponse(request, env, origin, json) {
  const appId = normaliseCredential(env && env.ADZUNA_APP_ID);
  const appKey = normaliseCredential(env && env.ADZUNA_APP_KEY);
  if (!appId || !appKey) return fail(json, origin, 503, "Job search is not switched on yet.");

  const parsed = parseSearchParams(new URL(request.url).searchParams);
  if (parsed.error) return fail(json, origin, 400, parsed.error);

  const target = buildAdzunaUrl(parsed.query, { appId, appKey, country: env.ADZUNA_COUNTRY });

  // Cache key carries the normalised search only, never the credentials.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = cache
    ? new Request("https://adzuna-cache.invalid/?" + new URLSearchParams({
        k: parsed.query.keywords.toLowerCase(), l: parsed.query.location.toLowerCase(),
        p: String(parsed.query.page), n: String(parsed.query.pageSize), s: parsed.query.sort
      }).toString())
    : null;
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return ok(json, origin, await hit.json(), true);
    } catch (_) {}
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(target, { headers: { Accept: "application/json" }, signal: controller.signal });
  } catch (err) {
    console.warn("adzuna fetch failed", err && err.name);
    return fail(json, origin, 504, "Job search took too long. Please try again.");
  } finally {
    clearTimeout(timer);
  }

  // Never log the request URL: it contains the App ID and App Key.
  const text = await response.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}

  if (response.status === 401 || response.status === 403) {
    console.error("adzuna rejected credentials", response.status);
    return fail(json, origin, 502, "Job search is temporarily unavailable.");
  }
  if (response.status === 429) {
    console.warn("adzuna rate limit reached");
    return fail(json, origin, 503, "Job search is busy right now. Please try again in a minute.");
  }
  if (!response.ok) {
    console.warn("adzuna http error", response.status);
    return fail(json, origin, 502, "Job search is temporarily unavailable.");
  }

  let result;
  try {
    result = mapAdzunaResponse(data, parsed.query.page, parsed.query.pageSize);
  } catch (err) {
    console.warn("adzuna reply rejected", err && err.message);
    return fail(json, origin, 502, "Job search is temporarily unavailable.");
  }

  if (cache) {
    try {
      await cache.put(cacheKey, new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_SECONDS}` }
      }));
    } catch (_) {}
  }
  return ok(json, origin, result, false);
}

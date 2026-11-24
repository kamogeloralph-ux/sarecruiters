import { runWatchdog } from "./watchdog.js";
import * as Sentry from "@sentry/cloudflare";
import { candidateCvKey, cvProfileCorrections, evaluateCvScan, findDuplicateCandidate, mergePositions, scanCvWithGemini } from "./cv-scan.js";
import { fetchProfile, listUntidied, pairPositions, similarPosition, splitTitles, tidyCandidateById } from "./cv-tidy.js";
import { handleAiRequest, readPosterCached, runAiMaintenance } from "./ai-routes.js";
import { adzunaSearchResponse } from "./adzuna.js";
import { putCached } from "./ai.js";
import { publishTipchatVacancyRoundup } from "./tipchat-publisher.js";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var MAX_PHOTO_BYTES = 3 * 1024 * 1024;
var MAX_TRACK_BYTES = 25 * 1024 * 1024;
var MAX_POSTER_BYTES = 5 * 1024 * 1024;
var VACANCY_RECONCILE_INTERVAL_SECONDS = 86400;
var PROVINCE_LOCATION_TERMS = {
  gauteng: ["gauteng", "johannesburg", "joburg", "pretoria", "centurion", "sandton", "randburg", "midrand", "benoni", "kempton park", "eastrand", "roodepoort", "krugersdorp"],
  "western-cape": ["western cape", "cape town", "stellenbosch", "paarl", "george", "mossel bay", "bellville", "worcester"],
  "kwazulu-natal": ["kwazulu natal", "kwazulu-natal", "durban", "pietermaritzburg", "richards bay", "newcastle", "ballito"],
  "eastern-cape": ["eastern cape", "eastern-cape", "gqeberha", "port elizabeth", "east london", "mthatha", "uitenhage", "komani", "queenstown", "bhisho"],
  "free-state": ["free state", "free-state", "bloemfontein", "welkom", "bethlehem", "kroonstad", "sasolburg", "harrismith"],
  limpopo: ["limpopo", "polokwane", "thohoyandou", "mokopane", "tzaneen", "lephalale", "musina"],
  mpumalanga: ["mpumalanga", "mbombela", "nelspruit", "witbank", "emalahleni", "middelburg", "secunda", "ermelo"],
  "north-west": ["north west", "north-west", "rustenburg", "mahikeng", "mafikeng", "klerksdorp", "potchefstroom", "brits", "vryburg"],
  "northern-cape": ["northern cape", "northern-cape", "kimberley", "upington", "kuruman", "de aar", "springbok", "kathu"]
};
// Browsers on these origins may call the API. Anything else gets no
// Access-Control-Allow-Origin header, so another website cannot read responses
// with a visitor's token. Add more with the ALLOWED_ORIGINS variable
// (comma-separated, e.g. "https://admin.example.co.za").
let extraAllowedOrigins = [];
function configureCors(env) {
  extraAllowedOrigins = String((env && env.ALLOWED_ORIGINS) || "").split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
  try {
    const site = new URL((env && env.SITE_URL) || "https://sa-recruiters.co.za");
    extraAllowedOrigins.push(site.origin);
    extraAllowedOrigins.push(site.hostname.startsWith("www.") ? `${site.protocol}//${site.hostname.slice(4)}` : `${site.protocol}//www.${site.hostname}`);
  } catch (_) {}
}
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (extraAllowedOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;       // local dev and the installed app shell
    if (u.protocol === "https:" && (u.hostname === "sarecruiters.pages.dev" || u.hostname.endsWith(".sarecruiters.pages.dev"))) return true; // Pages production + previews
    if (u.protocol === "https:" && (u.hostname === "sa-recruiters.co.za" || u.hostname.endsWith(".sa-recruiters.co.za"))) return true;
  } catch (_) {}
  return false;
}
function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, cf-turnstile-response",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  // No Origin header = not a browser cross-site call (cron, curl, same-origin): harmless to answer "*".
  if (!origin) headers["Access-Control-Allow-Origin"] = "*";
  else if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
__name(corsHeaders, "corsHeaders");
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
  });
}
__name(json, "json");
async function isAdminRequest(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token)
    return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": env.SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) return false;
    const user = await res.json().catch(() => null);
    if (!user?.id) return false;
    const adminRes = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": env.SUPABASE_ANON_KEY
      }
    });
    const admins = await adminRes.json().catch(() => []);
    return adminRes.ok && Array.isArray(admins) && admins.length > 0;
  } catch (e) {
    return false;
  }
}
__name(isAdminRequest, "isAdminRequest");
function isInternalSyncRequest(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!token && !!env.SUPABASE_SERVICE_ROLE_KEY && token === env.SUPABASE_SERVICE_ROLE_KEY;
}
__name(isInternalSyncRequest, "isInternalSyncRequest");
// Resolves the signed-in user's id from a verified Supabase access token, if
// one was sent. Used to stamp reports/suggestions with their submitter
// without ever trusting a user_id the client could put in the request body.
// Returns null (not an error) whenever there's no token, an invalid token,
// or the auth check fails for any reason — submissions stay optional-owner.
async function verifiedUserId(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": env.SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return (data && data.id) ? data.id : null;
  } catch (e) {
    return null;
  }
}
__name(verifiedUserId, "verifiedUserId");
// The duplicate check needs every CV Box row (phones are stored in free format,
// so they can only be compared after normalising in code). Paging through the
// whole table on every scan was slow and hammered Supabase when several CVs were
// scanned in a row, so the list is kept for a minute in this Worker instance.
// Only the service-role copy is cached; a per-user token never is.
const CV_BOX_CACHE_MS = 60000;
let cvBoxCache = { at: 0, rows: null };
async function existingCvBoxCandidates(request, env) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const key = serviceKey || env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key || (!serviceKey && !bearer)) return null;
  if (serviceKey && cvBoxCache.rows && Date.now() - cvBoxCache.at < CV_BOX_CACHE_MS) return cvBoxCache.rows;
  const rows = [];
  try {
    for (let offset = 0; ; offset += 1000) {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?select=id,full_name,contact_email,contact_phone,location,status&order=id.asc&limit=1000&offset=${offset}`, {
        headers: { apikey: key, Authorization: `Bearer ${serviceKey || bearer}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return null;
      const page = await response.json().catch(() => null);
      if (!Array.isArray(page)) return null;
      rows.push(...page);
      if (page.length < 1000) break;
    }
  } catch (error) {
    console.error("CV Box duplicate lookup failed", error);
    return null;
  }
  if (serviceKey) cvBoxCache = { at: Date.now(), rows };
  return rows;
}
__name(existingCvBoxCandidates, "existingCvBoxCandidates");
function randomKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
__name(randomKey, "randomKey");
// ---- Free business advertising applications (/advertise/) ----
const AD_REQUEST_MAX_FILE_BYTES = 5 * 1024 * 1024;
const AD_REQUEST_MAX_EMAIL_ATTACH_BYTES = 12 * 1024 * 1024;
function detectAdFileType(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: "webp", type: "image/webp" };
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: "pdf", type: "application/pdf" };
  return null;
}
__name(detectAdFileType, "detectAdFileType");
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
__name(bufferToBase64, "bufferToBase64");
function safeFileStem(value) {
  return String(value || "file").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
}
__name(safeFileStem, "safeFileStem");
// Best-effort per-user hourly upload cap (Cache API; per Cloudflare location). Fails open.
async function posterUploadAllowed(userId, limit = 10) {
  try {
    const cache = caches.default;
    const hour = Math.floor(Date.now() / 36e5);
    const key = new Request(`https://rate-limit.internal/employer-poster/${userId}/${hour}`);
    const hit = await cache.match(key);
    const count = hit ? parseInt(await hit.text(), 10) || 0 : 0;
    if (count >= limit) return false;
    await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": "max-age=3600" } }));
    return true;
  } catch (e) {
    return true;
  }
}
__name(posterUploadAllowed, "posterUploadAllowed");
async function tipchatImageUploadAllowed(userId, limit = 30) {
  try {
    const hour = Math.floor(Date.now() / 3600000);
    const key = new Request(`https://rate-limit.internal/tipchat-image/${userId}/${hour}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= limit) return false;
    await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": "max-age=3700" } }));
    return true;
  } catch (e) {
    console.warn("tipchat image limiter unavailable", e);
    return true;
  }
}
__name(tipchatImageUploadAllowed, "tipchatImageUploadAllowed");
// Best-effort public-upload quota keyed by a one-way hash of Cloudflare's
// edge-provided client IP. Cache API limits are per-colo, but stop repeated
// abuse without retaining the raw address or blocking normal submissions.
async function publicUploadAllowed(request, limit = 12) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (!ip) return false;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const hour = Math.floor(Date.now() / 36e5);
    const cache = caches.default;
    const key = new Request(`https://rate-limit.internal/public-upload/${fingerprint}/${hour}`);
    const hit = await cache.match(key);
    const count = hit ? parseInt(await hit.text(), 10) || 0 : 0;
    if (count >= limit) return false;
    await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": "max-age=3600" } }));
    return true;
  } catch (e) {
    console.warn("public upload limiter unavailable", e);
    return false;
  }
}
__name(publicUploadAllowed, "publicUploadAllowed");
async function readUploadBytes(request, maxBytes) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (e) {}
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}
__name(readUploadBytes, "readUploadBytes");
function looksLikeJpeg(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
  return b.length === 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
__name(looksLikeJpeg, "looksLikeJpeg");

// ============================================================
//  Cloudflare Turnstile server-side verification.
//  The browser widget puts its answer token in a `cf-turnstile-response`
//  form field; the Worker must confirm it with Cloudflare before trusting
//  any public submission. If TURNSTILE_SECRET_KEY is not configured we
//  fail CLOSED for submissions that request enforcement (enforce !== false)
//  so a missing secret can never silently disable spam protection.
// ============================================================
async function verifyTurnstile(request, env, origin, enforce = true) {
  const token =
    request.headers.get("cf-turnstile-response") ||
    (await readTurnstileFromBody(request));
  if (!env.TURNSTILE_SECRET_KEY) {
    return enforce
      ? { ok: false, status: 503, error: "Spam protection is not configured." }
      : { ok: true };
  }
  if (!token) {
    return { ok: false, status: 400, error: "Spam check missing — please retry the form." };
  }
  try {
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token
    });
    if (request.headers.get("CF-Connecting-IP")) {
      body.set("remoteip", request.headers.get("CF-Connecting-IP"));
    }
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const data = await res.json();
    if (data && data.success) return { ok: true };
    return { ok: false, status: 403, error: "Spam check failed — please retry the form." };
  } catch (e) {
    return { ok: false, status: 502, error: "Spam check unavailable — please try again." };
  }
}
__name(verifyTurnstile, "verifyTurnstile");
// The JSON routes receive a body whose cf-turnstile-response field we must
// read BEFORE the handler consumes request.json(), so peek non-destructively:
// clone-free by re-reading the original request is not possible, so callers
// pass the form-encoded token in the `cf-turnstile-response` HEADER instead.
// This helper supports the legacy form-data style only.
async function readTurnstileFromBody(request) {
  try {
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const field = form.get("cf-turnstile-response");
      return typeof field === "string" ? field : null;
    }
  } catch (e) {
  }
  return null;
}
__name(readTurnstileFromBody, "readTurnstileFromBody");

// ============================================================
//  Supabase RPC proxy — calls a Postgres function with the anon key.
//  The authorization logic for these public flows lives IN the database as
//  SECURITY DEFINER functions (see supabase/migrations/20260918_lock_down_manager_tokens.sql).
//  This helper intentionally uses only the anon key; aggregate manager metrics
//  use the separate service-role-only helper below.
// ============================================================
async function supabaseRpc(env, fnName, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (e) {
  }
  if (!res.ok) {
    const err = new Error(`RPC ${fnName} failed (${res.status})`);
    err.status = res.status;
    err.detail = typeof body === "string" ? body : JSON.stringify(body);
    throw err;
  }
  return body;
}
__name(supabaseRpc, "supabaseRpc");

// This separate path is reserved for aggregate manager analytics. Its SQL RPC
// independently revalidates the manager token and is executable only by the
// service_role; raw analytics rows and visitor identifiers never leave SQL.
async function supabaseServiceRpc(env, fnName, args) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase service-role key is unavailable");
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch (e) {}
  if (!res.ok) {
    const err = new Error(`Service RPC ${fnName} failed (${res.status})`);
    err.status = res.status;
    err.detail = typeof body === "string" ? body : JSON.stringify(body);
    throw err;
  }
  return body;
}
__name(supabaseServiceRpc, "supabaseServiceRpc");

async function managerVacancyAnalytics(env, token, kind) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const rows = await supabaseServiceRpc(env, "manager_vacancy_analytics", {
      p_token: token,
      p_kind: kind
    });
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => {
      const clicks = Number(row && row.apply_clicks);
      const applications = Number(row && row.self_reported_applications);
      return {
        vacancy_id: String(row && row.vacancy_id || ""),
        apply_clicks: Number.isFinite(clicks) ? Math.max(0, Math.floor(clicks)) : 0,
        self_reported_applications: Number.isFinite(applications) ? Math.max(0, Math.floor(applications)) : 0
      };
    }).filter((row) => row.vacancy_id);
  } catch (e) {
    console.error("manager vacancy analytics unavailable", kind, e.status || "error");
    return null;
  }
}
__name(managerVacancyAnalytics, "managerVacancyAnalytics");

// ---------- CV Box partner access (agencies, from their private Manager Link) ----------
// The Manager Link token only says WHICH agency is asking. Candidate data is returned only when an
// admin has switched that agency to cv_box_partner. Contact reveals and CV downloads are logged
// and capped per agency per 24 hours (see 20261117_cv_box_partner_access.sql).
const CV_PARTNER_DAILY_LIMIT = 150;
const CV_PARTNER_PAGE_SIZE = 20;
async function cvBoxPartnerFromToken(env, token) {
  if (typeof token !== "string" || token.length < 8 || token.length > 200) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { const e = new Error("not configured"); e.status = 503; throw e; }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/manager_cv_box_partner`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token })
  });
  if (!res.ok) { const e = new Error("partner lookup failed"); e.status = 502; throw e; }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
__name(cvBoxPartnerFromToken, "cvBoxPartnerFromToken");
function cvBoxServiceHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...(extra || {}) };
}
__name(cvBoxServiceHeaders, "cvBoxServiceHeaders");
async function cvBoxPartnerActionsToday(env, agencyId) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const q = new URLSearchParams({ select: "id", agency_id: `eq.${agencyId}`, created_at: `gte.${since}` });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cv_box_partner_access_log?${q}`, {
    headers: cvBoxServiceHeaders(env, { Prefer: "count=exact", Range: "0-0" })
  });
  const range = res.headers.get("content-range") || "";
  const total = parseInt(range.split("/")[1], 10);
  return Number.isFinite(total) ? total : 0;
}
__name(cvBoxPartnerActionsToday, "cvBoxPartnerActionsToday");
async function cvBoxPartnerLog(env, partner, candidateId, action) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/cv_box_partner_access_log`, {
      method: "POST",
      headers: cvBoxServiceHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ agency_id: String(partner.id), agency_name: String(partner.name || "").slice(0, 200), candidate_id: String(candidateId), action })
    });
  } catch (e) { console.error("cv box partner log failed", e && e.message); }
}
__name(cvBoxPartnerLog, "cvBoxPartnerLog");
// Reads a stored candidate CV (R2 candidate-cvs/ or this project's public Supabase storage) with the same
// location and size limits as the paid-download path. Returns { bytes, contentType, ext } or { error, status }.
async function cvBoxFetchStoredCv(env, cvUrl) {
  try {
    const source = new URL(cvUrl);
    const ext = (String(cvUrl).match(/\.(pdf|png|jpe?g)(?:\?|$)/i) || ["", "pdf"])[1].toLowerCase();
    const publicBase = env.R2_PUBLIC_BASE_URL ? new URL(env.R2_PUBLIC_BASE_URL) : null;
    if (publicBase && source.origin === publicBase.origin && source.pathname.startsWith(`${publicBase.pathname.replace(/\/$/, "")}/candidate-cvs/`)) {
      const key = decodeURIComponent(source.pathname.slice(publicBase.pathname.replace(/\/$/, "").length + 1));
      if (!/^candidate-cvs\/[A-Za-z0-9._-]+\.(pdf|png|jpe?g)$/i.test(key)) return { error: "Invalid CV location", status: 404 };
      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) return { error: "CV file is no longer available", status: 404 };
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength > 4 * 1024 * 1024) return { error: "CV file is too large", status: 413 };
      return { bytes, contentType: object.httpMetadata?.contentType || "application/octet-stream", ext };
    }
    if (source.origin === new URL(env.SUPABASE_URL).origin && source.pathname.startsWith("/storage/v1/object/public/")) {
      const response = await fetch(source.href, { redirect: "error" });
      if (!response.ok) return { error: "CV file is no longer available", status: 404 };
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 4 * 1024 * 1024) return { error: "CV file is too large", status: 413 };
      return { bytes, contentType: response.headers.get("Content-Type") || "application/octet-stream", ext };
    }
    return { error: "CV storage location is not supported", status: 404 };
  } catch (e) {
    console.error("partner CV retrieval failed", e && e.message);
    return { error: "CV file is temporarily unavailable", status: 502 };
  }
}
__name(cvBoxFetchStoredCv, "cvBoxFetchStoredCv");
async function managerAgencyMarketingPreference(env, token) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const rows = await supabaseServiceRpc(env, "get_agency_vacancy_email_preference", { p_token: token });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    return { email: String(row.agency_email || ""), opted_in: row.opted_in === true };
  } catch (e) {
    console.error("manager outreach preference unavailable", e.status || "error");
    return null;
  }
}
__name(managerAgencyMarketingPreference, "managerAgencyMarketingPreference");

// ============================================================
//  Transactional email via Resend. RESEND_API_KEY is a wrangler secret; the
//  browser never sees it. Email is best-effort: a failure is logged and
//  reported in the response but never blocks the database insert.
// ============================================================
const EMAIL_MAX_BODY = 8000;
const DEFAULT_EMAIL_FROM = "SA Recruiters <notifications@sa-recruiters.co.za>";
const EMAIL_LOGO_URL = "https://sa-recruiters.co.za/icons/v2-icon-192.png";
function escapeEmailHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}
__name(escapeEmailHtml, "escapeEmailHtml");
function notificationEmailHtml(payload) {
  const title = escapeEmailHtml(payload.notification_title || "Notification");
  const type = escapeEmailHtml(payload.notification_type || "Submission");
  const intro = escapeEmailHtml(payload.notification_intro || "A new notification has been received through SA Recruiters.");
  const body = escapeEmailHtml(payload.notification_body || "-").slice(0, EMAIL_MAX_BODY);
  const when = escapeEmailHtml(payload.submit_date || new Date().toLocaleString("en-ZA", { dateStyle: "full", timeStyle: "short" }));
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f1f8;font-family:Arial,Helvetica,sans-serif;color:#1f1b2d">
<div style="padding:28px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e6e1ef;border-radius:18px;overflow:hidden">
    <tr><td style="background:#5b2ca0;padding:26px 28px;color:#ffffff">
      <img src="${EMAIL_LOGO_URL}" alt="SA Recruiters" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:12px;background:#ffffff;margin:0 0 16px;border:0">
      <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;opacity:.82">SA Recruiters</div>
      <div style="font-size:25px;line-height:1.25;font-weight:800;margin-top:8px">${title}</div>
      <div style="font-size:13px;line-height:1.5;margin-top:8px;opacity:.9">${type}</div>
    </td></tr>
    <tr><td style="padding:28px">
      <p style="font-size:16px;line-height:1.55;margin:0 0 20px;color:#312a40">${intro}</p>
      <div style="background:#faf8fd;border:1px solid #e8e0f4;border-radius:12px;padding:20px;white-space:pre-line;font-size:14px;line-height:1.7;color:#40384e">${body}</div>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#756b83">Received via SA Recruiters<br>${when}</p>
    </td></tr>
  </table>
</div>
</body></html>`;
}
__name(notificationEmailHtml, "notificationEmailHtml");
async function sendNotificationEmail(env, payload) {
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }
  // Resend only permits arbitrary recipients from a verified domain. Do not
  // fall back to onboarding@resend.dev, which is limited to the account owner.
  const from = env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [payload.to_email],
        subject: payload.email_subject || "SA Recruiters notification",
        html: notificationEmailHtml(payload),
        ...(payload.reply_to ? { reply_to: payload.reply_to } : {}),
        ...(Array.isArray(payload.attachments) && payload.attachments.length ? { attachments: payload.attachments } : {})
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("resend send failed", res.status, detail);
      return { sent: false, reason: `resend ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("resend send error", e);
    return { sent: false, reason: e.message };
  }
}
__name(sendNotificationEmail, "sendNotificationEmail");

function outreachUnsubscribePage(message, status = 200, token = "") {
  const form = token ? `<form method="post" action="?token=${encodeURIComponent(token)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form>` : "";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SA Recruiters email preferences</title><body style="margin:0;background:#f4f1f8;color:#211b2a;font:16px/1.55 Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:28px;background:#fff;border:1px solid #e6dfef;border-radius:18px"><h1 style="margin-top:0">SA Recruiters email preferences</h1><p>${message}</p>${form}<p style="font-size:13px;color:#6f6879">You can close this page after your preference is saved.</p></main></body></html>`;
  return new Response(html, { status, headers: {
    "Content-Type": "text/html; charset=UTF-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  } });
}
__name(outreachUnsubscribePage, "outreachUnsubscribePage");

async function agencyOutreachUnsubscribeResponse(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return outreachUnsubscribePage("This unsubscribe link is invalid or incomplete.", 400);
  }
  if (request.method === "GET") {
    return outreachUnsubscribePage("To stop the monthly free-listing reminders, select the button below. Opening this page alone does not change your email preferences.", 200, token);
  }
  if (request.method !== "POST") return outreachUnsubscribePage("This request is not supported.", 405);
  try {
    const changed = await supabaseServiceRpc(env, "unsubscribe_agency_vacancy_email", { p_unsubscribe_token: token });
    return outreachUnsubscribePage(changed === true ? "You have been unsubscribed from monthly agency vacancy reminders." : "This link has already been used, or the preference is no longer active. No further action is needed.");
  } catch (e) {
    console.error("agency outreach unsubscribe unavailable", e.status || "error");
    return outreachUnsubscribePage("We could not update your preference right now. Please try again later.", 503);
  }
}
__name(agencyOutreachUnsubscribeResponse, "agencyOutreachUnsubscribeResponse");

async function sendAgencyVacancyOutreachEmail(env, recipient, campaignMonth) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "email service unavailable" };
  const email = String(recipient.recipient_email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { sent: false, reason: "invalid recipient" };
  const siteUrl = new URL(env.SITE_URL || "https://sa-recruiters.co.za");
  const managerUrl = new URL(siteUrl.pathname || "/", siteUrl.origin);
  managerUrl.searchParams.set("manage", String(recipient.manager_token || ""));
  const unsubscribeUrl = new URL("/api/unsubscribe/agency", env.WORKER_URL || "https://sarecruiters-uploader.kamogeloralph.workers.dev");
  unsubscribeUrl.searchParams.set("token", String(recipient.unsubscribe_token || ""));
  const agency = String(recipient.agency_name || "Agency").slice(0, 120);
  const subject = "Share your agency vacancies for free on SA Recruiters";
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f4f1f8;font:16px/1.6 Arial,sans-serif;color:#241d30"><main style="max-width:620px;margin:auto;padding:28px;background:#fff;border:1px solid #e6dfef;border-radius:16px"><p>Hi ${escapeEmailHtml(agency)} team,</p><p>You can list your agency's current vacancies on SA Recruiters for free. Add or update your listings using your private manager link:</p><p><a href="${escapeEmailHtml(managerUrl.toString())}" style="display:inline-block;padding:12px 18px;background:#5b2ca0;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold">Manage your listings</a></p><p>Your manager link is unique to your agency. Keep it private and do not forward it.</p><p>You are receiving this monthly reminder because your agency opted in. If you don't want any more monthly reminders, <a href="${escapeEmailHtml(unsubscribeUrl.toString())}">unsubscribe here</a>.</p><p>SA Recruiters<br><a href="${escapeEmailHtml(siteUrl.origin)}">${escapeEmailHtml(siteUrl.origin)}</a></p></main></body></html>`;
  const text = `Hi ${agency} team,\n\nYou can list your agency's current vacancies on SA Recruiters for free. Add or update your listings using your private manager link:\n\nManage your listings: ${managerUrl.toString()}\n\nYour manager link is unique to your agency. Keep it private and do not forward it.\n\nYou are receiving this monthly reminder because your agency opted in. If you don't want any more monthly reminders, unsubscribe here: ${unsubscribeUrl.toString()}\n\nSA Recruiters\n${siteUrl.origin}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${campaignMonth}:${recipient.agency_id}`));
  const idempotency = `agency-outreach-${campaignMonth}-${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24)}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
        to: [email],
        subject,
        html,
        text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl.toString()}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        }
      })
    });
    if (!res.ok) {
      console.error("agency outreach send failed", res.status);
      return { sent: false, reason: `resend ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("agency outreach send error", e && e.name || "error");
    return { sent: false, reason: "email delivery error" };
  }
}
__name(sendAgencyVacancyOutreachEmail, "sendAgencyVacancyOutreachEmail");
async function sendSubmissionStatusEmail(env, { to, name, kind, status }) {
  const recipient = String(to || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return;
  const labels = {
    job: { new: "received", approved: "approved for review", contacted: "marked as contacted", rejected: "closed", resolved: "completed" },
    seeker: { new: "received", contacted: "marked as contacted", added: "added to the CV Box", closed: "closed" }
  };
  const description = labels[kind] && labels[kind][status];
  if (!description) return;
  const submission = kind === "job" ? "job-post request" : "job-seeker request";
  const result = await sendNotificationEmail(env, {
    to_email: recipient,
    email_subject: `SA Recruiters | Update on your ${submission}`,
    notification_title: "Your request has an update",
    notification_type: "SA Recruiters submission update",
    notification_intro: `Hi${name ? ` ${String(name).slice(0, 120)}` : ""}, your ${submission} has been ${description}.`,
    notification_body: "Thank you for contacting SA Recruiters. If you need help, reply to this email."
  });
  if (!result.sent) console.warn("submission status email not sent", kind, result.reason || "unknown reason");
}
__name(sendSubmissionStatusEmail, "sendSubmissionStatusEmail");
function publicUrlFor(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${key}`;
}
__name(publicUrlFor, "publicUrlFor");
// Raised from 600/1800 (10 min / 30 min) — the 10-minute fresh window meant
// any steady trickle of traffic (real visitors, crawlers, uptime monitors)
// kept this endpoint refreshing from Supabase up to ~144x/day, a fixed
// egress cost that barely depended on actual visitor count. 1 hour fresh /
// 3 hour stale-while-revalidate keeps the same 3x ratio but cuts that
// refresh cadence ~6x. Trade-off: a brand-new visitor can wait up to an
// hour (worst case) to see an agency/vacancy edit, instead of 10 minutes —
// existing visitors already tolerate up to 30 minutes of staleness today
// via the background-refresh branch below, so this is a difference of
// degree, not a new kind of staleness.
var STARTUP_CACHE_TTL = 3600;
var STARTUP_STALE_TTL = 10800;
var PUBLIC_STARTUP_SNAPSHOT_KEY = "snapshots/public-startup-v2-employer-vacancies.json";
var PUBLIC_VACANCY_SNAPSHOT_KEY = "snapshots/public-vacancies-v1.json";
var PUBLIC_POSTERS_SNAPSHOT_KEY = "snapshots/public-posters-v1.json";
var PUBLIC_HOUSE_ADS_SNAPSHOT_KEY = "snapshots/public-house-ads-v1.json";
async function readPublicStartupSnapshot(env) {
  if (!env.MEDIA_BUCKET) return null;
  try {
    const object = await env.MEDIA_BUCKET.get(PUBLIC_STARTUP_SNAPSHOT_KEY);
    if (!object) return null;
    return JSON.parse(await object.text());
  } catch (e) {
    console.warn("Could not read public R2 startup snapshot", e);
    return null;
  }
}
__name(readPublicStartupSnapshot, "readPublicStartupSnapshot");
async function writePublicStartupSnapshot(env, payload) {
  if (!env.MEDIA_BUCKET) return false;
  await env.MEDIA_BUCKET.put(PUBLIC_STARTUP_SNAPSHOT_KEY, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=300" },
    customMetadata: { generated_at: payload.generated_at || new Date().toISOString() }
  });
  return true;
}
__name(writePublicStartupSnapshot, "writePublicStartupSnapshot");
async function readPublicVacancySnapshot(env) {
  if (!env.MEDIA_BUCKET) return null;
  try {
    const object = await env.MEDIA_BUCKET.get(PUBLIC_VACANCY_SNAPSHOT_KEY);
    if (!object) return null;
    const payload = JSON.parse(await object.text());
    return payload && Array.isArray(payload.vacancies) ? payload : null;
  } catch (e) {
    console.warn("Could not read public R2 vacancy snapshot", e);
    return null;
  }
}
__name(readPublicVacancySnapshot, "readPublicVacancySnapshot");
async function writePublicVacancySnapshot(env, payload) {
  if (!env.MEDIA_BUCKET) return false;
  await env.MEDIA_BUCKET.put(PUBLIC_VACANCY_SNAPSHOT_KEY, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=300" },
    customMetadata: { generated_at: payload.generated_at || new Date().toISOString() }
  });
  return true;
}
__name(writePublicVacancySnapshot, "writePublicVacancySnapshot");
async function readPublicJsonSnapshot(env, key, field) {
  if (!env.MEDIA_BUCKET) return null;
  try {
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) return null;
    const payload = JSON.parse(await object.text());
    return payload && Array.isArray(payload[field]) ? payload : null;
  } catch (e) {
    console.warn(`Could not read public R2 ${field} snapshot`, e);
    return null;
  }
}
__name(readPublicJsonSnapshot, "readPublicJsonSnapshot");
async function writePublicJsonSnapshot(env, key, field, rows, dataVersion = 0) {
  if (!env.MEDIA_BUCKET) return false;
  const payload = { generated_at: new Date().toISOString(), data_version: dataVersion, [field]: rows || [] };
  await env.MEDIA_BUCKET.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=300" },
    customMetadata: { generated_at: payload.generated_at }
  });
  return true;
}
__name(writePublicJsonSnapshot, "writePublicJsonSnapshot");
async function bootstrapPublicAuxiliarySnapshot(env, kind) {
  const isPosters = kind === "posters";
  const now = new Date().toISOString();
  const result = await supabaseGet(env, isPosters ? "employer_posters" : "house_ads", isPosters ? {
    select: "id,employer_id,agency_id,image_url,caption,vacancy_id,created_at,expires_at",
    or: `(expires_at.is.null,expires_at.gt.${now})`, order: "created_at.desc", limit: "500"
  } : {
    select: "id,advertiser_name,title,message,image_url,target_url,placement,target_screens,ad_slot,sort_order,ad_format,ad_details,cta_text,starts_at,ends_at,is_active,created_at,updated_at",
    is_active: "eq.true", starts_at: `lte.${now}`, or: `(ends_at.is.null,ends_at.gt.${now})`, order: "sort_order.asc,created_at.desc", limit: "50"
  });
  const rows = Array.isArray(result.body) ? result.body : [];
  await writePublicJsonSnapshot(env, isPosters ? PUBLIC_POSTERS_SNAPSHOT_KEY : PUBLIC_HOUSE_ADS_SNAPSHOT_KEY, kind === "posters" ? "posters" : "ads", rows, 0);
  return rows;
}
__name(bootstrapPublicAuxiliarySnapshot, "bootstrapPublicAuxiliarySnapshot");
async function buildPublicVacancySnapshot(env) {
  const columns = [
    "id", "agency_id", "employer_id", "title", "company", "company_photo",
    "location", "closing_date", "notes", "link", "email", "phone", "remote",
    "experience_level", "employment_type", "contract_type", "work_schedule",
    "hours", "salary", "start_date", "created_at", "source_type", "ats_feed_id"
  ];
  const result = await env.DB.prepare(`SELECT ${columns.join(",")} FROM vacancies ORDER BY created_at DESC, id DESC`).all();
  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const live = (result.results || []).filter((row) => {
    const raw = String(row.closing_date || '').trim();
    if (!raw) return true;
    const parsed = Date.parse(raw);
    // Preserve rows with an unrecognised closing-date format; the client and
    // admin use the same conservative rule for dates they cannot parse.
    return Number.isNaN(parsed) || parsed >= startOfToday;
  });
  return { generated_at: new Date().toISOString(), vacancies: live };
}
__name(buildPublicVacancySnapshot, "buildPublicVacancySnapshot");
async function buildPublicVacancySnapshotFromSupabase(env) {
  const columns = [
    "id", "agency_id", "employer_id", "title", "company", "company_photo",
    "location", "closing_date", "notes", "link", "email", "phone", "remote",
    "experience_level", "employment_type", "contract_type", "work_schedule",
    "hours", "salary", "start_date", "created_at", "source_type"
  ].join(",");
  const atsColumns = `${columns},ats_feed_id`;
  const rows = await supabaseGetAll(env, "vacancies", {
    select: columns,
    order: "created_at.desc,id.desc"
  }, 1000);
  // Scrapers (Adzuna, Himalayas, Jooble, learnerships...) store an EMPTY STRING, not NULL, when a job
  // has no closing date, so a PostgREST "closing_date.is.null OR >= today" filter silently dropped
  // every one of them. Filter here instead: keep rows with no closing date or one still in the future.
  const today = new Date().toISOString().slice(0, 10);
  const live = (rows || []).filter((row) => {
    const closingDate = publicClosingDate(row.closing_date);
    return !closingDate || closingDate >= today;
  });
  // ATS rows live only in D1. Merge them into the Supabase-authoritative
  // snapshot so external feed jobs use the same public app surface.
  let atsRows = [];
  try {
    const atsResult = await env.DB.prepare(`SELECT ${atsColumns} FROM vacancies WHERE ats_feed_id IS NOT NULL`).all();
    atsRows = (atsResult.results || []).filter((row) => {
      const closingDate = publicClosingDate(row.closing_date);
      return !closingDate || closingDate >= today;
    });
  } catch (e) {
    console.warn("Could not load ATS vacancies for public snapshot", e);
  }
  const seen = new Set((live || []).map((row) => String(row.id)));
  return { generated_at: new Date().toISOString(), vacancies: [...(live || []), ...atsRows.filter((row) => !seen.has(String(row.id))) ] };
}
__name(buildPublicVacancySnapshotFromSupabase, "buildPublicVacancySnapshotFromSupabase");
var STARTUP_VACANCY_PAGE_SIZE = 1e3;
var STARTUP_DEDICATED_SOURCES = [
  "himalayas",
  "adzuna",
  "retail",
  "shoprite",
  "picknpay",
  "woolworths",
  "truworths",
  "spar",
  "career_board",
  "bizcommunity",
  "remotive",
  "realworkfromanywhere",
  "himalayas-rss"
];
function supabaseRestUrl(env, table, params = {}) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return url;
}
__name(supabaseRestUrl, "supabaseRestUrl");
async function supabaseGet(env, table, params = {}, options = {}) {
  const response = await fetch(supabaseRestUrl(env, table, params), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      ...options.prefer ? { Prefer: options.prefer } : {}
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${table} query failed (${response.status})`);
  }
  return { body, headers: response.headers };
}
__name(supabaseGet, "supabaseGet");
async function supabaseGetAll(env, table, params = {}, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await supabaseGet(env, table, {
      ...params,
      limit: String(pageSize),
      offset: String(offset)
    });
    const page = Array.isArray(result.body) ? result.body : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
__name(supabaseGetAll, "supabaseGetAll");

// Incremental mirror writer. It writes in bounded D1 batches and suppresses
// no-op updates so unchanged rows do not consume write quota.
async function upsertD1Rows(env, table, columns, rows, boolCols = [], conflictColumn = "id") {
  if (!rows.length) return 0;
  const placeholders = `(${columns.map(() => "?").join(",")})`;
  const updateColumns = columns.filter((column) => column !== conflictColumn);
  const changedPredicate = updateColumns.map((column) => `${column} IS NOT excluded.${column}`).join(" OR ");
  const upsertSql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders} ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updateColumns.map((column) => `${column}=excluded.${column}`).join(",")} WHERE ${changedPredicate}`;
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const stmts = chunk.map((row) => {
      const values = columns.map((col) => {
        const v = row[col];
        if (boolCols.includes(col)) return v ? 1 : 0;
        if (v === void 0) return null;
        if (v !== null && typeof v === "object") return JSON.stringify(v);
        return v;
      });
      return env.DB.prepare(upsertSql).bind(...values);
    });
    if (stmts.length) {
      await env.DB.batch(stmts);
      written += stmts.length;
    }
  }
  return written;
}
__name(upsertD1Rows, "upsertD1Rows");

// Synchronizes a keyed table without deleting and reinserting unchanged rows.
// The local-key read is intentionally narrow; it lets us remove records that
// disappeared from Supabase while keeping normal sync cycles write-efficient.
async function syncD1Table(env, table, columns, rows, boolCols = [], keyColumn = "id", reconcile = false) {
  const incoming = rows || [];
  const incomingKeys = new Set(incoming.map((row) => String(row[keyColumn])));
  let staleKeys = [];
  if (reconcile) {
    const local = await env.DB.prepare(`SELECT ${keyColumn} FROM ${table}`).all();
    staleKeys = (local.results || []).map((row) => String(row[keyColumn])).filter((key) => !incomingKeys.has(key));
  }
  for (let i = 0; i < staleKeys.length; i += 200) {
    const chunk = staleKeys.slice(i, i + 200);
    await env.DB.batch(chunk.map((key) => env.DB.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`).bind(key)));
  }
  const written = await upsertD1Rows(env, table, columns, incoming, boolCols, keyColumn);
  return { written, deleted: staleKeys.length };
}
__name(syncD1Table, "syncD1Table");

async function readSyncMeta(env, key) {
  const result = await env.DB.prepare("SELECT value FROM sync_meta WHERE key = ? LIMIT 1").bind(key).all();
  return result.results?.[0]?.value || null;
}
__name(readSyncMeta, "readSyncMeta");
const PUBLIC_DATA_VERSION_KEY = "public_data_version";
const MIRROR_RECONCILE_INTERVAL_SECONDS = 86400;
async function readPublicDataVersion(env) {
  try {
    const raw = await readSyncMeta(env, PUBLIC_DATA_VERSION_KEY);
    const value = Number.parseInt(raw || "0", 10);
    // Epoch 1 invalidates the prior public startup/cache generation after the
    // CV Box snapshot removal, even before the first D1 reconciliation runs.
    return Number.isSafeInteger(value) && value >= 0 ? value + 1 : 1;
  } catch (error) { return 0; }
}
__name(readPublicDataVersion, "readPublicDataVersion");
function publicDataVersionBumpStatement(env) {
  return env.DB.prepare("INSERT INTO sync_meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(sync_meta.value AS INTEGER) + 1 AS TEXT)").bind(PUBLIC_DATA_VERSION_KEY);
}
__name(publicDataVersionBumpStatement, "publicDataVersionBumpStatement");
async function mirrorManagerVacancy(env, vacancy) {
  if (!env.DB) return false;
  const columns = ["id", "agency_id", "employer_id", "title", "company", "location", "closing_date", "notes", "link", "email", "phone", "remote", "experience_level", "employment_type", "contract_type", "work_schedule", "hours", "salary", "start_date", "created_at", "source_type"];
  const values = columns.map((column) => vacancy[column] ?? null);
  const placeholders = columns.map(() => "?").join(",");
  const updates = columns.filter((column) => column !== "id").map((column) => `${column}=excluded.${column}`).join(",");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO vacancies (${columns.join(",")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`).bind(...values),
    publicDataVersionBumpStatement(env)
  ]);
  return true;
}
__name(mirrorManagerVacancy, "mirrorManagerVacancy");
async function bumpPublicDataVersion(env) {
  await publicDataVersionBumpStatement(env).run();
  return await readPublicDataVersion(env);
}
__name(bumpPublicDataVersion, "bumpPublicDataVersion");
const D1_WRITE_THROUGH_SPECS = {
  agencies: { key: "id", columns: ["id", "name", "website", "contact", "email", "location", "address", "cvpref", "photo", "companies", "trades", "verified", "created_at"], boolColumns: ["verified"] },
  branches: { key: "id", columns: ["id", "agency_id", "name", "location", "phone", "email"], boolColumns: [] },
  vacancies: { key: "id", columns: ["id", "agency_id", "employer_id", "title", "company", "company_photo", "location", "closing_date", "notes", "link", "email", "phone", "remote", "experience_level", "employment_type", "contract_type", "work_schedule", "hours", "salary", "start_date", "created_at", "updated_at", "source_type", "is_featured", "featured_until", "featured_order"], boolColumns: ["is_featured"] },
  employers: { key: "id", columns: ["id", "name", "industry", "website", "contact", "email", "location", "address", "photo", "verified", "created_at"], boolColumns: ["verified"] },
  app_settings: { key: "key", columns: ["key", "value"], boolColumns: [] },
  employer_posters: { key: "id", columns: ["id", "employer_id", "agency_id", "image_url", "caption", "vacancy_id", "created_at", "expires_at"], boolColumns: [] },
  // This projection deliberately excludes candidate contacts, CV links, and admin fields.
  pool_candidates: { key: "id", columns: ["id", "full_name", "position", "sector", "location", "experience_years", "about_you", "skills", "banner_url", "photo_url", "verified", "status", "created_at"], boolColumns: ["verified"] },
  house_ads: { key: "id", columns: ["id", "advertiser_name", "title", "message", "image_url", "target_url", "placement", "target_screens", "ad_slot", "ad_format", "ad_details", "cta_text", "starts_at", "ends_at", "is_active", "sort_order", "impressions", "clicks", "created_at", "updated_at"], boolColumns: ["is_active"] }
};
function prepareD1WriteThroughUpsert(env, table, spec, columns, row) {
  const updateColumns = columns.filter((column) => column !== spec.key);
  const changedPredicate = updateColumns.map((column) => `${column} IS NOT excluded.${column}`).join(" OR ");
  const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(${spec.key}) DO UPDATE SET ${updateColumns.map((column) => `${column}=excluded.${column}`).join(",")} WHERE ${changedPredicate}`;
  const values = columns.map((column) => {
    const value = row[column];
    if (spec.boolColumns.includes(column)) return value === true || value === 1 || String(value).toLowerCase() === "true" ? 1 : 0;
    if (table === "app_settings" && column === "value" && typeof value === "boolean") return value ? "true" : "false";
    if (value === void 0) return null;
    if (value !== null && typeof value === "object") return JSON.stringify(value);
    return value;
  });
  return env.DB.prepare(sql).bind(...values);
}
__name(prepareD1WriteThroughUpsert, "prepareD1WriteThroughUpsert");

async function reconcileDeletedVacancies(env) {
  const liveRows = await supabaseGetAll(env, "vacancies", { select: "id", order: "id.asc" }, 1000);
  const liveIds = new Set((liveRows || []).map((row) => String(row.id)));
  const local = await env.DB.prepare("SELECT id FROM vacancies WHERE ats_feed_id IS NULL").all();
  const staleIds = (local.results || []).map((row) => String(row.id)).filter((id) => !liveIds.has(id));
  for (let i = 0; i < staleIds.length; i += 200) {
    const chunk = staleIds.slice(i, i + 200);
    await env.DB.batch(chunk.map((id) => env.DB.prepare("DELETE FROM vacancies WHERE id = ?").bind(id)));
  }
  return staleIds.length;
}
__name(reconcileDeletedVacancies, "reconcileDeletedVacancies");
async function recordSyncFailure(env, error) {
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
      .bind("sync_status", JSON.stringify({ status: "failed", failed_at: (/* @__PURE__ */ new Date()).toISOString(), error: String(error?.message || error).slice(0, 500) })).run();
  } catch (metaError) { console.error("Could not record sync failure", metaError); }
  try { await bumpPublicDataVersion(env); } catch (versionError) { console.error("Could not bump public data version after sync failure", versionError); }
}
__name(recordSyncFailure, "recordSyncFailure");

// Pulls the full current state of every table the app reads for browsing
// (not just the startup-filtered subset) from Supabase and mirrors it into
// D1. This is the ONLY thing that still costs Supabase egress for these
// tables -- it runs on the cron schedule in wrangler.toml (and can be
// triggered manually via POST /api/sync-d1), not on every visitor request.
async function syncD1FromSupabase(env) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
    .bind("sync_status", JSON.stringify({ status: "running", started_at: startedAt })).run();
  const vacancyColumns = [
    "id", "agency_id", "employer_id", "title", "company", "company_photo",
    "location", "closing_date", "notes", "link", "email", "phone", "remote",
    "experience_level", "employment_type", "contract_type", "work_schedule",
    "hours", "salary", "start_date", "created_at", "updated_at", "source_type"
  ];
  // The featured columns are additive and may lag behind this Worker while
  // the production D1 quota is exhausted. Detect the schema so the mirror
  // remains safe before migration and includes them automatically afterward.
  let hasFeaturedColumns = false;
  try {
    const schema = await env.DB.prepare("PRAGMA table_info(vacancies)").all();
    const names = new Set((schema.results || []).map((column) => column.name));
    hasFeaturedColumns = names.has("is_featured") && names.has("featured_until") && names.has("featured_order");
  } catch (e) {
    console.warn("Could not inspect D1 vacancy schema; syncing legacy columns", e);
  }
  if (hasFeaturedColumns) {
    vacancyColumns.push("is_featured", "featured_until", "featured_order");
  }
  const [agencies, branches, vacancies, employers, pool, settings, posters, houseAds] = await Promise.all([
    supabaseGet(env, "agencies", {
      select: "id,name,website,contact,email,location,address,cvpref,photo,companies,trades,verified,created_at",
      order: "created_at.desc"
    }),
    supabaseGet(env, "branches", {
      select: "id,agency_id,name,location,phone,email",
      order: "name.asc"
    }),
    // Vacancies are mirrored incrementally below using updated_at. The other
    // directory tables remain full-replaced for now because they are small.
    Promise.resolve(null),
    supabaseGet(env, "employers", {
      select: "id,name,industry,website,contact,email,location,address,photo,verified,created_at",
      order: "created_at.desc"
    }),
    // Deliberately the public, already-redacted view -- same privacy
    // boundary the client relies on (see the comment above the client-side
    // pool_candidates_public query in app-sheets.js). Never sync the raw,
    // admin-only pool_candidates table into this D1 database.
    supabaseGet(env, "pool_candidates_public", {
      select: "id,full_name,position,sector,location,experience_years,about_you,skills,photo_url,verified,status,created_at",
      order: "created_at.desc"
    }),
    supabaseGet(env, "app_settings", { select: "key,value" }),
    supabaseGet(env, "employer_posters", {
      select: "id,employer_id,agency_id,image_url,caption,vacancy_id,created_at,expires_at",
      order: "created_at.desc",
      limit: "500"
    }),
    supabaseGet(env, "house_ads", {
      select: "id,advertiser_name,title,message,image_url,target_url,placement,target_screens,ad_slot,ad_format,ad_details,cta_text,starts_at,ends_at,is_active,sort_order,impressions,clicks,created_at,updated_at",
      order: "sort_order.asc,created_at.desc",
      limit: "200"
    })
  ]);

  const lastMirrorReconciledAt = Number(await readSyncMeta(env, "mirror_last_reconciled_at") || 0);
  const reconcileMirror = !lastMirrorReconciledAt || (Date.now() - lastMirrorReconciledAt) >= MIRROR_RECONCILE_INTERVAL_SECONDS * 1000;

  const agenciesSync = await syncD1Table(env, "agencies",
    ["id", "name", "website", "contact", "email", "location", "address", "cvpref", "photo", "companies", "trades", "verified", "created_at"],
    agencies.body || [], ["verified"], "id", reconcileMirror);
  const branchesSync = await syncD1Table(env, "branches",
    ["id", "agency_id", "name", "location", "phone", "email"],
    branches.body || [], [], "id", reconcileMirror);
  const previousVacancySync = await readSyncMeta(env, "vacancies_updated_through");
  const vacancyParams = { select: vacancyColumns.join(","), order: "updated_at.asc,id.asc" };
  if (previousVacancySync) {
    vacancyParams.updated_at = `gt.${previousVacancySync}`;
  }
  const vacancyResult = await supabaseGetAll(env, "vacancies", vacancyParams, 1000);
  const changedVacancies = vacancyResult || [];
  const vacancyWrites = await upsertD1Rows(env, "vacancies", vacancyColumns, changedVacancies, hasFeaturedColumns ? ["is_featured"] : []);
  const lastReconciledAt = Number(await readSyncMeta(env, "vacancies_last_reconciled_at") || 0);
  const shouldReconcileVacancies = !lastReconciledAt || (Date.now() - lastReconciledAt) >= VACANCY_RECONCILE_INTERVAL_SECONDS * 1000;
  const vacancyDeletes = shouldReconcileVacancies ? await reconcileDeletedVacancies(env) : 0;
  if (shouldReconcileVacancies) {
    await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
      .bind("vacancies_last_reconciled_at", String(Date.now())).run();
  }
  const vacancyWatermark = changedVacancies.length
    ? changedVacancies[changedVacancies.length - 1].updated_at
    : previousVacancySync;
  if (vacancyWatermark) {
    await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
      .bind("vacancies_updated_through", vacancyWatermark).run();
  }
  const employersSync = await syncD1Table(env, "employers",
    ["id", "name", "industry", "website", "contact", "email", "location", "address", "photo", "verified", "created_at"],
    employers.body || [], ["verified"], "id", reconcileMirror);
  const poolSync = await syncD1Table(env, "pool_candidates",
    ["id", "full_name", "position", "sector", "location", "experience_years", "about_you", "skills", "photo_url", "verified", "status", "created_at"],
    pool.body || [], ["verified"], "id", reconcileMirror);
  const settingsSync = await syncD1Table(env, "app_settings", ["key", "value"], settings.body || [], [], "key", reconcileMirror);
  const postersSync = await syncD1Table(env, "employer_posters",
    ["id", "employer_id", "agency_id", "image_url", "caption", "vacancy_id", "created_at", "expires_at"],
    posters.body || [], [], "id", reconcileMirror);
  const houseAdsSync = await syncD1Table(env, "house_ads",
    ["id", "advertiser_name", "title", "message", "image_url", "target_url", "placement", "target_screens", "ad_slot", "ad_format", "ad_details", "cta_text", "starts_at", "ends_at", "is_active", "sort_order", "impressions", "clicks", "created_at", "updated_at"],
    houseAds.body || [], ["is_active"], "id", reconcileMirror);
  if (reconcileMirror) {
    await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
      .bind("mirror_last_reconciled_at", String(Date.now())).run();
  }

  const summary = {
    synced_at: (/* @__PURE__ */ new Date()).toISOString(),
    agencies: (agencies.body || []).length,
    agency_writes: agenciesSync.written,
    agency_deletes: agenciesSync.deleted,
    branches: (branches.body || []).length,
    branch_writes: branchesSync.written,
    branch_deletes: branchesSync.deleted,
    vacancies: changedVacancies.length,
    vacancy_writes: vacancyWrites,
    vacancy_deletes: vacancyDeletes,
    employers: (employers.body || []).length,
    employer_writes: employersSync.written,
    employer_deletes: employersSync.deleted,
    pool_candidates: (pool.body || []).length,
    pool_candidate_writes: poolSync.written,
    pool_candidate_deletes: poolSync.deleted,
    settings_writes: settingsSync.written,
    settings_deletes: settingsSync.deleted,
    posters: (posters.body || []).length,
    poster_writes: postersSync.written,
    poster_deletes: postersSync.deleted,
    house_ads: (houseAds.body || []).length,
    house_ad_writes: houseAdsSync.written,
    house_ad_deletes: houseAdsSync.deleted
  };
  await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
    .bind("last_sync", JSON.stringify(summary)).run();
  await env.DB.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)")
    .bind("sync_status", JSON.stringify({ status: "success", ...summary })).run();
  return {
    ...summary,
    publicSnapshots: {
      posters: posters.body || [],
      houseAds: houseAds.body || []
    }
  };
}
__name(syncD1FromSupabase, "syncD1FromSupabase");
async function syncD1AndPublishSnapshot(env) {
  const syncResult = await syncD1FromSupabase(env);
  const publicSnapshots = syncResult.publicSnapshots || { posters: [], houseAds: [] };
  const { publicSnapshots: _ignoredSnapshots, ...summary } = syncResult;
  const dataVersion = env.DB ? await bumpPublicDataVersion(env) : 0;
  // syncD1FromSupabase has just refreshed the local mirror. Build both public
  // snapshots from D1 so a six-hour sync does not re-read Supabase for startup
  // counts, folder counts, province counts, employer counts, and every vacancy
  // page a second time. The previous Supabase-heavy publication pass was the
  // remaining source of the production "Too many subrequests" failure.
  const payload = await loadStartupDataFromD1(env);
  payload.data_version = dataVersion;
  // Admin vacancy browsing and public publication now share the same refreshed
  // mirror, including rows whose updated_at is NULL.
  const vacancySnapshot = await buildPublicVacancySnapshot(env);
  vacancySnapshot.data_version = dataVersion;
  await Promise.all([
    writePublicStartupSnapshot(env, payload),
    writePublicVacancySnapshot(env, vacancySnapshot),
    writePublicJsonSnapshot(env, PUBLIC_POSTERS_SNAPSHOT_KEY, "posters", publicSnapshots.posters, dataVersion),
    writePublicJsonSnapshot(env, PUBLIC_HOUSE_ADS_SNAPSHOT_KEY, "ads", publicSnapshots.houseAds, dataVersion)
  ]);
  return { ...summary, data_version: dataVersion, snapshot: "r2", snapshot_generated_at: payload.generated_at, vacancy_snapshot_rows: vacancySnapshot?.vacancies?.length || 0 };
}
__name(syncD1AndPublishSnapshot, "syncD1AndPublishSnapshot");

// Publish only scraper-owned sources. The full mirror rebuilds startup data
// with many Supabase requests and can exceed the Worker subrequest limit.
async function publishFocusedScraperSources(env) {
  const sourceTypes = ["bizcommunity"];
  const columns = "id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type";
  const sourceRows = await supabaseGetAll(env, "vacancies", {
    select: columns,
    source_type: `in.(${sourceTypes.join(",")})`,
    order: "created_at.desc,id.desc"
  }, 1000);
  const today = new Date().toISOString().slice(0, 10);
  const liveSourceRows = (sourceRows || []).filter((row) => {
    const closingDate = publicClosingDate(row.closing_date);
    return !closingDate || closingDate >= today;
  });
  const previousVacancySnapshot = await readPublicVacancySnapshot(env);
  if (!previousVacancySnapshot) throw new Error("Public vacancy snapshot is unavailable for focused publication");
  const sourceSet = new Set(sourceTypes);
  const unrelatedRows = (previousVacancySnapshot.vacancies || [])
    .filter((row) => !sourceSet.has(String(row.source_type || "")));
  const vacancySnapshot = {
    ...previousVacancySnapshot,
    generated_at: new Date().toISOString(),
    vacancies: [...unrelatedRows, ...liveSourceRows]
  };
  const startupSnapshot = await readPublicStartupSnapshot(env);
  if (!startupSnapshot || !startupSnapshot.counts) throw new Error("Public startup snapshot is unavailable for focused publication");
  const bizcommunityCount = (sourceRows || []).filter((row) => String(row.source_type) === "bizcommunity").length;
  const startupPayload = {
    ...startupSnapshot,
    generated_at: new Date().toISOString(),
    counts: {
      ...startupSnapshot.counts,
      dedicated: {
        ...(startupSnapshot.counts.dedicated || {}),
        bizcommunity: bizcommunityCount
      }
    }
  };
  const dataVersion = env.DB ? await bumpPublicDataVersion(env) : 0;
  startupPayload.data_version = dataVersion;
  vacancySnapshot.data_version = dataVersion;
  await Promise.all([
    writePublicStartupSnapshot(env, startupPayload),
    writePublicVacancySnapshot(env, vacancySnapshot)
  ]);
  return {
    data_version: dataVersion,
    snapshot: "r2-focused",
    source_rows: sourceRows.length,
    published_rows: liveSourceRows.length,
    dedicated: { bizcommunity: bizcommunityCount }
  };
}
__name(publishFocusedScraperSources, "publishFocusedScraperSources");

// ---------------------------------------------------------------------------
// ATS feed integration. ATS vacancies are stored in the existing D1 vacancies
// table and identified by (ats_feed_id, external_ref); no jobs table is used.
function atsXmlDecode(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#([0-9]+);?/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
__name(atsXmlDecode, "atsXmlDecode");
function atsXmlField(xml, names) {
  for (const name of names) {
    const re = new RegExp(String.raw`<(?:(?:[\w-]+):)?${name}\b[^>]*>([\s\S]*?)<\/(?:(?:[\w-]+):)?${name}>`, "i");
    const match = String(xml || "").match(re);
    if (match) return atsXmlDecode(match[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}
__name(atsXmlField, "atsXmlField");
function atsDescriptionValue(description, pattern) {
  const match = String(description || "").match(pattern);
  return match ? String(match[1] || "").trim() : "";
}
__name(atsDescriptionValue, "atsDescriptionValue");
function parseAtsXml(xml) {
  const source = String(xml || "");
  const matches = [...source.matchAll(/<(?:(?:[\w-]+):)?(job|item|entry)\b[^>]*>([\s\S]*?)<\/(?:(?:[\w-]+):)?\1>/gi)];
  return matches.map((match) => {
    const item = match[2];
    const link = atsXmlField(item, ["url", "link", "apply_url", "application_url"]) || ((item.match(/<link\b[^>]*href=["']([^"']+)["']/i) || [])[1] || "");
    const ref = atsXmlField(item, ["external_ref", "externalRef", "id", "guid", "reference", "job_id"]) || link;
    const title = atsXmlField(item, ["title", "name", "job_title"]);
    const description = atsXmlField(item, ["description", "summary", "content:encoded", "content"]);
    const descriptionParts = description.split(/\s*[·|]\s*/).map((part) => part.trim()).filter(Boolean);
    const country = atsXmlField(item, ["country", "countries"]);
    const region = atsXmlField(item, ["region", "territory", "eligibility"]);
    const companyFromTitle = title.includes(":") ? title.split(":", 1)[0].trim() : "";
    const closingFromDescription = atsDescriptionValue(description, /(?:closing\s+date|closes?)\s*:?[\s,]*(?:\w+\s+)?(\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
    const salaryFromDescription = atsDescriptionValue(description, /(R\s?[\d\s,.]+(?:per annum|p\.a\.|pm|per month)?)/i);
    return {
      external_ref: ref,
      title,
      company: atsXmlField(item, ["company", "company_name", "employer", "organisation"]) || companyFromTitle || descriptionParts[0] || "",
      location: atsXmlField(item, ["location", "city", "job_location"]) || country || region || descriptionParts[1] || "",
      description,
      link,
      closing_date: atsXmlField(item, ["closing_date", "close_date", "expires", "expiry_date"]) || closingFromDescription,
      employment_type: atsXmlField(item, ["employment_type", "job_type", "type"]),
      salary: atsXmlField(item, ["salary", "salary_range", "pay"]) || salaryFromDescription,
      remote: atsXmlField(item, ["remote", "work_from_home"]) || "false",
      region: [region, country, description].filter(Boolean).join(" ")
    };
  }).filter((job) => job.external_ref && job.title);
}
__name(parseAtsXml, "parseAtsXml");
function atsDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw.slice(0, 40) : new Date(parsed).toISOString().slice(0, 10);
}
__name(atsDate, "atsDate");
function atsJobFilterText(job) {
  return [job?.title, job?.location, job?.company, job?.region, job?.description]
    .filter(Boolean).join(" ").toLowerCase();
}
__name(atsJobFilterText, "atsJobFilterText");
function atsJobMatchesFilters(job, includes = [], excludes = []) {
  const filterText = atsJobFilterText(job);
  const excluded = excludes.some((term) => filterText.includes(String(term).toLowerCase()));
  const included = !includes.length || includes.some((term) => filterText.includes(String(term).toLowerCase()));
  return !excluded && included;
}
__name(atsJobMatchesFilters, "atsJobMatchesFilters");
function atsBool(value) { return ["1", "true", "yes", "y"].includes(String(value || "").toLowerCase()); }
__name(atsBool, "atsBool");
async function upsertAtsVacancy(env, feed, job) {
  const now = new Date().toISOString();
  const id = `ats_${String(feed.id)}_${String(job.external_ref).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;
  const closing = atsDate(job.closing_date);
  const notes = job.description || null;
  const sql = `INSERT INTO vacancies (id, agency_id, title, company, location, closing_date, notes, link, remote, employment_type, salary, created_at, updated_at, source_type, external_ref, ats_feed_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ats_feed_id, external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET title=excluded.title, company=excluded.company, location=excluded.location, closing_date=excluded.closing_date, notes=excluded.notes, link=excluded.link, remote=excluded.remote, employment_type=excluded.employment_type, salary=excluded.salary, updated_at=excluded.updated_at, source_type=excluded.source_type`;
  const sourceType = ["remotive", "realworkfromanywhere", "himalayas-rss"].includes(String(feed.id)) ? "remote" : "ats";
  const isRemote = sourceType === "remote" || atsBool(job.remote);
  await env.DB.prepare(sql).bind(id, feed.agency_id, job.title, job.company || feed.agency_name, job.location || null, closing || null, notes, job.link || null, isRemote ? 1 : 0, job.employment_type || null, job.salary || null, now, now, sourceType, job.external_ref, feed.id).run();
  return id;
}
__name(upsertAtsVacancy, "upsertAtsVacancy");
async function syncOneAtsFeed(env, feed) {
  if (!feed.feed_url) return { feed_id: feed.id, skipped: "missing feed URL", jobs: 0 };
  const response = await fetch(feed.feed_url, { headers: { "user-agent": "SA-Recruiters-ATS-Sync/1.0" } });
  if (!response.ok) throw new Error(`ATS feed ${feed.id} returned HTTP ${response.status}`);
  const configuredIncludes = (() => { try { return JSON.parse(feed.include_terms || "[]"); } catch (_) { return []; } })();
  const configuredExcludes = (() => { try { return JSON.parse(feed.exclude_terms || "[]"); } catch (_) { return []; } })();
  const jobs = parseAtsXml(await response.text()).filter((job) => atsJobMatchesFilters(job, configuredIncludes, configuredExcludes));
  const active = [];
  for (const job of jobs) { await upsertAtsVacancy(env, feed, job); active.push(job.external_ref); }
  // Keep the stale-reference cleanup below D1's bound-variable limit. Large
  // feeds still import and update successfully; their stale rows are left
  // untouched until a smaller/dedicated cleanup run.
  if (active.length && active.length <= 100) {
    const placeholders = active.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE vacancies SET closing_date = ?, updated_at = ? WHERE ats_feed_id = ? AND external_ref NOT IN (${placeholders}) AND (closing_date IS NULL OR closing_date >= ?)`)
      .bind(new Date().toISOString().slice(0, 10), new Date().toISOString(), feed.id, ...active, new Date().toISOString().slice(0, 10)).run();
  } else if (jobs.length === 0) {
    // A successful empty feed is valid, but a failed feed never reaches here.
    await env.DB.prepare("UPDATE vacancies SET closing_date = ?, updated_at = ? WHERE ats_feed_id = ? AND (closing_date IS NULL OR closing_date >= ?)")
      .bind(new Date().toISOString().slice(0, 10), new Date().toISOString(), feed.id, new Date().toISOString().slice(0, 10)).run();
  }
  await env.DB.prepare("UPDATE agency_ats_feeds SET last_synced_at = ?, last_status = ? WHERE id = ?").bind(new Date().toISOString(), `ok:${jobs.length}`, feed.id).run();
  return { feed_id: feed.id, jobs: jobs.length };
}
__name(syncOneAtsFeed, "syncOneAtsFeed");
async function syncAtsFeeds(env) {
  const rows = await env.DB.prepare("SELECT id, agency_id, agency_name, feed_url, api_key_hash, include_terms, exclude_terms FROM agency_ats_feeds WHERE is_active = 1").all();
  const results = [];
  for (const feed of rows.results || []) {
    try { results.push(await syncOneAtsFeed(env, feed)); }
    catch (error) { await env.DB.prepare("UPDATE agency_ats_feeds SET last_synced_at = ?, last_status = ? WHERE id = ?").bind(new Date().toISOString(), `error:${String(error.message || error).slice(0, 220)}`, feed.id).run(); results.push({ feed_id: feed.id, error: String(error.message || error) }); }
  }
  return results;
}
__name(syncAtsFeeds, "syncAtsFeeds");
function atsAuthMatches(request, env, querySecret = "") {
  const configured = env.ATS_SYNC_SECRET || env.ADMIN_SECRET || "";
  const bearer = request.headers.get("authorization") || "";
  return Boolean(configured && ((querySecret && querySecret === configured) || bearer === `Bearer ${configured}`));
}
__name(atsAuthMatches, "atsAuthMatches");
async function handleAtsPush(request, env, origin) {
  if (!atsAuthMatches(request, env)) return json({ ok: false, error: "Unauthorized" }, 401, origin);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400, origin); }
  const feedId = String(body.feed_id || body.ats_feed_id || "");
  const externalRef = String(body.external_ref || body.externalRef || body.id || "");
  const title = String(body.title || body.name || "").trim();
  if (!feedId || !externalRef || !title) return json({ ok: false, error: "feed_id, external_ref and title are required" }, 400, origin);
  const feed = await env.DB.prepare("SELECT id, agency_id, agency_name FROM agency_ats_feeds WHERE id = ? AND is_active = 1").bind(feedId).first();
  if (!feed) return json({ ok: false, error: "Unknown or inactive ATS feed" }, 400, origin);
  if (String(body.action || "upsert").toLowerCase() === "close") {
    await env.DB.prepare("UPDATE vacancies SET closing_date = ?, updated_at = ? WHERE ats_feed_id = ? AND external_ref = ?").bind(new Date().toISOString().slice(0, 10), new Date().toISOString(), feedId, externalRef).run();
    return json({ ok: true, status: "closed", external_ref: externalRef }, 200, origin);
  }
  const id = await upsertAtsVacancy(env, feed, { external_ref: externalRef, title, company: body.company, location: body.location, description: body.description || body.notes, link: body.link || body.url, closing_date: body.closing_date, employment_type: body.employment_type, salary: body.salary, remote: body.remote });
  return json({ ok: true, id, external_ref: externalRef, status: "active" }, 200, origin);
}
__name(handleAtsPush, "handleAtsPush");

// Same STARTUP_DEDICATED_SOURCES exclusion loadStartupData() applies via
// Supabase's `source_type=not.in.(...)`, replicated as a SQL WHERE clause
// against the local D1 mirror -- zero Supabase egress either way, since D1
// reads never touch Supabase at all.
async function loadD1StartupAggregates(env, dedicated) {
  const placeholders = dedicated.map(() => "?").join(",");
  const feedAgencyIds = ["himalayas-rss", "remotive", "realworkfromanywhere", "weworkremotely", "bizcommunity-sa", "govposts", "govposts-sa", "topjobseeker", "topjobseeker-sa", "myjobmag"];
  const feedAgencyPlaceholders = feedAgencyIds.map(() => "?").join(",");
  const [general, generalPool, genericAts, dedicatedCount, employerCounts, total] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM vacancies WHERE (agency_id IS NULL OR agency_id = 'general') AND employer_id IS NULL AND source_type IS NULL"),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM vacancies WHERE employer_id IS NULL AND COALESCE(source_type, '') NOT IN (${placeholders}) AND COALESCE(ats_feed_id, '') NOT IN (${placeholders}) AND COALESCE(agency_id, '') NOT IN (${feedAgencyPlaceholders})`).bind(...dedicated, ...dedicated, ...feedAgencyIds),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM vacancies WHERE employer_id IS NULL AND source_type = 'ats' AND COALESCE(ats_feed_id, '') = '' AND COALESCE(agency_id, '') NOT IN (${feedAgencyPlaceholders})`).bind(...feedAgencyIds),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM vacancies WHERE source_type IN (${placeholders})`).bind(...dedicated),
    env.DB.prepare("SELECT employer_id, COUNT(*) AS n FROM vacancies WHERE employer_id IS NOT NULL GROUP BY employer_id"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM vacancies")
  ]);
  const first = (result) => result?.results?.[0] || {};
  return {
    general: Number(first(general).n || 0),
    generalPool: Number(first(generalPool).n || 0) + Number(first(genericAts).n || 0),
    dedicated: Number(first(dedicatedCount).n || 0),
    total: Number(first(total).n || 0),
    employerCounts: Object.fromEntries((employerCounts?.results || []).map((row) => [row.employer_id, Number(row.n || 0)]))
  };
}
__name(loadD1StartupAggregates, "loadD1StartupAggregates");
async function loadD1FolderCounts(env, folders) {
  const expressions = Object.entries(folders).map(([key, sources]) => {
    const placeholders = sources.map(() => "?").join(",");
    return `SUM(CASE WHEN source_type IN (${placeholders}) THEN 1 ELSE 0 END) AS "${key}"`;
  });
  const values = Object.values(folders).flat();
  const result = await env.DB.prepare(`SELECT ${expressions.join(",")} FROM vacancies`).bind(...values).all();
  const row = result.results?.[0] || {};
  return Object.fromEntries(Object.keys(folders).map((key) => [key, Number(row[key] || 0)]));
}
__name(loadD1FolderCounts, "loadD1FolderCounts");
async function loadStartupDataFromD1(env) {
  const dedicated = STARTUP_DEDICATED_SOURCES;
  const dedicatedPlaceholders = dedicated.map(() => "?").join(",");
  const DEDICATED_FOLDERS = {
    himalayas: ["himalayas"],
    adzuna: ["adzuna"],
    retail: ["retail", "shoprite", "picknpay", "woolworths", "truworths", "spar"],
    bizcommunity: ["bizcommunity"],
    remotive: ["remotive", "realworkfromanywhere", "himalayas-rss"]
  };

  const [agenciesR, branchesR, vacanciesR, employersR, featuredVacanciesR, aggregates, folderCounts, provinceCounts] = await Promise.all([
    env.DB.prepare("SELECT * FROM agencies ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM branches ORDER BY name ASC").all(),
    // Keep dedicated feeds lazy for the general directory, but always include
    // employer-owned rows because the public Hiring Companies cards render
    // their vacancy lists from this startup payload. Employer postings may be
    // tagged with a dedicated source such as retail.
    env.DB.prepare(`SELECT * FROM vacancies WHERE (((agency_id IS NOT NULL AND agency_id != 'general') AND employer_id IS NULL) OR employer_id IS NOT NULL) AND (employer_id IS NOT NULL OR source_type IS NULL OR source_type NOT IN (${dedicatedPlaceholders})) ORDER BY created_at DESC LIMIT ${STARTUP_VACANCY_PAGE_SIZE}`).bind(...dedicated).all(),
    env.DB.prepare("SELECT * FROM employers ORDER BY created_at DESC").all(),
    // Older D1 mirrors may not have the optional featured columns yet. Keep
    // startup healthy until the mirror schema is upgraded.
    env.DB.prepare("SELECT * FROM vacancies WHERE is_featured = 1 ORDER BY featured_order ASC, created_at DESC LIMIT 12").all().catch(() => ({ results: [] })),
    loadD1StartupAggregates(env, dedicated),
    loadD1FolderCounts(env, DEDICATED_FOLDERS),
    loadProvinceCountsFromD1(env)
  ]);
  const employerCountMap = aggregates.employerCounts;
  return {
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    agencies: agenciesR.results || [],
    branches: branchesR.results || [],
    vacancies: vacanciesR.results || [],
    employers: (employersR.results || []).map((employer) => ({
      ...employer,
      vacancy_count: employerCountMap[employer.id] || 0
    })),
        featured_vacancies: (featuredVacanciesR.results || []).filter((v) => !v.featured_until || new Date(v.featured_until).getTime() >= Date.now()),
    counts: {
      agencies: (agenciesR.results || []).length,
      branches: (branchesR.results || []).length,
      // Platform total includes the general pool, attributed/startup rows,
      // and dedicated-source rows. Keep this mutually consistent with the
      // public `general` bucket instead of omitting generalPoolCount.
      // The active D1 mirror is the public read source. Do not query Supabase
      // just to refresh this headline count on every startup request.
      vacancies: aggregates.total,
      general: aggregates.general + aggregates.generalPool,
      employers: (employersR.results || []).length,
      candidates: 0,
      dedicated: folderCounts,
      provinces: provinceCounts
    },
    settings: {
      public_vacancy_posting: "false",
      public_employer_registration: "false",
      public_employer_directory: "true"
    }
  };
}
__name(loadStartupDataFromD1, "loadStartupDataFromD1");
async function loadProvinceCountsFromD1(env) {
  if (!env.DB) return {};
  const entries = Object.entries(PROVINCE_LOCATION_TERMS);
  const expressions = entries.map(([slug, terms]) => {
    const where = terms.map(() => "LOWER(COALESCE(location, '')) LIKE ?").join(" OR ");
    return `SUM(CASE WHEN ${where} THEN 1 ELSE 0 END) AS "${slug}"`;
  });
  const values = entries.flatMap(([, terms]) => terms.map((term) => `%${term.toLowerCase()}%`));
  const result = await env.DB.prepare(`SELECT ${expressions.join(",")} FROM vacancies`).bind(...values).all();
  const row = result.results?.[0] || {};
  return Object.fromEntries(entries.map(([slug]) => [slug, Number(row[slug] || 0)]));
}
__name(loadProvinceCountsFromD1, "loadProvinceCountsFromD1");
async function loadProvinceCountsFromSupabase(env) {
  const counts = await Promise.all(Object.entries(PROVINCE_LOCATION_TERMS).map(async ([slug, terms]) => {
    const results = await Promise.all(terms.map((term) =>
      supabaseGet(env, "vacancies", { select: "id", location: `ilike.*${term}*`, limit: "0" }, { prefer: "count=exact" })
        .then((response) => {
          const match = (response.headers.get("content-range") || "").match(/\/(\d+)$/);
          return match ? Number(match[1]) : 0;
        })
    ));
    return [slug, Math.max(...results, 0)];
  }));
  return Object.fromEntries(counts);
}
__name(loadProvinceCountsFromSupabase, "loadProvinceCountsFromSupabase");
// Public startup reads are D1/R2-only. Supabase is an ingest source for the
// scheduled mirror sync, never a browser-facing fallback.
async function loadStartupDataOrFallback(env) {
  if (!env.DB) return null;
  try {
    const check = await env.DB.prepare("SELECT COUNT(*) AS n FROM agencies").all();
    if ((check.results[0]?.n || 0) === 0) return null;
    return await loadStartupDataFromD1(env);
  } catch (e) {
    return null;
  }
}
__name(loadStartupDataOrFallback, "loadStartupDataOrFallback");
async function loadStartupData(env) {
  const vacancyColumns = [
    "id",
    "agency_id",
    "employer_id",
    "title",
    "company",
    "company_photo",
    "location",
    "closing_date",
    "notes",
    "link",
    "email",
    "phone",
    "remote",
    "experience_level",
    "employment_type",
    "contract_type",
    "work_schedule",
    "hours",
    "salary",
    "start_date",
    "created_at",
    "source_type",
    "is_featured",
    "featured_until",
    "featured_order"
  ].join(",");
  const vacancyFilter = `(${[
    "agency_id.neq.general",
    "employer_id.not.is.null",
    "source_type.not.is.null"
  ].join(",")})`;
  const dedicatedSources = `(${STARTUP_DEDICATED_SOURCES.join(",")})`;
  const readCountHeader = (headers) => {
    const range = headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);
    return match ? Number(match[1]) : 0;
  };
  // Folder groupings mirror the classifier functions in app-ui.js
  // (isHimalayasVacancy/isAdzunaVacancy/isGovernmentVacancy/isRetailVacancy/
  // isLearnershipVacancy) so these counts label the same folders the user sees.
  const DEDICATED_FOLDERS = {
    himalayas: ["himalayas"],
    adzuna: ["adzuna"],
    retail: ["retail", "shoprite", "picknpay", "woolworths", "truworths", "spar"],
    bizcommunity: ["bizcommunity"],
    remotive: ["remotive", "realworkfromanywhere", "himalayas-rss"]
  };
  const [agencies, branches, vacancies, employers, generalCount, generalPoolCount, genericAtsCount, poolCount, dedicatedCount, folderCounts, poolCandidates, featuredVacancies] = await Promise.all([
    supabaseGet(env, "agencies", {
      select: "id,name,website,contact,email,location,address,cvpref,photo,companies,trades,verified",
      order: "created_at.desc"
    }),
    supabaseGet(env, "branches", {
      select: "id,agency_id,name,location,phone,email",
      order: "name.asc"
    }),
    // Was a single supabaseGet() capped at limit: STARTUP_VACANCY_PAGE_SIZE (1000)
    // with no pagination -- once total agency/employer vacancies across the whole
    // platform passed 1000, everything past the most recent 1000 (ordered by
    // created_at desc) was silently dropped from every visitor's startup payload,
    // so agencies with older or less-recent postings showed incomplete lists.
    // supabaseGetAll() pages through all of them.
    //
    // The dedicated-source bulk (Himalayas/Adzuna/Government/Retail/
    // Learnerships -- ~95% of all vacancy rows) used to be fetched here too
    // and embedded whole in every visitor's startup payload (15MB+ and
    // growing with every scrape). Those folders now fetch their own pages
    // lazily via fetchDedicatedVacancyPage() in app-data.js, the same
    // pattern the "General Vacancies" folder already used -- startup only
    // needs their counts (folderCounts below) to label the folder cards.
    supabaseGet(env, "vacancies", {
      select: vacancyColumns,
      or: vacancyFilter,
      source_type: `not.in.${dedicatedSources}`,
      order: "created_at.desc",
      limit: String(STARTUP_VACANCY_PAGE_SIZE)
    }),
    supabaseGet(env, "employers", {
      select: "id,name,industry,website,contact,email,location,address,photo,verified",
      order: "created_at.desc"
    }),
    // STRICT general count (source_type IS NULL only). Used ONLY as an addend
    // in counts.vacancies below, alongside vacancies.length and
    // dedicatedCount -- those two already include every row that
    // has ANY source_type set (see vacancyFilter's source_type.not.is.null
    // branch), so this bucket must be the true, non-overlapping complement:
    // rows with no source_type at all. Using "not in dedicatedSources" here
    // instead would double-count every general-pool row scraped by a
    // non-dedicated source (careerjunction/jobmail/etc.) — that
    // was the original bug behind the admin/app vacancy-count mismatch.
    supabaseGet(env, "vacancies", {
      select: "id",
      or: "(agency_id.is.null,agency_id.eq.general)",
      employer_id: "is.null",
      source_type: "is.null",
      limit: "0"
    }, { prefer: "count=exact" }),
    // BROAD general-pool count, second half — matches the filter
    // fetchGeneralVacancyPage()/getGeneralVacancyCount() use client-side for
    // the actual "General Vacancies" tab. Postgres's NOT IN excludes NULL
    // source_type rows (NULL NOT IN (...) is NULL, not true), so this query
    // alone yields exactly the non-dedicated-source-tagged general rows —
    // added to generalCount (the NULL-source rows) just below, the sum is
    // the true general-pool size. Kept as two simple queries rather than one
    // combined OR expression because supabaseRestUrl() only keeps one value
    // per query-string key, so a single request can't carry two separate
    // `or=` filters here.
    supabaseGet(env, "vacancies", {
      select: "id",
      or: "(agency_id.is.null,agency_id.eq.general)",
      employer_id: "is.null",
      source_type: `not.in.${dedicatedSources}`,
      limit: "0"
    }, { prefer: "count=exact" }),
    supabaseGet(env, "vacancies", {
      select: "id",
      source_type: "eq.ats",
      employer_id: "is.null",
      limit: "0"
    }, { prefer: "count=exact" }),
    // pool_candidates itself is admin-only under RLS now (see
    // CREATE_POOL_PUBLIC_ACCESS.sql) -- counting it with the anon key here
    // always returned 0, which is why the home "Candidates" stat showed 0
    // until someone opened the CV Box screen (which queries the public
    // view directly and got the real number). Count the public view instead,
    // matching getPoolCandidateCount() on the client.
    supabaseGet(env, "pool_candidates_public", { select: "id", limit: "0" }, { prefer: "count=exact" }),
    // Grand total of every dedicated-source row (all 5 folders combined),
    // used only to keep counts.vacancies accurate now that those rows are
    // no longer fetched in full.
    supabaseGet(env, "vacancies", { select: "id", source_type: `in.${dedicatedSources}`, limit: "0" }, { prefer: "count=exact" }),
    // Per-folder counts, one lightweight indexed count query each (backed by
    // vacancies_source_created_at_idx), fired in parallel -- this is what
    // labels each folder card ("Government Vacancies · 5,936 vacancies")
    // without downloading a single row of their content.
    Promise.all(Object.entries(DEDICATED_FOLDERS).map(([key, sources]) =>
      supabaseGet(env, "vacancies", { select: "id", source_type: `in.(${sources.join(",")})`, limit: "0" }, { prefer: "count=exact" })
        .then((res) => [key, readCountHeader(res.headers)])
    )),
    supabaseGet(env, "pool_candidates_public", {
      select: "id,full_name,position,sector,location,experience_years,about_you,skills,photo_url,verified,status,created_at",
      order: "created_at.desc"
    }),
    supabaseGet(env, "vacancies", {
      select: vacancyColumns,
      is_featured: "eq.true",
      order: "featured_order.asc,created_at.desc",
      limit: "12"
    })
  ]);
  const provinceCounts = await loadProvinceCountsFromSupabase(env);
  // Keep employer card counts independent of the startup vacancy feed. The
  // feed intentionally omits dedicated-source rows, and a NULL source_type
  // can also be excluded by PostgREST's NOT IN semantics; neither should make
  // an employer's card appear to have zero vacancies.
  const employerVacancyCounts = await Promise.all((employers.body || []).map(async (employer) => {
    const result = await supabaseGet(env, "vacancies", {
      select: "id",
      employer_id: `eq.${employer.id}`,
      limit: "0"
    }, { prefer: "count=exact" });
    return [employer.id, readCountHeader(result.headers)];
  }));
  const employerCountMap = Object.fromEntries(employerVacancyCounts);
  const readCount = /* @__PURE__ */ __name((headers) => {
    const range = headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);
    return match ? Number(match[1]) : null;
  }, "readCount");
  return {
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    agencies: agencies.body || [],
    branches: branches.body || [],
    vacancies: vacancies.body || [],
    employers: (employers.body || []).map((employer) => ({
      ...employer,
      vacancy_count: employerCountMap[employer.id] || 0
    })),
        featured_vacancies: (featuredVacancies.body || []).filter((v) => !v.featured_until || new Date(v.featured_until).getTime() >= Date.now()),
    counts: {
      agencies: Array.isArray(agencies.body) ? agencies.body.length : 0,
      branches: Array.isArray(branches.body) ? branches.body.length : 0,
      vacancies: (readCount(generalCount.headers) ?? 0) + (Array.isArray(vacancies.body) ? vacancies.body.length : 0) + readCountHeader(dedicatedCount.headers),
      // The true "General Vacancies" tab size: NULL-source rows (generalCount)
      // plus non-dedicated-source rows (generalPoolCount). The client uses
      // this directly instead of inferring it from
      // (counts.vacancies - vacancies.length), which breaks whenever most of
      // the general pool has a non-null source_type (as it does here) — see
      // app-data.js loadAll() for the client-side half of this fix.
      general: (readCount(generalCount.headers) ?? 0) + (readCount(generalPoolCount.headers) ?? 0) + (readCount(genericAtsCount.headers) ?? 0),
      employers: Array.isArray(employers.body) ? employers.body.length : 0,
      candidates: 0,
      // Per-folder counts for the dedicated-source vacancy folders (Himalayas/
      // Adzuna/Government/Retail/Learnerships), which no longer ship their
      // rows in this payload -- see fetchDedicatedVacancyPage() client-side.
      dedicated: Object.fromEntries(folderCounts),
      provinces: provinceCounts
    },
    settings: {
      public_vacancy_posting: "false",
      public_employer_registration: "false",
      public_employer_directory: "true"
    }
  };
}
__name(loadStartupData, "loadStartupData");
const CV_BOX_SECTORS = new Set([
  "Accounting & Finance", "Administration & Office Support", "Agriculture & Farming",
  "Arts & Media", "Construction & Engineering", "Customer Service & Call Centre",
  "Education & Training", "Government & Public Sector", "Healthcare & Social Care",
  "Hospitality & Tourism", "Human Resources", "Information Technology", "Legal",
  "Logistics & Supply Chain", "Manufacturing & Production", "Marketing & Communications",
  "Retail & Sales", "Security & Safety", "Skilled Trades", "Transport & Driving", "Other"
].map((sector) => sector.toLowerCase()));
const CV_BOX_GENERIC_ROLES = new Set([
  "open to opportunities", "open to work", "any job", "any position", "looking for work",
  "cv box", "n/a", "not specified", "other"
]);
function cvBoxPublicSector(value) {
  const sector = String(value || "").trim();
  return sector.toLowerCase() === "cv box" ? "Other" : sector;
}
function cvBoxCandidateIsComplete(candidate) {
  const sector = cvBoxPublicSector(candidate.sector).toLowerCase();
  const role = String(candidate.position || "").trim();
  const location = String(candidate.location || "").trim();
  const experience = Number(candidate.experience_years);
  return CV_BOX_SECTORS.has(sector) && role.length >= 2 && role.length <= 80 &&
    /[a-z0-9]/i.test(role) && !CV_BOX_GENERIC_ROLES.has(role.toLowerCase()) &&
    !!location && location.toLowerCase() !== "south africa" &&
    candidate.experience_years !== null && candidate.experience_years !== undefined &&
    String(candidate.experience_years).trim() !== "" && Number.isFinite(experience) && experience >= 0;
}
async function cvBoxResponse(request, env, origin) {
  // Candidate profiles must never come from the startup snapshot or D1 mirror:
  // those are intentionally optimized/cached for general directory startup.
  // Read the redacted public view directly so deletions and approvals are live.
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "CV Box is temporarily unavailable" }, 503, origin);
  let result;
  try {
    result = await supabaseGet(env, "pool_candidates_public", {
      select: "id,full_name,position,sector,location,experience_years,about_you,skills,photo_url,verified,status,created_at",
      status: "eq.active",
      order: "created_at.desc",
      limit: "1000"
    });
  } catch (error) {
    console.error("CV Box live read failed", error);
    return json({ error: "CV Box could not be loaded" }, 502, origin);
  }
  if (!Array.isArray(result.body)) return json({ error: "CV Box returned an invalid response" }, 502, origin);
  let candidates = result.body
    .filter((row) => (row.status || "pending") === "active")
    .map((row) => ({ ...row, sector: cvBoxPublicSector(row.sector) }));
  // Availability and timestamps are deliberately omitted from the redacted
  // view. Read only these public-safe fields with the Worker service key; no
  // contact information or CV links ever leave this handler.
  if (env.SUPABASE_SERVICE_ROLE_KEY && candidates.length) {
    try {
      const q = new URLSearchParams({ select: "id,availability,profile_updated_at,availability_confirmed_at,availability_expires_at,banner_url", status: "eq.active", limit: "1000" });
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${q}`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
      });
      if (r.ok) {
        const rows = await r.json();
        const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
        const now = Date.now();
        for (const c of candidates) {
          const row = byId.get(String(c.id)) || {};
          const fallbackConfirmedAt = row.availability_confirmed_at || c.created_at || null;
          const derivedExpiresAt = fallbackConfirmedAt
            ? new Date(new Date(fallbackConfirmedAt).getTime() + 30 * 86400000).toISOString()
            : null;
          const expiresAt = row.availability_expires_at || derivedExpiresAt;
          c.availability = String(row.availability || "").trim().slice(0, 40);
          c.profile_updated_at = row.profile_updated_at || c.created_at || null;
          c.banner_url = typeof row.banner_url === "string" ? row.banner_url.trim().slice(0, 1000) : "";
          c.availability_confirmed_at = fallbackConfirmedAt;
          c.availability_expires_at = row.availability_expires_at || derivedExpiresAt;
          c.availability_current = String(c.availability).toLowerCase() === "immediately" &&
            (!expiresAt || Date.parse(expiresAt) > now);
          if (String(c.availability).toLowerCase() === "immediately" && !c.availability_current) {
            c.availability = "Needs reconfirmation";
          }
        }
      } else {
        console.warn("CV Box activity lookup failed", r.status);
        const legacyQ = new URLSearchParams({ select: "id,availability,banner_url", status: "eq.active", limit: "1000" });
        const legacyResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${legacyQ}`, {
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
        });
        if (legacyResponse.ok) {
          const legacyRows = await legacyResponse.json();
          const legacyById = new Map((Array.isArray(legacyRows) ? legacyRows : []).map((row) => [String(row.id), row]));
          const now = Date.now();
          for (const c of candidates) {
            const row = legacyById.get(String(c.id)) || {};
            const confirmedAt = c.created_at || null;
            const expiresAt = confirmedAt ? new Date(Date.parse(confirmedAt) + 30 * 86400000).toISOString() : null;
            c.availability = String(row.availability || "").trim().slice(0, 40);
            c.profile_updated_at = c.created_at || null;
            c.banner_url = typeof row.banner_url === "string" ? row.banner_url.trim().slice(0, 1000) : "";
            c.availability_confirmed_at = confirmedAt;
            c.availability_expires_at = expiresAt;
            c.availability_current = String(c.availability).toLowerCase() === "immediately" &&
              (!expiresAt || Date.parse(expiresAt) > now);
            if (String(c.availability).toLowerCase() === "immediately" && !c.availability_current) {
              c.availability = "Needs reconfirmation";
            }
          }
        }
      }
    } catch (error) { console.warn("CV Box availability lookup failed", error); }
  }
  const now = Date.now();
  candidates = candidates.filter((candidate) => {
    // Active status is the administrator's explicit publication decision.
    // Do not apply the scanner's completeness rules a second time here: older
    // approved profiles and profiles with reviewed warnings must remain visible.
    if (String(candidate.availability || "").toLowerCase() !== "immediately") return true;
    const confirmedAt = candidate.availability_confirmed_at || candidate.created_at;
    if (!confirmedAt) return true;
    const expiresAt = candidate.availability_expires_at || new Date(Date.parse(confirmedAt) + 30 * 86400000).toISOString();
    candidate.availability_current = Date.parse(expiresAt) > now;
    if (!candidate.availability_current) candidate.availability = "Needs reconfirmation";
    return true;
  });
  return new Response(JSON.stringify({ candidates, count: candidates.length, generated_at: new Date().toISOString() }), {
    status: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "CDN-Cache-Control": "no-store", "X-CV-Box-Source": "supabase-live" }
  });
}
__name(cvBoxResponse, "cvBoxResponse");
const CV_DOWNLOAD_MAX_CENTS = 1000000;
function yocoSecretKey(env) {
  return env.YOCO_LIVE_SECRET_KEY || env.YOCO_SECRET_KEY || "";
}
__name(yocoSecretKey, "yocoSecretKey");
function validCustomerEmail(value) {
  const email = String(value || "").trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
__name(validCustomerEmail, "validCustomerEmail");
function cvCheckoutSite(env) {
  try {
    const parsed = new URL(env.SITE_URL || "https://sa-recruiters.co.za");
    if (parsed.protocol !== "https:") return "https://sa-recruiters.co.za";
    return parsed.origin;
  } catch (e) {
    return "https://sa-recruiters.co.za";
  }
}
__name(cvCheckoutSite, "cvCheckoutSite");
function cvWorkerBase(env) {
  try {
    const parsed = new URL(env.WORKER_URL || "https://sarecruiters-uploader.kamogeloralph.workers.dev");
    if (parsed.protocol !== "https:") return "https://sarecruiters-uploader.kamogeloralph.workers.dev";
    return parsed.origin;
  } catch (e) {
    return "https://sarecruiters-uploader.kamogeloralph.workers.dev";
  }
}
__name(cvWorkerBase, "cvWorkerBase");
async function cvCheckoutAllowed(request) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const hour = Math.floor(Date.now() / 36e5);
    const key = new Request(`https://rate-limit.internal/cv-checkout/${encodeURIComponent(ip)}/${hour}`);
    const cache = caches.default;
    const existing = await cache.match(key);
    const count = existing ? Number.parseInt(await existing.text(), 10) || 0 : 0;
    if (count >= 8) return false;
    await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": "max-age=3600" } }));
    return true;
  } catch (e) {
    return true;
  }
}
__name(cvCheckoutAllowed, "cvCheckoutAllowed");
function randomOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(randomOpaqueToken, "randomOpaqueToken");
async function cvCheckoutResponse(request, env, origin) {
  const amount = Number.parseInt(env.CV_DOWNLOAD_PRICE_CENTS || "4900", 10);
  if (!yocoSecretKey(env) || !env.YOCO_WEBHOOK_SECRET || !env.DB || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY) {
    return json({ error: "Online CV payments are not configured yet. Please contact SA Recruiters for help." }, 503, origin);
  }
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > CV_DOWNLOAD_MAX_CENTS) {
    return json({ error: "CV download pricing is temporarily unavailable." }, 503, origin);
  }
  if (!await cvCheckoutAllowed(request)) return json({ error: "Too many checkout attempts. Please try again later." }, 429, origin);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Invalid checkout request." }, 400, origin); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid checkout request." }, 400, origin);
  const candidateId = String(body.candidateId ?? "").trim();
  const email = validCustomerEmail(body.email);
  // CV Box candidate ids are generated by the app as short base36 strings
  // (e.g. "lx3k9a8f2q4h"), not UUIDs, so accept any safe id token. It is
  // URL-encoded by URLSearchParams before it reaches PostgREST.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidateId)) return json({ error: "Choose a valid CV Box profile." }, 400, origin);
  if (!email) return json({ error: "Enter a valid email address for your download link." }, 400, origin);
  let candidate;
  try {
    const q = new URLSearchParams({ select: "id,full_name,status,cv_link", id: `eq.${candidateId}`, status: "eq.active", limit: "1" });
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${q}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
    const rows = await response.json();
    candidate = Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    console.error("Could not validate CV checkout candidate", error);
    return json({ error: "Could not verify this CV right now. Please try again." }, 502, origin);
  }
  if (!candidate || candidate.status !== "active") return json({ error: "This CV is no longer available." }, 404, origin);
  if (!candidate.cv_link) return json({ error: "This profile does not have a downloadable CV yet." }, 409, origin);
  const orderId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO cv_download_orders (id,candidate_id,candidate_name,customer_email,cv_url,amount_cents,currency,status,created_at) VALUES (?,?,?,?,?,?,?,'creating',?)`)
      .bind(orderId, candidate.id, String(candidate.full_name || "Candidate").slice(0, 160), email, candidate.cv_link, amount, "ZAR", createdAt).run();
  } catch (error) {
    console.error("Could not create CV checkout order", error);
    return json({ error: "Checkout is temporarily unavailable. Please try again." }, 503, origin);
  }
  const site = cvCheckoutSite(env);
  const checkoutPayload = {
    amount,
    currency: "ZAR",
    successUrl: `${site}/?section=candidates&cvPayment=returned`,
    cancelUrl: `${site}/?section=candidates&cvPayment=cancelled`,
    failureUrl: `${site}/?section=candidates&cvPayment=failed`,
    metadata: { orderId, product: "cv-box-download" },
    externalId: orderId,
    clientReferenceId: orderId,
    lineItems: [{ displayName: "CV Box candidate CV", quantity: 1, pricingDetails: { price: amount } }]
  };
  try {
    const response = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: `Bearer ${yocoSecretKey(env)}`, "Content-Type": "application/json", "Idempotency-Key": orderId },
      body: JSON.stringify(checkoutPayload)
    });
    const checkout = await response.json().catch(() => null);
    if (!response.ok || !checkout?.id || !checkout?.redirectUrl || checkout.amount !== amount || checkout.currency !== "ZAR") {
      console.error("Yoco checkout creation failed", response.status, checkout?.message || checkout?.error || "invalid response");
      await env.DB.prepare("UPDATE cv_download_orders SET status='failed' WHERE id=? AND status='creating'").bind(orderId).run();
      return json({ error: "Yoco could not start checkout. Please try again." }, 502, origin);
    }
    const redirect = new URL(checkout.redirectUrl);
    if (redirect.protocol !== "https:" || !(redirect.hostname === "yoco.com" || redirect.hostname.endsWith(".yoco.com"))) {
      await env.DB.prepare("UPDATE cv_download_orders SET status='failed' WHERE id=? AND status='creating'").bind(orderId).run();
      return json({ error: "Yoco returned an invalid checkout link." }, 502, origin);
    }
    await env.DB.prepare("UPDATE cv_download_orders SET status='pending',checkout_id=? WHERE id=? AND status='creating'").bind(checkout.id, orderId).run();
    return new Response(JSON.stringify({ redirectUrl: redirect.href }), { headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Yoco checkout request failed", error);
    await env.DB.prepare("UPDATE cv_download_orders SET status='failed' WHERE id=? AND status='creating'").bind(orderId).run().catch(() => {});
    return json({ error: "Could not connect to Yoco. Please try again." }, 502, origin);
  }
}
__name(cvCheckoutResponse, "cvCheckoutResponse");
async function verifyYocoWebhook(request, rawBody, secret) {
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signatures = request.headers.get("webhook-signature") || "";
  if (!id || !timestamp || !signatures || !secret?.startsWith("whsec_")) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 180) return false;
  try {
    const binaryKey = Uint8Array.from(atob(secret.slice(6)), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", binaryKey, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const message = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
    for (const entry of signatures.trim().split(/\s+/)) {
      const [version, signature] = entry.split(",", 2);
      if (version !== "v1" || !signature) continue;
      try {
        const provided = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
        if (await crypto.subtle.verify("HMAC", key, provided, message)) return true;
      } catch (e) {}
    }
  } catch (e) {
    return false;
  }
  return false;
}
__name(verifyYocoWebhook, "verifyYocoWebhook");
async function fetchCvCandidateContact(env, candidateId) {
  // Throws on lookup failure so the Yoco webhook is retried instead of
  // sending a paid customer an incomplete email. Returns null fields when the
  // candidate simply has no contact details on file.
  const q = new URLSearchParams({ select: "contact_phone,contact_email", id: `eq.${candidateId}`, limit: "1" });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${q}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  return { phone: String(row?.contact_phone || "").trim(), email: String(row?.contact_email || "").trim() };
}
__name(fetchCvCandidateContact, "fetchCvCandidateContact");
function cvContactHtml(contact) {
  const phone = contact?.phone ? escapeEmailHtml(contact.phone) : "";
  const email = contact?.email ? escapeEmailHtml(contact.email) : "";
  if (!phone && !email) {
    return `<p style="background:#f6f6f6;border-radius:8px;padding:12px 14px;margin:16px 0">This candidate has not added separate contact details. Any contact details are on the CV itself, or reply to this email or WhatsApp SA Recruiters and we will help you reach them.</p>`;
  }
  const rows = [phone ? `<div><strong>Phone / WhatsApp:</strong> ${phone}</div>` : "", email ? `<div><strong>Email:</strong> ${email}</div>` : ""].join("");
  return `<div style="background:#f1f8f3;border:1px solid #cfe6d6;border-radius:8px;padding:12px 14px;margin:16px 0"><div style="font-weight:bold;margin-bottom:6px">Candidate contact details</div>${rows}</div>`;
}
__name(cvContactHtml, "cvContactHtml");
async function sendCvDownloadEmail(env, order, token, contact) {
  if (!env.RESEND_API_KEY) return false;
  const expires = new Date(order.download_expires_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });
  const link = `${cvWorkerBase(env)}/api/cv-box/download?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(token)}`;
  const name = escapeEmailHtml(order.candidate_name || "your selected candidate");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
      to: [order.customer_email],
      subject: `Your SA Recruiters CV download: ${name}`,
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#181818;line-height:1.6"><h2>Payment confirmed</h2><p>Your R${(Number(order.amount_cents) / 100).toFixed(2)} payment for <strong>${name}</strong> has been confirmed.</p><p><a href="${link}" style="display:inline-block;background:#0b7a35;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Download CV</a></p><p>This private download link expires ${escapeEmailHtml(expires)}. Keep it private.</p>${cvContactHtml(contact)}<p>SA Recruiters</p></body></html>`
    })
  });
  return response.ok;
}
__name(sendCvDownloadEmail, "sendCvDownloadEmail");
async function yocoWebhookResponse(request, env) {
  if (!env.YOCO_WEBHOOK_SECRET || !yocoSecretKey(env) || !env.DB) return new Response("Webhook is not configured", { status: 503 });
  const rawBody = await request.text();
  if (rawBody.length > 65536) return new Response("Payload too large", { status: 413 });
  if (!await verifyYocoWebhook(request, rawBody, env.YOCO_WEBHOOK_SECRET)) return new Response("Invalid webhook signature", { status: 401 });
  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return new Response("Invalid JSON", { status: 400 }); }
  const checkoutId = String(event?.metadata?.checkoutId || event?.payload?.metadata?.checkoutId || event?.data?.metadata?.checkoutId || "").slice(0, 200);
  if (!checkoutId) return new Response("Ignored", { status: 200 });
  let result;
  try { result = await env.DB.prepare("SELECT * FROM cv_download_orders WHERE checkout_id=? LIMIT 1").bind(checkoutId).first(); }
  catch (error) { console.error("Could not read CV order for Yoco event", error); return new Response("Order lookup failed", { status: 503 }); }
  if (!result) return new Response("Ignored", { status: 200 });
  if (event.type === "refund.succeeded") {
    await env.DB.prepare("UPDATE cv_download_orders SET status='refunded',download_token=NULL,download_expires_at=NULL WHERE id=?").bind(result.id).run();
    return new Response("OK", { status: 200 });
  }
  if (event.type !== "payment.succeeded") return new Response("Ignored", { status: 200 });
  let checkout;
  try {
    const response = await fetch(`https://payments.yoco.com/api/checkouts/${encodeURIComponent(checkoutId)}`, { headers: { Authorization: `Bearer ${yocoSecretKey(env)}` } });
    checkout = await response.json().catch(() => null);
    if (!response.ok) return new Response("Could not verify checkout", { status: 503 });
  } catch (error) { return new Response("Could not verify checkout", { status: 503 }); }
  if (checkout?.id !== checkoutId || checkout.status !== "completed" || checkout.amount !== result.amount_cents || checkout.currency !== result.currency || checkout?.metadata?.orderId !== result.id) {
    console.warn("Yoco payment did not match CV order", checkoutId);
    return new Response("Checkout mismatch", { status: 400 });
  }
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  let token = result.download_token;
  if (!token) token = randomOpaqueToken();
  try {
    await env.DB.prepare(`UPDATE cv_download_orders SET status='paid',paid_at=COALESCE(paid_at,?),download_token=COALESCE(download_token,?),download_expires_at=COALESCE(download_expires_at,?) WHERE id=? AND status IN ('pending','paid')`)
      .bind(now, token, expiry, result.id).run();
    result = await env.DB.prepare("SELECT * FROM cv_download_orders WHERE id=? LIMIT 1").bind(result.id).first();
  } catch (error) { console.error("Could not mark CV order paid", error); return new Response("Order update failed", { status: 503 }); }
  if (!result || result.status !== "paid") return new Response("Order is not eligible", { status: 409 });
  if (!result.email_sent_at) {
    let contact;
    try { contact = await fetchCvCandidateContact(env, result.candidate_id); }
    catch (error) { console.error("Could not load candidate contact for paid CV", error); return new Response("Candidate lookup failed", { status: 503 }); }
    let sent = false;
    try { sent = await sendCvDownloadEmail(env, result, result.download_token, contact); }
    catch (error) { console.error("CV download email failed", error); }
    if (!sent) return new Response("Download email not delivered", { status: 503 });
    await env.DB.prepare("UPDATE cv_download_orders SET email_sent_at=? WHERE id=? AND email_sent_at IS NULL").bind(new Date().toISOString(), result.id).run();
    // Instant owner alert. Best-effort: never fails the webhook, and only runs
    // once per order because email_sent_at is now set.
    try {
      await sendNotificationEmail(env, {
        to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
        email_subject: `SA Recruiters | CV sold: R${(Number(result.amount_cents) / 100).toFixed(2)}`,
        notification_type: "PAYMENT",
        notification_title: "CV payment received",
        notification_intro: "Someone just paid for a CV and their download link has been emailed.",
        notification_body: "Candidate: " + (result.candidate_name || "-") + "\nCandidate ID: " + result.candidate_id + "\nAmount: R" + (Number(result.amount_cents) / 100).toFixed(2) + "\nBuyer email: " + result.customer_email + "\nOrder: " + result.id
      });
    } catch (error) { console.error("CV payment owner alert failed", error); }
  }
  return new Response("OK", { status: 200 });
}
__name(yocoWebhookResponse, "yocoWebhookResponse");
async function cvDownloadResponse(request, env) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order") || "";
  const token = url.searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || token.length < 40 || token.length > 100) return new Response("Download not found", { status: 404 });
  let order;
  try { order = await env.DB.prepare("SELECT candidate_name,cv_url,status,download_token,download_expires_at FROM cv_download_orders WHERE id=? LIMIT 1").bind(orderId).first(); }
  catch (error) { return new Response("Download unavailable", { status: 503 }); }
  if (!order || order.status !== "paid" || order.download_token !== token || !order.download_expires_at || Date.parse(order.download_expires_at) < Date.now()) return new Response("This private download link is invalid or expired", { status: 403 });
  let file;
  try {
    const source = new URL(order.cv_url);
    const publicBase = new URL(env.R2_PUBLIC_BASE_URL);
    let key = "";
    if (source.origin === publicBase.origin && source.pathname.startsWith(`${publicBase.pathname.replace(/\/$/, "")}/candidate-cvs/`)) {
      key = decodeURIComponent(source.pathname.slice(publicBase.pathname.replace(/\/$/, "").length + 1));
      if (!/^candidate-cvs\/[A-Za-z0-9._-]+\.(pdf|png|jpe?g)$/i.test(key)) throw new Error("Invalid CV object key");
      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) return new Response("CV file is no longer available", { status: 404 });
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength > 4 * 1024 * 1024) return new Response("CV file is too large", { status: 413 });
      file = new Response(bytes, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream" } });
    } else if (source.origin === new URL(env.SUPABASE_URL).origin && source.pathname.startsWith("/storage/v1/object/public/")) {
      const response = await fetch(source.href, { redirect: "error" });
      if (!response.ok) return new Response("CV file is no longer available", { status: 404 });
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 4 * 1024 * 1024) return new Response("CV file is too large", { status: 413 });
      file = new Response(bytes, { headers: { "Content-Type": response.headers.get("Content-Type") || "application/octet-stream" } });
    } else {
      return new Response("CV storage location is not supported", { status: 404 });
    }
  } catch (error) {
    console.error("Paid CV file retrieval failed", error);
    return new Response("CV file is temporarily unavailable", { status: 502 });
  }
  const ext = (order.cv_url.match(/\.(pdf|png|jpe?g)(?:\?|$)/i) || ["", "pdf"])[1].toLowerCase();
  const safeName = String(order.candidate_name || "candidate").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "candidate";
  const headers = new Headers(file.headers);
  headers.set("Content-Disposition", `attachment; filename="SA-Recruiters-CV-${safeName}.${ext}"`);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return new Response(file.body, { status: 200, headers });
}
__name(cvDownloadResponse, "cvDownloadResponse");
async function startupResponse(request, env, ctx, origin) {
  const cache = caches.default;
  // Public traffic must never use D1 as a cache validator or recovery source.
  // The scheduled sync publishes the authoritative R2 snapshot. Serving the
  // last good snapshot is safer than spending the account-wide D1 read budget.
  const cacheKey = new Request(new URL("/api/startup?schema=edge-first-v16", request.url), { method: "GET" });
  let dataVersion = 0;
  async function buildResponse(payload, cacheControl = "public, max-age=86400") {
    const body = JSON.stringify(payload);
    const version = Number.isSafeInteger(Number(payload?.data_version)) ? Number(payload.data_version) : 0;
    return new Response(body, { headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl,
      "X-Data-Version": String(version), "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type"
    }});
  }
  function clientResponse(response) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=60");
    headers.set("X-Data-Version", String(dataVersion));
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  async function refreshAndCache() {
    let snapshot = await readPublicStartupSnapshot(env);
    // Prefer R2 even when the snapshot is stale; exhausting D1 is worse than
    // briefly serving the last successful public snapshot.
    if (snapshot) {
      dataVersion = Number(snapshot.data_version) || 0;
      if (!snapshot.counts || !snapshot.counts.provinces) snapshot = { ...snapshot, counts: { ...(snapshot.counts || {}), provinces: {} } };
      const response = await buildResponse(snapshot);
      await cache.put(cacheKey, response.clone());
      return snapshot;
    }
    throw new Error("Public startup snapshot unavailable; D1 fallback disabled");
  }
  const cached = await cache.match(cacheKey, { ignoreMethod: true });
  if (cached) {
    try {
      const payload = await cached.clone().json();
      const ageSeconds = (Date.now() - new Date(payload.generated_at).getTime()) / 1e3;
      if (ageSeconds < STARTUP_CACHE_TTL) return clientResponse(cached);
      if (ageSeconds < STARTUP_STALE_TTL) {
        ctx.waitUntil(refreshAndCache().catch(() => {}));
        return clientResponse(cached);
      }
      // Keep the last good response available even beyond the normal stale
      // window. Do not fall through to D1 just because a snapshot is old.
      const stale = clientResponse(cached);
      stale.headers.set("X-Data-Stale", "true");
      stale.headers.set("Cache-Control", "public, max-age=60");
      return stale;
    } catch (e) { /* malformed/legacy cache; rebuild */ }
  }
  try { return clientResponse(await buildResponse(await refreshAndCache(), "no-store")); }
  catch (error) { return json({ error: "Startup data unavailable", detail: error.message }, 502, origin); }
}
__name(startupResponse, "startupResponse");
function publicClosingDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const months = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
  const month = months[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${String(match[1]).padStart(2, "0")}`;
}
__name(publicClosingDate, "publicClosingDate");
async function vacanciesResponse(request, env, ctx, origin) {
  // Normal app browsing still requests 20-50 rows; the larger ceiling lets
  // read-only SEO snapshot exports page through the same public data with
  // fewer repeated full-snapshot scans.
  const PUBLIC_VACANCY_MAX_PAGE_SIZE = 200;
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const location = String(url.searchParams.get("location") || "").trim().slice(0, 120);
  const source = String(url.searchParams.get("source") || "").trim().slice(0, 240);
  const scope = String(url.searchParams.get("scope") || "").trim();
  const remote = String(url.searchParams.get("remote") || "").trim().slice(0, 30);
  const experience = String(url.searchParams.get("experience") || "").trim().slice(0, 60);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20) || 20, 1), PUBLIC_VACANCY_MAX_PAGE_SIZE);
  const hasOffset = url.searchParams.has("offset");
  const offset = Math.min(Math.max(Number(url.searchParams.get("offset") || 0) || 0, 0), 5000);
  const cursor = String(url.searchParams.get("cursor") || "");
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  // The R2 vacancy snapshot is refreshed by the scheduled sync. Do not make
  // every public vacancy request spend a D1 row read validating a version.
  cacheUrl.searchParams.set("__schema", "edge-first-v7");
  cacheUrl.searchParams.sort();
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const dedicated = new Set(["himalayas", "adzuna", "retail", "shoprite", "picknpay", "woolworths", "truworths", "spar", "career_board", "bizcommunity", "remotive", "realworkfromanywhere", "himalayas-rss", "remote"]);
  function clientResponse(cachedResponse) {
    const headers = new Headers(cachedResponse.headers);
    headers.set("Cache-Control", "public, max-age=60");
    headers.append("Vary", "Origin");
    headers.set("Access-Control-Allow-Origin", origin || "*");
    return new Response(cachedResponse.body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers });
  }
  const cached = await cache.match(cacheKey, { ignoreMethod: true });
  if (cached) return clientResponse(cached);
  // Public vacancy browsing is snapshot-only. If the dedicated vacancy
  // snapshot is unavailable, the startup snapshot is still a safe bounded
  // source; never turn a cache miss into a full D1 scan.
  const snapshot = await readPublicVacancySnapshot(env) || await readPublicStartupSnapshot(env);
  // A snapshot is always preferable to a fresh D1 query for public traffic.
  // The scheduled sync is responsible for refreshing it; stale data is safer
  // than exhausting the account-wide D1 rows-read allowance.
  const snapshotFresh = !!snapshot && Array.isArray(snapshot.vacancies);
  const filterRows = (allRows) => {
    const sources = source.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
    const cursorSeparator = cursor.indexOf("|");
    const cursorCreated = cursorSeparator >= 0 ? cursor.slice(0, cursorSeparator) : cursor;
    const cursorId = cursorSeparator >= 0 ? cursor.slice(cursorSeparator + 1) : "";
    return (allRows || []).filter((row) => {
      const closingDate = publicClosingDate(row.closing_date);
      // Free-text values such as "ASAP" or "Open until filled" are not expiry dates.
      if (closingDate && closingDate < new Date().toISOString().slice(0, 10)) return false;
      if (q && ![row.title, row.company, row.location, row.notes].some((value) => String(value || "").toLowerCase().includes(q.toLowerCase()))) return false;
      if (location && !String(row.location || "").toLowerCase().includes(location.toLowerCase())) return false;
      if (remote && String(row.remote || "") !== remote) return false;
      if (experience && String(row.experience_level || "") !== experience) return false;
      const sourceType = String(row.source_type || "").toLowerCase();
      const isGenericAts = sourceType === "ats";
      const dedicatedFeedAgencies = new Set(["himalayas-rss", "remotive", "realworkfromanywhere", "weworkremotely", "bizcommunity-sa", "govposts", "govposts-sa", "topjobseeker", "topjobseeker-sa", "myjobmag"]);
      const isDedicatedRow = dedicated.has(sourceType) || dedicated.has(String(row.ats_feed_id || "")) || dedicatedFeedAgencies.has(String(row.agency_id || "")) || String(row.id || "").startsWith("ats_");
      const isGeneralRow = !row.employer_id && !isDedicatedRow;
      if (scope === "general" && !isGeneralRow) return false;
      if (sources.length && !sources.includes(String(row.source_type || "")) && !sources.includes(String(row.ats_feed_id || ""))) return false;
      if (cursorCreated && !(String(row.created_at || "") < cursorCreated || (String(row.created_at || "") === cursorCreated && String(row.id || "") < cursorId))) return false;
      return true;
    });
  };
  let rows;
  let alreadyPaged = false;
  if (snapshotFresh) {
    rows = filterRows(snapshot.vacancies);
    // A legacy/incomplete R2 snapshot can contain general listings while
    // omitting dedicated scraper sources. Recover those filtered requests
    // from Supabase immediately; the next scheduled publication will persist
    // the complete inventory back to R2.
    // The startup snapshot is intentionally bounded and may contain only the
    // agency/employer rows needed for the first paint. Recover General rows
    // from the authoritative inventory when the snapshot has no matching
    // general records; otherwise the General folder incorrectly appears empty
    // while Agency still shows the bounded startup rows.
    const needsGeneralRecovery = scope === "general" && !rows.some((row) => {
      const sourceType = String(row.source_type || "").toLowerCase();
      return !row.employer_id && (sourceType === "ats"
        ? !dedicated.has(sourceType)
        : (!row.agency_id || row.agency_id === "general") && !dedicated.has(sourceType));
    });
    if (source || needsGeneralRecovery) {
      try {
        const authoritative = await buildPublicVacancySnapshotFromSupabase(env);
        const recovered = filterRows(authoritative.vacancies);
        if (recovered.length || needsGeneralRecovery) rows = recovered;
      } catch (error) {
        console.warn("Could not recover filtered vacancy snapshot", error);
      }
    }
  } else return json({ error: "Public vacancy snapshot unavailable" }, 503, origin);
  const paged = alreadyPaged ? rows : ((cursor || hasOffset) ? rows.slice(offset, offset + limit + 1) : rows.slice(0, limit + 1));
  const hasMore = paged.length > limit;
  const page = hasMore ? paged.slice(0, limit) : paged;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at || ""}|${last.id || ""}` : null;
  const response = json({
    vacancies: page,
    next_cursor: nextCursor,
    limit,
    total: rows.length,
    generated_at: snapshot.generated_at || null,
    data_version: Number(snapshot?.data_version) || 0
  }, 200, origin);
  // Keep pages aligned with the latest R2 publication. A long edge TTL can
  // otherwise keep the previous vacancy cards visible after a refresh.
  response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=60");
  response.headers.set("X-Data-Version", String(Number(snapshot?.data_version) || 0));
  await cache.put(cacheKey, response.clone());
  return clientResponse(response);
}
__name(vacanciesResponse, "vacanciesResponse");
async function adminVacanciesResponse(request, env, origin) {
  if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
  if (!env.DB) return json({ error: "D1 not bound" }, 503, origin);
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const location = String(url.searchParams.get("location") || "").trim().slice(0, 120);
  const source = String(url.searchParams.get("source") || "").trim().slice(0, 240);
  const agencyId = String(url.searchParams.get("agency_id") || "").trim().slice(0, 120);
  const employerId = String(url.searchParams.get("employer_id") || "").trim().slice(0, 120);
  const remote = String(url.searchParams.get("remote") || "").trim().slice(0, 30);
  const experience = String(url.searchParams.get("experience") || "").trim().slice(0, 60);
  const includeExpired = url.searchParams.get("include_expired") !== "0";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200) || 200, 1), 500);
  const cursor = String(url.searchParams.get("cursor") || "");
  const cursorSeparator = cursor.indexOf("|");
  const cursorCreated = cursorSeparator >= 0 ? cursor.slice(0, cursorSeparator) : cursor;
  const cursorId = cursorSeparator >= 0 ? cursor.slice(cursorSeparator + 1) : "";
  const conditions = [];
  const values = [];
  if (!includeExpired) conditions.push("(closing_date IS NULL OR closing_date = '' OR closing_date >= date('now'))");
  if (q) {
    conditions.push("(id LIKE ? OR title LIKE ? OR company LIKE ? OR location LIKE ? OR notes LIKE ?)");
    const term = `%${q}%`;
    values.push(term, term, term, term, term);
  }
  if (location) { conditions.push("location LIKE ?"); values.push(`%${location}%`); }
  if (source) {
    const sources = source.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
    if (sources.length) { conditions.push(`source_type IN (${sources.map(() => "?").join(",")})`); values.push(...sources); }
  }
  if (agencyId) { conditions.push("agency_id = ?"); values.push(agencyId); }
  if (employerId) { conditions.push("employer_id = ?"); values.push(employerId); }
  if (remote) { conditions.push("remote = ?"); values.push(remote); }
  if (experience) { conditions.push("experience_level = ?"); values.push(experience); }
  if (cursorCreated) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    values.push(cursorCreated, cursorCreated, cursorId);
  }
  const columns = [
    "id", "agency_id", "employer_id", "title", "company", "company_photo",
    "location", "closing_date", "notes", "link", "email", "phone", "remote",
    "experience_level", "employment_type", "contract_type", "work_schedule", "hours",
    "salary", "start_date", "created_at", "source_type"
  ];
  // Featured-vacancy fields were added after the initial D1 mirror schema.
  // Read them when available, but keep the admin list working against older
  // mirrors instead of failing the entire query with "no such column".
  try {
    const schema = await env.DB.prepare("PRAGMA table_info(vacancies)").all();
    const names = new Set((schema.results || []).map((column) => column.name));
    if (["is_featured", "featured_until", "featured_order"].every((name) => names.has(name))) {
      columns.push("is_featured", "featured_until", "featured_order");
    }
  } catch (e) {
    console.warn("Could not inspect D1 vacancy schema; using base admin columns", e);
  }
  const result = await env.DB.prepare(
    `SELECT ${columns.join(",")} FROM vacancies${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`
  ).bind(...values, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at || ""}|${last.id || ""}` : null;
  const response = json({ vacancies: page, next_cursor: nextCursor, limit }, 200, origin);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
__name(adminVacanciesResponse, "adminVacanciesResponse");
async function adminD1WriteThroughResponse(request, env, origin) {
  if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
  if (!env.DB) return json({ error: "D1 not bound" }, 503, origin);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 131072) return json({ error: "Write-through payload is too large." }, 413, origin);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid payload." }, 400, origin);
  if (JSON.stringify(body).length > 131072) return json({ error: "Write-through payload is too large." }, 413, origin);
  const table = String(body.table || "");
  const spec = D1_WRITE_THROUGH_SPECS[table];
  if (!spec) return json({ error: "Unsupported mirror table." }, 400, origin);
  const operation = body.operation || "upsert";
  try {
    if (operation === "delete") {
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map((id) => String(id ?? "").trim());
      if (!ids.length || ids.length > 200 || ids.some((id) => !id || id.length > 256)) return json({ error: "Missing or invalid row keys." }, 400, origin);
      await env.DB.batch([...ids.map((id) => env.DB.prepare(`DELETE FROM ${table} WHERE ${spec.key} = ?`).bind(id)), publicDataVersionBumpStatement(env)]);
      return json({ ok: true, table, ids, data_version: await readPublicDataVersion(env) }, 200, origin);
    }
    if (operation !== "upsert") return json({ error: "Unsupported operation." }, 400, origin);
    const rows = Array.isArray(body.rows) ? body.rows : [body.row];
    if (!rows.length || rows.length > 100 || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return json({ error: "Missing or invalid rows." }, 400, origin);
    const schema = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const available = new Set((schema.results || []).map((column) => column.name));
    if (!available.has(spec.key)) return json({ error: "D1 mirror schema is not ready for this table." }, 503, origin);
    const statements = [];
    const ids = [];
    for (const row of rows) {
      const key = row[spec.key];
      if (key === null || key === void 0 || String(key).trim() === "" || String(key).length > 256) return json({ error: "Missing or invalid row key." }, 400, origin);
      if (table === "vacancies" && !row.updated_at) row.updated_at = new Date().toISOString();
      const columns = spec.columns.filter((column) => available.has(column) && Object.prototype.hasOwnProperty.call(row, column));
      if (!columns.includes(spec.key) || columns.length < 2) return json({ error: "D1 mirror schema is not ready for this row." }, 503, origin);
      statements.push(prepareD1WriteThroughUpsert(env, table, spec, columns, row));
      ids.push(String(key));
    }
    statements.push(publicDataVersionBumpStatement(env));
    await env.DB.batch(statements);
    return json({ ok: true, table, ids, data_version: await readPublicDataVersion(env) }, 200, origin);
  } catch (error) {
    console.error("Admin D1 write-through failed", table, error);
    return json({ error: "D1 write-through failed." }, 500, origin);
  }
}
__name(adminD1WriteThroughResponse, "adminD1WriteThroughResponse");

async function syncStatusResponse(request, env, origin) {
  if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
  const status = await readSyncMeta(env, "sync_status");
  const lastSync = await readSyncMeta(env, "last_sync");
  const watermark = await readSyncMeta(env, "vacancies_updated_through");
  return json({ status: status ? JSON.parse(status) : null, last_sync: lastSync ? JSON.parse(lastSync) : null, vacancies_updated_through: watermark }, 200, origin);
}
__name(syncStatusResponse, "syncStatusResponse");
async function postersResponse(request, env, origin) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/posters?schema=r2-v2", request.url), { method: "GET" });
  function clientResponse(response) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=60");
    headers.append("Vary", "Origin");
    headers.set("X-Data-Version", "0");
    headers.set("Access-Control-Allow-Origin", origin || "*");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const cached = await cache.match(cacheKey, { ignoreMethod: true });
  if (cached) return clientResponse(cached);
  let snapshot = await readPublicJsonSnapshot(env, PUBLIC_POSTERS_SNAPSHOT_KEY, "posters");
  let posters;
  if (snapshot) {
    posters = snapshot.posters;
  } else {
    // One-time migration only: seed the R2 object if an older deployment has
    // never created it. All subsequent public reads are R2-only.
    try { posters = await bootstrapPublicAuxiliarySnapshot(env, "posters"); }
    catch (error) { console.error("poster R2 bootstrap failed", error); return json({ posters: [], count: 0, source: "unavailable", data_version: 0 }, 503, origin); }
    snapshot = { data_version: 0 };
  }
  posters = posters.filter((poster) => !poster.expires_at || poster.expires_at > new Date().toISOString());
  const cachedResponse = json({ posters, count: posters.length, source: "r2", data_version: Number(snapshot.data_version) || 0 }, 200, origin);
  cachedResponse.headers.set("Cache-Control", "public, max-age=60");
  cachedResponse.headers.set("X-Data-Version", String(Number(snapshot.data_version) || 0));
  await cache.put(cacheKey, cachedResponse.clone());
  return clientResponse(cachedResponse);
}
__name(postersResponse, "postersResponse");
function publicHouseAdCreativeUrl(env, value) {
  const raw = String(value || "");
  try {
    const source = new URL(raw);
    const site = new URL(env.SITE_URL || "https://sa-recruiters.co.za");
    const r2 = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (r2 && source.origin === site.origin && source.pathname.startsWith("/assets/house-ads/")) {
      return `${r2}${source.pathname}${source.search}${source.hash}`;
    }
  } catch (e) {}
  return raw;
}
__name(publicHouseAdCreativeUrl, "publicHouseAdCreativeUrl");
async function houseAdsResponse(request, env, ctx, origin) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/house-ads?schema=r2-v1", request.url).toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("Access-Control-Allow-Origin", origin || "*");
    return new Response(cached.body, { status: cached.status, headers });
  }
  let snapshot = await readPublicJsonSnapshot(env, PUBLIC_HOUSE_ADS_SNAPSHOT_KEY, "ads");
  let snapshotAds;
  if (snapshot) {
    snapshotAds = snapshot.ads;
  } else {
    // One-time migration only; the scheduled sync will maintain this object.
    try { snapshotAds = await bootstrapPublicAuxiliarySnapshot(env, "ads"); }
    catch (error) { console.error("house-ad R2 bootstrap failed", error); return json({ ads: [], error: "House ads temporarily unavailable" }, 503, origin); }
    snapshot = { data_version: 0 };
  }
  const now = Date.now();
  const ads = snapshotAds
    .filter((ad) => ad.is_active !== false && (!ad.starts_at || new Date(ad.starts_at).getTime() <= now) && (!ad.ends_at || new Date(ad.ends_at).getTime() > now))
    .map((ad) => ({ ...ad, image_url: publicHouseAdCreativeUrl(env, ad.image_url) }));
  const response = json({ ads, data_version: Number(snapshot.data_version) || 0 }, 200, origin);
  response.headers.set("Cache-Control", "public, max-age=300");
  const put = cache.put(cacheKey, response.clone());
  if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  return response;
}
__name(houseAdsResponse, "houseAdsResponse");
async function houseAdEventResponse(request, env, origin) {
  let body = null;
  try { body = await request.json(); } catch (e) {}
  const id = body && String(body.id || "");
  const event = body && String(body.event || "");
  if (!/^[0-9a-fA-F-]{36}$/.test(id) || (event !== "impression" && event !== "click")) {
    return json({ error: "Invalid house ad event" }, 400, origin);
  }
  try {
    if (!env.DB) return json({ error: "House ads mirror unavailable" }, 503, origin);
    const column = event === "impression" ? "impressions" : "clicks";
    await env.DB.prepare(`UPDATE house_ads SET ${column} = ${column} + 1 WHERE id = ?`).bind(id).run();
  } catch (error) {
    console.error("house ad event failed", error);
  }
  return json({ ok: true }, 200, origin);
}
__name(houseAdEventResponse, "houseAdEventResponse");
var PHOTO_BATCH_SIZE = 20;
async function migratePhotos(request, env, origin) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const listRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pool_candidates?select=id,photo_url&photo_url=not.is.null`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) {
    return json({ error: "Could not list candidates", detail: await listRes.text() }, 500, origin);
  }
  const candidates = await listRes.json();
  const allToMigrate = candidates.filter(
    (c) => typeof c.photo_url === "string" && c.photo_url.includes("/storage/v1/object/public/candidate-photos/")
  );
  const batch = allToMigrate.slice(0, PHOTO_BATCH_SIZE);
  const results = [];
  for (const c of batch) {
    try {
      const imgRes = await fetch(c.photo_url);
      if (!imgRes.ok) {
        results.push({ id: c.id, ok: false, reason: `download ${imgRes.status}` });
        continue;
      }
      const bytes = await imgRes.arrayBuffer();
      const key = `candidate-photos/${randomKey()}.jpg`;
      await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      const newUrl = publicUrlFor(env, key);
      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?id=eq.${c.id}`, {
        method: "PATCH",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ photo_url: newUrl })
      });
      if (!patchRes.ok) {
        results.push({ id: c.id, ok: false, reason: `db update ${patchRes.status}` });
        continue;
      }
      results.push({ id: c.id, ok: true, url: newUrl });
    } catch (e) {
      results.push({ id: c.id, ok: false, reason: e.message });
    }
  }
  return json({
    totalWithPhoto: candidates.length,
    foundOnSupabase: allToMigrate.length,
    migrated: results.filter((r) => r.ok).length,
    remaining: allToMigrate.length - results.filter((r) => r.ok).length,
    results
  }, 200, origin);
}
__name(migratePhotos, "migratePhotos");
var LOGO_BATCH_SIZE = 20;
async function migrateBase64Logos(request, env, origin, table, prefix) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const listRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?select=id,photo&photo=not.is.null`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) {
    return json({ error: `Could not list ${table}`, detail: await listRes.text() }, 500, origin);
  }
  const rows = await listRes.json();
  const allToMigrate = rows.filter((r) => typeof r.photo === "string" && r.photo.startsWith("data:image"));
  const batch = allToMigrate.slice(0, LOGO_BATCH_SIZE);
  const results = [];
  for (const r of batch) {
    try {
      const match = r.photo.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        results.push({ id: r.id, ok: false, reason: "not a recognisable data URL" });
        continue;
      }
      const contentType = match[1];
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const ext = (contentType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
      const key = `${prefix}/${randomKey()}.${ext}`;
      await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
      const newUrl = publicUrlFor(env, key);
      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${r.id}`, {
        method: "PATCH",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ photo: newUrl })
      });
      if (!patchRes.ok) {
        results.push({ id: r.id, ok: false, reason: `db update ${patchRes.status}` });
        continue;
      }
      results.push({ id: r.id, ok: true, url: newUrl });
    } catch (e) {
      results.push({ id: r.id, ok: false, reason: e.message });
    }
  }
  const migratedCount = results.filter((x) => x.ok).length;
  return json({
    total: rows.length,
    foundBase64: allToMigrate.length,
    migrated: migratedCount,
    remaining: allToMigrate.length - migratedCount,
    results
  }, 200, origin);
}
__name(migrateBase64Logos, "migrateBase64Logos");
// ============================================================
//  CV Builder (CV Revamp Service) — Gemini-backed CV generation.
//  Turns raw, unstructured career notes into a structured CV the
//  frontend can render/print. The Gemini API key never reaches the
//  browser: the client calls this Worker route, which calls Gemini
//  server-side with env.GEMINI_API_KEY (set via `wrangler secret put`).
// ============================================================
var CV_SCHEMA = {
  type: "OBJECT",
  properties: {
    fullName: { type: "STRING" },
    jobTitle: { type: "STRING", description: "Headline / target job title for the CV." },
    summary: { type: "STRING", description: "2-4 sentence professional summary." },
    skills: { type: "ARRAY", items: { type: "STRING" } },
    experience: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING" },
          company: { type: "STRING" },
          duration: { type: "STRING", description: "e.g. 'Jan 2021 - Present'. Leave empty string if not provided." },
          bulletPoints: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["role", "company", "bulletPoints"]
      }
    },
    education: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          qualification: { type: "STRING" },
          institution: { type: "STRING" },
          year: { type: "STRING" }
        },
        required: ["qualification", "institution"]
      }
    }
  },
  required: ["fullName", "jobTitle", "summary", "skills", "experience", "education"]
};
async function generateCvWithGemini(env, { fullName, targetRole, rawInput }) {
  if (!env.GEMINI_API_KEY) {
    return { ok: false, status: 503, error: "CV Builder is not configured yet." };
  }
  // Use the stable alias supported by the same REST endpoint used during
  // account-key verification. An optional GEMINI_MODEL secret/var can still
  // override this for deployments that explicitly pin a model.
  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const prompt = [
    "You are a professional CV/resume writer for the South African job market (SA Recruiters).",
    "Turn the job seeker's raw notes below into a clean, ATS-friendly CV.",
    "Rules:",
    "- Only use facts present in the notes. Never invent employers, dates, qualifications, or numbers that were not given.",
    "- Use strong action verbs and concise bullet points (no more than ~18 words each).",
    "- If a field (e.g. education) has no information in the notes, return an empty array for it rather than guessing.",
    "- Keep the summary to 2-4 sentences.",
    "",
    "Candidate name: " + (fullName || "Not provided"),
    "Target role: " + (targetRole || "Not specified"),
    "Raw notes from the candidate:",
    rawInput
  ].join("\n");
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4
          }
        })
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Gemini CV generation failed", res.status, detail.slice(0, 500));
      // A temporary 429/503 from one model should not make the CV builder
      // fail when a lower-demand Flash variant is available.
      if (res.status === 429 || res.status === 503) {
        const fallbackModel = model === "gemini-flash-latest"
          ? "gemini-3.5-flash-lite"
          : model === "gemini-3.5-flash-lite" ? "gemini-3.5-flash" : null;
        if (fallbackModel) {
          return generateCvWithGemini(
            { ...env, GEMINI_MODEL: fallbackModel },
            { fullName, targetRole, rawInput }
          );
        }
      }
      let reason = "Gemini rejected the request";
      try {
        const parsed = JSON.parse(detail);
        reason = parsed.error && parsed.error.message ? String(parsed.error.message) : reason;
      } catch (e) {}
      // Return only a short provider diagnostic; never echo request headers or
      // secrets. This makes configuration/quota/model failures actionable.
      return { ok: false, status: 502, error: `AI service error (${res.status}): ${reason.slice(0, 240)}` };
    }
    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    if (!text) {
      return { ok: false, status: 502, error: "The AI did not return a CV. Please try again." };
    }
    let cv;
    try {
      cv = JSON.parse(text);
    } catch (e) {
      return { ok: false, status: 502, error: "Could not read the generated CV. Please try again." };
    }
    return { ok: true, cv };
  } catch (e) {
    console.error("Gemini CV generation error", e);
    return { ok: false, status: 502, error: "The CV Builder is temporarily unavailable. Please try again." };
  }
}
__name(generateCvWithGemini, "generateCvWithGemini");
function employerPosterKey(imageUrl, env) {
  try {
    const image = new URL(imageUrl);
    const base = new URL(env.R2_PUBLIC_BASE_URL);
    const basePath = base.pathname.replace(/\/$/, "");
    if (image.origin !== base.origin || !image.pathname.startsWith(`${basePath}/employer-posters/`)) return null;
    const key = decodeURIComponent(image.pathname.slice(basePath.length + 1));
    return key.startsWith("employer-posters/") && !key.split("/").includes("..") ? key : null;
  } catch (_) {
    return null;
  }
}
__name(employerPosterKey, "employerPosterKey");
// Reads the poster once (title, employer, contact, closing date and scam signs in a single saved
// result) and returns the title. Same image => saved result, no second Gemini call.
// Falls back to null (caller uses "Vacancy poster") when AI is off or over budget.
async function inferEmployerPosterTitle(env, bytes, key = "") {
  try {
    const read = await readPosterCached(env, bytes, { key });
    const title = read && read.poster && read.poster.title;
    return title && title !== "Vacancy poster" ? title : null;
  } catch (error) {
    console.error("Gemini poster title inference error", error);
    return null;
  }
}
__name(inferEmployerPosterTitle, "inferEmployerPosterTitle");
async function deleteExpiredEmployerPosters(env) {
  let deleted = 0;
  // Up to 5 batches of 100 per run so a backlog clears in one go. A batch that
  // removes nothing stops the loop (the same rows would just be retried).
  for (let batch = 0; batch < 5; batch++) {
    const { body } = await supabaseGet(env, "employer_posters", {
      select: "id,image_url,expires_at",
      expires_at: `lte.${new Date().toISOString()}`,
      order: "expires_at.asc",
      limit: "100"
    });
    if (!Array.isArray(body) || !body.length) break;
    let removedInBatch = 0;
    for (const poster of body) {
      try {
        const key = employerPosterKey(poster.image_url, env);
        if (poster.image_url && !key) {
          console.error("Skipping expired poster with an unrecognized image URL", poster.id, poster.image_url);
          continue;
        }
        if (key) await env.MEDIA_BUCKET.delete(key);
        const removed = await supabaseRpc(env, "delete_expired_employer_poster", { p_poster_id: poster.id });
        if (removed === true) {
          removedInBatch++;
          deleted++;
        } else {
          console.error("Expired poster was not removed from the database", poster.id, removed);
        }
      } catch (error) {
        // Keep the database row when storage cleanup fails so the next scheduled
        // run can retry the same poster instead of losing track of its image.
        console.error("Expired poster cleanup failed", poster.id, error);
      }
    }
    if (!removedInBatch) break;
  }
  // Keep the D1 copy (what the app reads) in step and refresh the public data version.
  if (env.DB) {
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM employer_posters WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(new Date().toISOString()),
        ...(deleted ? [publicDataVersionBumpStatement(env)] : [])
      ]);
    } catch (error) {
      console.error("Expired poster D1 cleanup failed", error);
    }
  }
  return deleted;
}
__name(deleteExpiredEmployerPosters, "deleteExpiredEmployerPosters");
async function backfillMissingEmployerPosterTitles(env) {
  if (!env.GEMINI_API_KEY || !env.MEDIA_BUCKET) return 0;
  const now = new Date().toISOString();
  const { body } = await supabaseGet(env, "employer_posters", {
    select: "id,image_url,caption,expires_at",
    or: `(expires_at.is.null,expires_at.gt.${now})`,
    caption: "is.null",
    order: "created_at.asc",
    limit: "20"
  });
  // PostgREST's OR filter is combined with this empty-string branch to cover
  // both SQL NULL captions and older rows stored as an empty string.
  const rows = Array.isArray(body) ? body : [];
  if (rows.length < 20) {
    const extra = await supabaseGet(env, "employer_posters", {
      select: "id,image_url,caption,expires_at",
      or: `(expires_at.is.null,expires_at.gt.${now})`,
      caption: "eq.",
      order: "created_at.asc",
      limit: String(20 - rows.length)
    });
    rows.push(...(extra.body || []));
  }
  let updated = 0;
  for (const poster of rows) {
    try {
      const key = employerPosterKey(poster.image_url, env);
      if (!key) continue;
      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) continue;
      const title = await inferEmployerPosterTitle(env, await object.arrayBuffer(), key);
      if (!title) continue;
      const changed = await supabaseRpc(env, "set_employer_poster_caption_if_missing", {
        p_poster_id: poster.id,
        p_caption: title
      });
      if (changed === true) updated++;
    } catch (error) {
      console.error("Poster title backfill failed", poster.id, error);
    }
  }
  return updated;
}
__name(backfillMissingEmployerPosterTitles, "backfillMissingEmployerPosterTitles");

function agencyOutreachLocalTime(timestamp) {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(Number(timestamp) > 0 ? Number(timestamp) : Date.now()));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}
__name(agencyOutreachLocalTime, "agencyOutreachLocalTime");

function isAgencyOutreachDue(timestamp) {
  const local = agencyOutreachLocalTime(timestamp);
  return local.day === "01" && Number(local.hour) >= 9;
}
__name(isAgencyOutreachDue, "isAgencyOutreachDue");

async function runAgencyVacancyMonthlyOutreach(env, scheduledTime) {
  if (env.AGENCY_VACANCY_OUTREACH_ENABLED !== "true") {
    console.log("agency monthly outreach skipped: disabled");
    return { skipped: "disabled" };
  }
  if (!env.RESEND_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) {
    console.error("agency monthly outreach skipped: required service configuration is missing");
    return { skipped: "configuration" };
  }
  if (!isAgencyOutreachDue(scheduledTime)) return { skipped: "outside schedule" };
  const local = agencyOutreachLocalTime(scheduledTime);
  const campaignMonth = `${local.year}-${local.month}-01`;
  const recipients = await supabaseServiceRpc(env, "claim_agency_vacancy_monthly_outreach", { p_campaign_month: campaignMonth });
  if (!Array.isArray(recipients)) throw new Error("Outreach claim RPC returned an invalid response");
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const result = await sendAgencyVacancyOutreachEmail(env, recipient, campaignMonth);
    try {
      await supabaseServiceRpc(env, "complete_agency_vacancy_monthly_outreach", {
        p_agency_id: String(recipient.agency_id),
        p_campaign_month: campaignMonth,
        p_sent: result.sent === true,
        p_error: result.sent ? null : String(result.reason || "delivery failed").slice(0, 240)
      });
    } catch (e) {
      console.error("agency outreach ledger completion failed", e.status || "error");
    }
    if (result.sent) sent++;
    else failed++;
  }
  console.log("agency monthly outreach completed", campaignMonth, "claimed", recipients.length, "sent", sent, "failed", failed);
  return { claimed: recipients.length, sent, failed };
}
__name(runAgencyVacancyMonthlyOutreach, "runAgencyVacancyMonthlyOutreach");

var worker_default = {
  // Cloudflare invokes this on the cron schedule in wrangler.toml's
  // [triggers] block -- this is what keeps the D1 mirror fresh without any
  // per-visitor Supabase egress. ctx.waitUntil lets the sync finish even
  // though cron invocations don't wait on a returned Promise otherwise.
  async scheduled(event, env, ctx) {
    // Expired posters are removed on every scheduled tick, before anything slower
    // (watchdog / sync) can use up the run, so the admin list never keeps them.
    ctx.waitUntil(deleteExpiredEmployerPosters(env)
      .then((removed) => { if (removed) console.log("Expired employer posters removed", removed); })
      .catch((e) => { Sentry.captureException(e); console.error("scheduled expired-poster cleanup failed", e); }));
    if (event.cron === "0 7 1 * *") {
      ctx.waitUntil(runAgencyVacancyMonthlyOutreach(env, event.scheduledTime)
        .catch((e) => { Sentry.captureException(e); console.error("scheduled agency outreach failed", e.status || "error"); }));
      return;
    }
    // The regular six-hour tick is a bounded retry path for the monthly run.
    // The ledger still permits only one successful send per agency/month.
    if (event.cron === "0 */6 * * *" && isAgencyOutreachDue(event.scheduledTime)) {
      ctx.waitUntil(runAgencyVacancyMonthlyOutreach(env, event.scheduledTime)
        .catch((e) => { Sentry.captureException(e); console.error("scheduled agency outreach retry failed", e.status || "error"); }));
    }
    // "15,45 * * * *": lightweight self-healing watchdog (see watchdog.js). Offset from
    // the 6-hourly tick so the two never run at the same moment.
    if (event.cron === "15,45 * * * *") {
      ctx.waitUntil(runWatchdog(env, {}).catch((e) => { Sentry.captureException(e); console.error("scheduled watchdog failed", e); }));
      return;
    }
    ctx.waitUntil((async () => {
      try {
        // Deep check (validates the public snapshot) every 6h; the daily TipChat
        // Autopilot digest goes out with the 06:00 UTC tick (08:00 in South Africa).
        const result = await runWatchdog(env, { deep: true, digest: new Date(event.scheduledTime).getUTCHours() === 6 });
        if (result.problems.length) console.log("Watchdog open problems", result.problems.join(", "));
      } catch (e) {
        { Sentry.captureException(e); console.error("scheduled deep watchdog failed", e); };
      }
      try {
        const titled = await backfillMissingEmployerPosterTitles(env);
        if (titled) console.log("Missing employer poster titles filled", titled);
      } catch (e) {
        { Sentry.captureException(e); console.error("scheduled poster-title backfill failed", e); };
      }
      try {
        const ats = await syncAtsFeeds(env);
        console.log("ATS feed sync", JSON.stringify(ats));
      } catch (e) {
        { Sentry.captureException(e); console.error("scheduled ATS sync failed", e); };
      }
      try {
        await syncD1AndPublishSnapshot(env);
      } catch (e) {
        { Sentry.captureException(e); console.error("scheduled D1 sync failed", e); };
        await recordSyncFailure(env, e);
      }
      // After the D1 sync so newly scraped vacancies are already there to tidy and screen.
      try {
        const ai = await runAiMaintenance(env);
        console.log("AI maintenance", JSON.stringify(ai));
      } catch (e) {
        { Sentry.captureException(e); console.error("scheduled AI maintenance failed", e); };
      }
      // Publish at most one deterministic official vacancy roundup per day.
      // The app_settings kill switch is checked inside the publisher, so a
      // missing setting or service key fails closed without affecting sync.
      if (new Date(event.scheduledTime).getUTCHours() === 6) {
        try {
          const published = await publishTipchatVacancyRoundup(env, new Date(event.scheduledTime));
          console.log("TipChat vacancy publisher", JSON.stringify(published));
        } catch (e) {
          { Sentry.captureException(e); console.error("scheduled TipChat vacancy publisher failed", e); };
        }
      }
    })());
  },
  async fetch(request, env, ctx) {
    configureCors(env);
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    try {
      if (path === "/api/ats/sync" && (request.method === "GET" || request.method === "POST")) {
        if (!atsAuthMatches(request, env, request.method === "GET" ? (url.searchParams.get("secret") || "") : "")) return json({ ok: false, error: "Unauthorized" }, 401, origin);
        try {
          const results = await syncAtsFeeds(env);
          const vacancySnapshot = await buildPublicVacancySnapshotFromSupabase(env);
          vacancySnapshot.data_version = await bumpPublicDataVersion(env);
          await writePublicVacancySnapshot(env, vacancySnapshot);
          return json({ ok: true, results, published_vacancies: vacancySnapshot.vacancies.length }, 200, origin);
        } catch (error) { return json({ ok: false, error: "ATS sync failed", detail: String(error.message || error) }, 502, origin); }
      }
      if (path === "/api/v1/ats/jobs" && request.method === "POST") {
        return await handleAtsPush(request, env, origin);
      }
      if (path === "/api/yoco/webhook" && request.method === "POST") {
        return await yocoWebhookResponse(request, env);
      }
      if (path === "/api/unsubscribe/agency" && (request.method === "GET" || request.method === "POST")) {
        return await agencyOutreachUnsubscribeResponse(request, env);
      }
      if (path === "/api/cv-box/checkout" && request.method === "POST") {
        return await cvCheckoutResponse(request, env, origin);
      }
      if (path === "/api/cv-box/download" && request.method === "GET") {
        return await cvDownloadResponse(request, env);
      }
      if (path === "/api/cv-box" && request.method === "GET") {
        return await cvBoxResponse(request, env, origin);
      }
      if (path === "/api/startup" && request.method === "GET") {
        return await startupResponse(request, env, ctx, origin);
      }
      if (path === "/api/vacancies" && request.method === "GET") {
        return await vacanciesResponse(request, env, ctx, origin);
      }
      if (path === "/api/posters" && request.method === "GET") {
        // CV Pictures were retired from the app (replaced by the Scam Check). Nothing is served any more.
        return json({ posters: [], count: 0, retired: true }, 200, origin);
      }
      if (path === "/api/house-ads" && request.method === "GET") {
        return await houseAdsResponse(request, env, ctx, origin);
      }
      if (path === "/api/house-ads/event" && request.method === "POST") {
        return await houseAdEventResponse(request, env, origin);
      }
      if (path === "/api/admin/vacancies" && request.method === "GET") {
        return await adminVacanciesResponse(request, env, origin);
      }
      if (path === "/api/sync-status" && request.method === "GET") {
        return await syncStatusResponse(request, env, origin);
      }
      if (path === "/api/admin/d1/write-through" && request.method === "POST") {
        return await adminD1WriteThroughResponse(request, env, origin);
      }

      // These admin tables are intentionally not broadly readable by the
      // browser role. The old admin page converted RLS/schema errors into []
      // and therefore displayed misleading zero badges. Read them here after
      // verifying the signed-in admin, using the service role only server-side.
      if (path === "/api/admin/auxiliary" && request.method === "GET") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Unauthorized" }, 401, origin);
        }
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey || !env.SUPABASE_URL) {
          const missing = [!adminKey && "SUPABASE_SERVICE_ROLE_KEY", !env.SUPABASE_URL && "SUPABASE_URL"].filter(Boolean).join(" and ");
          return json({ error: `Admin data access is not configured: the Worker is missing ${missing}.` }, 503, origin);
        }
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}` };
        const tables = {
          reports: "reports",
          suggestions: "suggestions",
          jobEnquiries: "job_post_enquiries",
          jobSeekers: "job_seeker_requests",
          poolCandidates: "pool_candidates",
          posters: "employer_posters",
          houseAds: "house_ads",
          adRequests: "ad_requests",
          tracks: "daily_tracks"
        };
        const readTable = async (table) => {
          if (table === "house_ads" && env.DB) {
            try {
              const result = await env.DB.prepare("SELECT id,advertiser_name,title,message,image_url,target_url,placement,target_screens,ad_slot,ad_format,ad_details,cta_text,starts_at,ends_at,is_active,sort_order,impressions,clicks,created_at,updated_at FROM house_ads ORDER BY sort_order ASC, created_at DESC LIMIT 2000").all();
              return (result.results || []).map((ad) => ({ ...ad, target_screens: (() => { try { return JSON.parse(ad.target_screens || "[]"); } catch (e) { return []; } })(), is_active: Boolean(ad.is_active) }));
            } catch (error) {
              // D1 migrations are applied separately from Worker deployment and
              // may be temporarily unavailable. Fall through to the verified
              // Supabase service-role read instead of breaking the whole admin
              // auxiliary response.
              console.warn("admin house_ads D1 read unavailable; using Supabase", error);
            }
          }
          const query = new URLSearchParams({ select: "*", order: "created_at.desc", limit: "2000" });
          const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`${table}: ${response.status} ${detail.slice(0, 240)}`);
          }
          const rows = await response.json();
          return Array.isArray(rows) ? rows : [];
        };
        // A failed table must not look like an empty table. Report each failure
        // by name so the admin banner can say which table is broken and why.
        const errors = {};
        const entries = await Promise.all(Object.entries(tables).map(async ([key, table]) => {
          try {
            return [key, await readTable(table)];
          } catch (error) {
            console.error(`admin auxiliary read failed for ${table}`, error);
            errors[key] = String((error && error.message) || error).slice(0, 300);
            return [key, []];
          }
        }));
        const payload = Object.fromEntries(entries);
        if (Object.keys(errors).length) payload.errors = errors;
        return json(payload, 200, origin);
      }

      // Manual trigger for the D1 mirror sync -- same auth as the other
      // admin-only endpoints. The scheduled() export above runs this
      // automatically on the cron in wrangler.toml; this exists so a sync
      // can be forced immediately after a data change, without waiting for
      // the next cron tick.
      if (path === "/api/sync-d1" && request.method === "POST") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Unauthorized" }, 401, origin);
        }
        if (!env.DB) return json({ error: "D1 not bound" }, 500, origin);
        try {
          const summary = await syncD1AndPublishSnapshot(env);
          return json({ ok: true, ...summary }, 200, origin);
        } catch (error) {
          await recordSyncFailure(env, error);
          return json({ error: "Sync failed", detail: error.message }, 500, origin);
        }
      }
      if (path === "/api/sync-d1/internal" && request.method === "POST") {
        if (!isInternalSyncRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
        if (!env.DB) return json({ error: "D1 not bound" }, 500, origin);
        try {
          const summary = await publishFocusedScraperSources(env);
          return json({ ok: true, ...summary }, 200, origin);
        } catch (error) {
          await recordSyncFailure(env, error);
          return json({ error: "Sync failed", detail: String(error?.message || error).slice(0, 500) }, 500, origin);
        }
      }

      // Admin submission queue. Reports and suggestions are inserted through
      // SECURITY DEFINER RPCs, so the admin console must not depend on the
      // browser role having broad table SELECT/UPDATE/DELETE policies. The
      // Worker verifies the signed-in admin first, then uses the service role
      // only for this narrowly scoped queue and its actions.
      if (path === "/api/admin/submissions" && request.method === "GET") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Unauthorized" }, 401, origin);
        }
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) return json({ error: "Admin data access is not configured." }, 503, origin);
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}` };
        const [reportsRes, suggestionsRes] = await Promise.all([
          fetch(`${env.SUPABASE_URL}/rest/v1/reports?select=*&order=created_at.desc`, { headers }),
          fetch(`${env.SUPABASE_URL}/rest/v1/suggestions?select=*&order=created_at.desc`, { headers })
        ]);
        if (!reportsRes.ok || !suggestionsRes.ok) {
          return json({ error: "Could not load submissions." }, 502, origin);
        }
        return json({ reports: await reportsRes.json(), suggestions: await suggestionsRes.json() }, 200, origin);
      }
      // Ids may be uuid or numeric depending on the table's history, so accept
      // any safe id token (it is URL-encoded before it reaches PostgREST).
      const adminSubmissionMatch = path.match(/^\/api\/admin\/submissions\/(report|suggestion)\/([A-Za-z0-9_-]{1,64})$/);
      if (adminSubmissionMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Unauthorized" }, 401, origin);
        }
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) return json({ error: "Admin data access is not configured." }, 503, origin);
        const table = adminSubmissionMatch[1] === "report" ? "reports" : "suggestions";
        const id = adminSubmissionMatch[2];
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
        const target = `${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id`;
        let response;
        if (request.method === "DELETE") {
          response = await fetch(target, { method: "DELETE", headers });
        } else {
          const body = await request.json().catch(() => ({}));
          const status = body.status === "resolved" ? "resolved" : "open";
          response = await fetch(target, { method: "PATCH", headers, body: JSON.stringify({ status }) });
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.error("admin submission action failed", table, id, response.status, detail.slice(0, 300));
          return json({ error: "Could not update submission.", detail: detail.slice(0, 200) }, 502, origin);
        }
        const affected = await response.json().catch(() => []);
        if (Array.isArray(affected) && !affected.length) return json({ error: "That submission no longer exists." }, 404, origin);
        return json({ ok: true }, 200, origin);
      }

      // Ad requests (free advertising applications): status / notes / delete / file download.
      const cvPartnerMatch = path.match(/^\/api\/admin\/cv-box-partner\/([A-Za-z0-9_-]{1,80})$/);
      if (cvPartnerMatch && request.method === "POST") {
        if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
        if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Admin data access is not configured." }, 503, origin);
        const body = await request.json().catch(() => ({}));
        if (typeof body.partner !== "boolean") return json({ error: "partner must be true or false." }, 400, origin);
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/agencies?id=eq.${encodeURIComponent(cvPartnerMatch[1])}`, {
          method: "PATCH",
          headers: cvBoxServiceHeaders(env, { "Content-Type": "application/json", Prefer: "return=representation" }),
          body: JSON.stringify({ cv_box_partner: body.partner, cv_box_partner_since: body.partner ? new Date().toISOString() : null })
        });
        if (!res.ok) return json({ error: "Could not update partner access. Has the 20261117 migration been run?" }, 502, origin);
        const rows = await res.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) return json({ error: "Agency not found." }, 404, origin);
        return json({ ok: true, partner: body.partner }, 200, origin);
      }
      const adReqMatch = path.match(/^\/api\/admin\/ad-requests\/([0-9a-fA-F-]{36})$/);
      const adReqFileMatch = path.match(/^\/api\/admin\/ad-requests\/([0-9a-fA-F-]{36})\/file\/(\d{1,2})$/);
      if ((adReqMatch && (request.method === "POST" || request.method === "DELETE")) || (adReqFileMatch && request.method === "GET")) {
        if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) return json({ error: "Admin data access is not configured." }, 503, origin);
        const reqId = (adReqMatch || adReqFileMatch)[1];
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
        const rowUrl = `${env.SUPABASE_URL}/rest/v1/ad_requests?id=eq.${encodeURIComponent(reqId)}`;
        if (adReqFileMatch) {
          const rowRes = await fetch(`${rowUrl}&select=files`, { headers });
          const rows = rowRes.ok ? await rowRes.json().catch(() => []) : [];
          const file = rows[0] && Array.isArray(rows[0].files) ? rows[0].files[Number(adReqFileMatch[2])] : null;
          if (!file || !file.key || !env.MEDIA_BUCKET) return json({ error: "File not found." }, 404, origin);
          const object = await env.MEDIA_BUCKET.get(file.key);
          if (!object) return json({ error: "File not found." }, 404, origin);
          return new Response(object.body, { status: 200, headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${String(file.name || "file").replace(/[^A-Za-z0-9._-]/g, "_")}"`,
            "Cache-Control": "private, no-store",
            ...corsHeaders(origin)
          } });
        }
        if (request.method === "DELETE") {
          const rowRes = await fetch(`${rowUrl}&select=files`, { headers });
          const rows = rowRes.ok ? await rowRes.json().catch(() => []) : [];
          const delRes = await fetch(`${rowUrl}&select=id`, { method: "DELETE", headers });
          if (!delRes.ok) return json({ error: "Could not delete the request." }, 502, origin);
          if (env.MEDIA_BUCKET && rows[0] && Array.isArray(rows[0].files)) {
            for (const f of rows[0].files) { if (f && f.key) { try { await env.MEDIA_BUCKET.delete(f.key); } catch (_) {} } }
          }
          return json({ ok: true }, 200, origin);
        }
        const body = await request.json().catch(() => ({}));
        const patch = { updated_at: new Date().toISOString() };
        if (body.status !== void 0) {
          if (!["new", "in_progress", "published", "rejected"].includes(body.status)) return json({ error: "Invalid status." }, 400, origin);
          patch.status = body.status;
        }
        if (body.admin_notes !== void 0) patch.admin_notes = String(body.admin_notes ?? "").slice(0, 2000);
        if (Object.keys(patch).length < 2) return json({ error: "Nothing to update." }, 400, origin);
        const res = await fetch(`${rowUrl}&select=id`, { method: "PATCH", headers, body: JSON.stringify(patch) });
        if (!res.ok) return json({ error: "Could not update the request." }, 502, origin);
        const affected = await res.json().catch(() => []);
        if (Array.isArray(affected) && !affected.length) return json({ error: "That request no longer exists." }, 404, origin);
        return json({ ok: true }, 200, origin);
      }
      // Job enquiries: edit / change status / delete through the service role so
      // the admin console never depends on browser-side RLS policies.
      const adminEnquiryMatch = path.match(/^\/api\/admin\/job-enquiries\/([A-Za-z0-9_-]{1,64})$/);
      if (adminEnquiryMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) return json({ error: "Admin data access is not configured." }, 503, origin);
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
        const target = `${env.SUPABASE_URL}/rest/v1/job_post_enquiries?id=eq.${encodeURIComponent(adminEnquiryMatch[1])}&select=id,company_name,contact_person,work_email,status`;
        let response;
        let previous = null;
        if (request.method === "DELETE") {
          response = await fetch(target, { method: "DELETE", headers });
        } else {
          const body = await request.json().catch(() => ({}));
          const patch = {};
          if (body.status !== void 0) {
            if (!["new", "approved", "contacted", "rejected", "resolved"].includes(body.status)) return json({ error: "Invalid status." }, 400, origin);
            const current = await fetch(target, { headers });
            if (!current.ok) return json({ error: "Could not read the current enquiry." }, 502, origin);
            const rows = await current.json().catch(() => []);
            previous = Array.isArray(rows) ? rows[0] || null : null;
            if (!previous) return json({ error: "That enquiry no longer exists." }, 404, origin);
            patch.status = body.status;
          }
          for (const field of ["company_name", "contact_person", "work_email", "phone", "industry", "positions_to_fill", "additional_details", "website"]) {
            if (body[field] !== void 0) patch[field] = String(body[field] ?? "").slice(0, field === "additional_details" ? 4000 : 300);
          }
          if (Array.isArray(body.role_types)) patch.role_types = body.role_types.map((r) => String(r).slice(0, 60)).slice(0, 20);
          if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400, origin);
          if (patch.company_name === "" || patch.work_email === "") return json({ error: "Company name and work email are required." }, 400, origin);
          response = await fetch(target, { method: "PATCH", headers, body: JSON.stringify(patch) });
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.error("admin job enquiry action failed", response.status, detail.slice(0, 300));
          return json({ error: "Could not update the enquiry.", detail: detail.slice(0, 200) }, 502, origin);
        }
        const affected = await response.json().catch(() => []);
        if (Array.isArray(affected) && !affected.length) return json({ error: "That enquiry no longer exists." }, 404, origin);
        if (request.method === "POST" && previous && previous.status !== affected[0].status) {
          await sendSubmissionStatusEmail(env, { to: affected[0].work_email || previous.work_email, name: affected[0].contact_person || previous.contact_person || previous.company_name, kind: "job", status: affected[0].status });
        }
        return json({ ok: true }, 200, origin);
      }

      // "Looking for work?" requests: status updates (new / contacted / added /
      // closed, plus the linked CV Box id) and deletion, service role only.
      const adminSeekerMatch = path.match(/^\/api\/admin\/job-seekers\/([A-Za-z0-9_-]{1,64})$/);
      if (adminSeekerMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) return json({ error: "Admin data access is not configured." }, 503, origin);
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
        const target = `${env.SUPABASE_URL}/rest/v1/job_seeker_requests?id=eq.${encodeURIComponent(adminSeekerMatch[1])}&select=id,full_name,email,status`;
        let response;
        let previous = null;
        if (request.method === "DELETE") {
          response = await fetch(target, { method: "DELETE", headers });
        } else {
          const body = await request.json().catch(() => ({}));
          const patch = {};
          if (body.status !== void 0) {
            if (!["new", "contacted", "added", "closed"].includes(body.status)) return json({ error: "Invalid status." }, 400, origin);
            const current = await fetch(target, { headers });
            if (!current.ok) return json({ error: "Could not read the current request." }, 502, origin);
            const rows = await current.json().catch(() => []);
            previous = Array.isArray(rows) ? rows[0] || null : null;
            if (!previous) return json({ error: "That request no longer exists." }, 404, origin);
            patch.status = body.status;
          }
          if (body.talent_pool_id !== void 0) patch.talent_pool_id = body.talent_pool_id ? String(body.talent_pool_id).slice(0, 120) : null;
          if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400, origin);
          response = await fetch(target, { method: "PATCH", headers, body: JSON.stringify(patch) });
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.error("admin job seeker action failed", response.status, detail.slice(0, 300));
          return json({ error: "Could not update the request.", detail: detail.slice(0, 200) }, 502, origin);
        }
        const affected = await response.json().catch(() => []);
        if (Array.isArray(affected) && !affected.length) return json({ error: "That request no longer exists." }, 404, origin);
        if (request.method === "POST" && previous && previous.status !== affected[0].status) {
          await sendSubmissionStatusEmail(env, { to: affected[0].email || previous.email, name: affected[0].full_name || previous.full_name, kind: "seeker", status: affected[0].status });
        }
        return json({ ok: true }, 200, origin);
      }

      // Vacancy posters: edit / delete through the service role (no browser RLS
      // policy exists for these), remove the R2 image on delete, and keep the
      // public D1 mirror in step so the app updates immediately.
      const adminPosterMatch = path.match(/^\/api\/admin\/posters\/([A-Za-z0-9_-]{1,64})$/);
      if (adminPosterMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await isAdminRequest(request, env)) return json({ error: "Unauthorized" }, 401, origin);
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) return json({ error: "Admin data access is not configured." }, 503, origin);
        const posterId = adminPosterMatch[1];
        const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
        const target = `${env.SUPABASE_URL}/rest/v1/employer_posters?id=eq.${encodeURIComponent(posterId)}`;
        if (request.method === "DELETE") {
          const lookup = await fetch(`${target}&select=id,image_url`, { headers });
          const found = lookup.ok ? await lookup.json().catch(() => []) : [];
          const response = await fetch(`${target}&select=id`, { method: "DELETE", headers });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            console.error("admin poster delete failed", posterId, response.status, detail.slice(0, 300));
            return json({ error: "Could not delete the poster.", detail: detail.slice(0, 200) }, 502, origin);
          }
          const removed = await response.json().catch(() => []);
          if (Array.isArray(removed) && !removed.length) return json({ error: "That poster no longer exists." }, 404, origin);
          // Best-effort cleanup: the database row is already gone, so a storage
          // or mirror hiccup must not turn the delete into an error.
          try {
            const key = found[0] && found[0].image_url ? employerPosterKey(found[0].image_url, env) : null;
            if (key && env.MEDIA_BUCKET) await env.MEDIA_BUCKET.delete(key);
          } catch (e) { console.error("poster image cleanup failed", posterId, e); }
          try {
            if (env.DB) await env.DB.batch([env.DB.prepare("DELETE FROM employer_posters WHERE id = ?").bind(posterId), publicDataVersionBumpStatement(env)]);
          } catch (e) { console.error("poster D1 mirror delete failed", posterId, e); }
          return json({ ok: true }, 200, origin);
        }
        const body = await request.json().catch(() => ({}));
        const patch = {};
        if (body.caption !== void 0) patch.caption = String(body.caption ?? "").trim().slice(0, 500) || null;
        if (body.employer_id !== void 0) patch.employer_id = body.employer_id ? String(body.employer_id).slice(0, 120) : null;
        if (body.agency_id !== void 0) patch.agency_id = body.agency_id ? String(body.agency_id).slice(0, 120) : null;
        if (body.expires_at !== void 0) {
          if (body.expires_at !== null && Number.isNaN(Date.parse(body.expires_at))) return json({ error: "Invalid expiry date." }, 400, origin);
          patch.expires_at = body.expires_at;
        }
        if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400, origin);
        const response = await fetch(`${target}&select=*`, { method: "PATCH", headers, body: JSON.stringify(patch) });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.error("admin poster update failed", posterId, response.status, detail.slice(0, 300));
          return json({ error: "Could not update the poster.", detail: detail.slice(0, 200) }, 502, origin);
        }
        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) return json({ error: "That poster no longer exists." }, 404, origin);
        try {
          if (env.DB) {
            const spec = D1_WRITE_THROUGH_SPECS.employer_posters;
            const schema = await env.DB.prepare("PRAGMA table_info(employer_posters)").all();
            const available = new Set((schema.results || []).map((column) => column.name));
            const columns = spec.columns.filter((column) => available.has(column) && Object.prototype.hasOwnProperty.call(rows[0], column));
            if (columns.includes("id")) await env.DB.batch([prepareD1WriteThroughUpsert(env, "employer_posters", spec, columns, rows[0]), publicDataVersionBumpStatement(env)]);
          }
        } catch (e) { console.error("poster D1 mirror update failed", posterId, e); }
        return json({ ok: true, poster: rows[0] }, 200, origin);
      }

      // ---------- Smart Manager: server-side token flows ----------
      // The browser sends the token it received in the manager link; the
      // authorization decision happens in the database, not the client.
      if (path === "/api/verify-manager" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token) return json({ error: "Missing token." }, 400, origin);
        try {
          const rows = await supabaseRpc(env, "verify_manager_token", { p_token: String(body.token) });
          const agency = Array.isArray(rows) ? rows[0] : null;
          if (!agency) return json({ valid: false }, 200, origin);
          const vacancyAnalytics = await managerVacancyAnalytics(env, String(body.token), "agency");
          const marketingPreference = await managerAgencyMarketingPreference(env, String(body.token));
          return json({ valid: true, agency, vacancy_analytics: vacancyAnalytics, marketing_preference: marketingPreference }, 200, origin);
        } catch (e) {
          return json({ error: "Token check failed.", detail: e.detail }, 502, origin);
        }
      }
      // ---------- CV Box for partner agencies (Manager Link) ----------
      if (path.startsWith("/api/manager/cv-box") && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        let partner;
        try { partner = await cvBoxPartnerFromToken(env, String(body.token || "")); }
        catch (e) { return json({ error: "CV Box is temporarily unavailable." }, e.status === 503 ? 503 : 502, origin); }
        if (!partner) return json({ error: "Invalid manager link." }, 403, origin);

        // Ask for partner access (works for any valid manager link, does nothing for existing partners)
        if (path === "/api/manager/cv-box/request") {
          if (partner.cv_box_partner) return json({ ok: true, already: true }, 200, origin);
          await sendNotificationEmail(env, {
            to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
            email_subject: "SA Recruiters | CV Box partner request — " + String(partner.name || "").slice(0, 120),
            notification_type: "CV BOX PARTNER REQUEST",
            notification_title: "An agency asked for CV Box access",
            notification_intro: "Check that the agency has started sending its candidates to the CV Box, then switch on 'CV Box partner' in Admin > Agencies > Edit.",
            notification_body: "Agency: " + String(partner.name || "") + "\nAgency ID: " + String(partner.id)
          });
          return json({ ok: true }, 200, origin);
        }

        if (!partner.cv_box_partner) return json({ partner: false, agency: String(partner.name || "") }, 200, origin);

        // Searchable list: public-safe profile fields only. Contact details and CV files are never in this list.
        if (path === "/api/manager/cv-box") {
          const rawQ = String(body.q || "").replace(/[^\p{L}\p{N} .'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
          const sector = String(body.sector || "").replace(/[^\p{L}\p{N} &,/'.()-]/gu, "").slice(0, 80);
          const offset = Math.max(0, Math.min(5000, parseInt(body.offset, 10) || 0));
          const q = new URLSearchParams({
            select: "id,full_name,position,sector,location,experience_years,about_you,photo_url,verified,created_at,availability,availability_expires_at,cv_link,contact_phone,contact_email",
            status: "eq.active", order: "created_at.desc", limit: String(CV_PARTNER_PAGE_SIZE), offset: String(offset)
          });
          if (rawQ) q.set("or", `(full_name.ilike.*${rawQ}*,position.ilike.*${rawQ}*,location.ilike.*${rawQ}*,sector.ilike.*${rawQ}*)`);
          if (sector) q.set("sector", `eq.${sector}`);
          const res = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${q}`, { headers: cvBoxServiceHeaders(env, { Prefer: "count=exact" }) });
          if (!res.ok) return json({ error: "CV Box could not be loaded." }, 502, origin);
          const total = parseInt((res.headers.get("content-range") || "").split("/")[1], 10);
          const rows = await res.json().catch(() => []);
          const now = Date.now();
          const items = (Array.isArray(rows) ? rows : []).map((r) => ({
            id: r.id, full_name: r.full_name, position: r.position, sector: cvBoxPublicSector(r.sector), location: r.location,
            experience_years: r.experience_years, about_you: String(r.about_you || "").slice(0, 400), photo_url: r.photo_url || "",
            verified: !!r.verified, created_at: r.created_at, availability: String(r.availability || "").slice(0, 40),
            availability_expired: !!(r.availability_expires_at && Date.parse(r.availability_expires_at) < now),
            has_cv: !!r.cv_link, has_contact: !!(String(r.contact_phone || "").trim() || String(r.contact_email || "").trim())
          }));
          const used = await cvBoxPartnerActionsToday(env, partner.id);
          return json({ partner: true, agency: String(partner.name || ""), items, total: Number.isFinite(total) ? total : items.length, offset, page_size: CV_PARTNER_PAGE_SIZE, actions_left: Math.max(0, CV_PARTNER_DAILY_LIMIT - used) }, 200, origin);
        }

        // One candidate at a time: reveal contact details, or download the CV file. Both are logged and capped.
        const candidateId = String(body.id || "");
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidateId)) return json({ error: "Invalid candidate." }, 400, origin);
        if (await cvBoxPartnerActionsToday(env, partner.id) >= CV_PARTNER_DAILY_LIMIT) {
          return json({ error: "You have reached today's CV Box limit. It resets within 24 hours. Contact SA Recruiters if you need more." }, 429, origin);
        }
        const cq = new URLSearchParams({ select: "id,full_name,cv_link,contact_phone,contact_email", id: `eq.${candidateId}`, status: "eq.active", limit: "1" });
        const cres = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${cq}`, { headers: cvBoxServiceHeaders(env) });
        if (!cres.ok) return json({ error: "CV Box could not be loaded." }, 502, origin);
        const candidate = (await cres.json().catch(() => []))[0];
        if (!candidate) return json({ error: "This candidate is no longer in the CV Box." }, 404, origin);

        if (path === "/api/manager/cv-box/candidate") {
          await cvBoxPartnerLog(env, partner, candidate.id, "contact");
          return json({ id: candidate.id, phone: String(candidate.contact_phone || "").trim(), email: String(candidate.contact_email || "").trim() }, 200, origin);
        }
        if (path === "/api/manager/cv-box/download") {
          if (!candidate.cv_link) return json({ error: "This profile does not have a CV file yet." }, 409, origin);
          const file = await cvBoxFetchStoredCv(env, candidate.cv_link);
          if (file.error) return json({ error: file.error }, file.status || 502, origin);
          await cvBoxPartnerLog(env, partner, candidate.id, "download");
          const safeName = String(candidate.full_name || "candidate").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "candidate";
          return new Response(file.bytes, { status: 200, headers: {
            ...corsHeaders(origin), "Content-Type": file.contentType, "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `attachment; filename="SA-Recruiters-CV-${safeName}.${file.ext}"`, "Access-Control-Expose-Headers": "Content-Disposition"
          } });
        }
        return json({ error: "Not found" }, 404, origin);
      }
      if (path === "/api/manager/email-preference" && request.method === "GET") {
        const token = url.searchParams.get("token") || "";
        if (!token) return json({ error: "Missing token." }, 400, origin);
        const preference = await managerAgencyMarketingPreference(env, token);
        if (!preference) return json({ error: "Preference settings are unavailable." }, 503, origin);
        return json({ preference }, 200, origin);
      }
      if (path === "/api/manager/email-preference" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (typeof body.token !== "string" || !body.token || typeof body.opted_in !== "boolean") {
          return json({ error: "A manager token and an explicit preference are required." }, 400, origin);
        }
        try {
          const rows = await supabaseServiceRpc(env, "set_agency_vacancy_email_preference", {
            p_token: body.token,
            p_opted_in: body.opted_in
          });
          const row = Array.isArray(rows) ? rows[0] : null;
          if (!row) return json({ error: "Manager link is invalid." }, 403, origin);
          const preference = { email: String(row.agency_email || ""), opted_in: row.opted_in === true };
          if (body.opted_in && !preference.opted_in) {
            return json({ error: "A valid agency email address is required before opting in." }, 422, origin);
          }
          return json({ ok: true, preference }, 200, origin);
        } catch (e) {
          console.error("manager email preference save failed", e.status || "error");
          return json({ error: "Preference settings are temporarily unavailable." }, 503, origin);
        }
      }
      if (path === "/api/verify-employer-manager" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token) return json({ error: "Missing token." }, 400, origin);
        try {
          const rows = await supabaseRpc(env, "verify_employer_manager_token", { p_token: String(body.token) });
          const employer = Array.isArray(rows) ? rows[0] : null;
          if (!employer) return json({ valid: false }, 200, origin);
          const vacancyAnalytics = await managerVacancyAnalytics(env, String(body.token), "employer");
          return json({ valid: true, employer, vacancy_analytics: vacancyAnalytics }, 200, origin);
        } catch (e) {
          return json({ error: "Token check failed.", detail: e.detail }, 502, origin);
        }
      }
      if (path === "/api/manager/branch" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token || !body.branch_id || !body.name) {
          return json({ error: "Missing fields." }, 400, origin);
        }
        const result = await supabaseRpc(env, "manager_add_branch", {
          p_token: String(body.token),
          p_branch_id: String(body.branch_id),
          p_name: String(body.name),
          p_location: String(body.location || ""),
          p_phone: String(body.phone || ""),
          p_email: String(body.email || "")
        });
        if (!result) return json({ error: "Invalid manager link." }, 403, origin);
        return json({ ok: true, branch_id: result }, 200, origin);
      }
      if (path === "/api/manager/vacancy" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token || !body.vacancy_id || !body.title) {
          return json({ error: "Missing fields." }, 400, origin);
        }
        const agencyRows = await supabaseRpc(env, "verify_manager_token", { p_token: String(body.token) });
        const agencyRecord = Array.isArray(agencyRows) ? agencyRows[0] : null;
        if (!agencyRecord?.id) return json({ error: "Invalid manager link." }, 403, origin);
        const result = await supabaseRpc(env, "manager_add_vacancy", {
          p_token: String(body.token),
          p_vacancy_id: String(body.vacancy_id),
          p_title: String(body.title),
          p_location: String(body.location || ""),
          p_employment_type: String(body.employment_type || ""),
          p_contract_type: String(body.contract_type || ""),
          p_salary: String(body.salary || ""),
          p_hours: String(body.hours || ""),
          p_work_schedule: String(body.work_schedule || ""),
          p_start_date: String(body.start_date || ""),
          p_closing_date: String(body.closing_date || ""),
          p_notes: String(body.notes || ""),
          p_link: String(body.link || "")
        });
        if (!result) return json({ error: "Invalid manager link." }, 403, origin);
        await mirrorManagerVacancy(env, {
          id: String(body.vacancy_id), agency_id: String(agencyRecord.id), employer_id: null,
          title: String(body.title), company: null, location: String(body.location || ""),
          closing_date: String(body.closing_date || ""), notes: String(body.notes || ""),
          link: String(body.link || ""), email: null, phone: null, remote: null,
          experience_level: null, employment_type: String(body.employment_type || ""),
          contract_type: String(body.contract_type || ""), work_schedule: String(body.work_schedule || ""),
          hours: String(body.hours || ""), salary: String(body.salary || ""),
          start_date: String(body.start_date || ""), created_at: new Date().toISOString(), source_type: "manager"
        });
        return json({ ok: true, vacancy_id: result }, 200, origin);
      }
      if (path === "/api/manager/employer-vacancy" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token || !body.vacancy_id || !body.title) {
          return json({ error: "Missing fields." }, 400, origin);
        }
        const employerRows = await supabaseRpc(env, "verify_employer_manager_token", { p_token: String(body.token) });
        const employerRecord = Array.isArray(employerRows) ? employerRows[0] : null;
        if (!employerRecord?.id) return json({ error: "Invalid manager link." }, 403, origin);
        const result = await supabaseRpc(env, "manager_employer_add_vacancy", {
          p_token: String(body.token),
          p_vacancy_id: String(body.vacancy_id),
          p_title: String(body.title),
          p_company: String(body.company || ""),
          p_location: String(body.location || ""),
          p_employment_type: String(body.employment_type || ""),
          p_experience_level: String(body.experience_level || ""),
          p_contract_type: String(body.contract_type || ""),
          p_salary: String(body.salary || ""),
          p_hours: String(body.hours || ""),
          p_work_schedule: String(body.work_schedule || ""),
          p_start_date: String(body.start_date || ""),
          p_closing_date: String(body.closing_date || ""),
          p_notes: String(body.notes || ""),
          p_link: String(body.link || ""),
          p_email: String(body.email || ""),
          p_phone: String(body.phone || "")
        });
        if (!result) return json({ error: "Invalid manager link." }, 403, origin);
        await mirrorManagerVacancy(env, {
          id: String(body.vacancy_id), agency_id: "employer", employer_id: String(employerRecord.id),
          title: String(body.title), company: String(body.company || ""), location: String(body.location || ""),
          closing_date: String(body.closing_date || ""), notes: String(body.notes || ""),
          link: String(body.link || ""), email: String(body.email || ""), phone: String(body.phone || ""), remote: null,
          experience_level: String(body.experience_level || ""), employment_type: String(body.employment_type || ""),
          contract_type: String(body.contract_type || ""), work_schedule: String(body.work_schedule || ""),
          hours: String(body.hours || ""), salary: String(body.salary || ""),
          start_date: String(body.start_date || ""), created_at: new Date().toISOString(), source_type: "manager"
        });
        return json({ ok: true, vacancy_id: result }, 200, origin);
      }

      // ---------- Public submissions: Turnstile-gated, DB insert + Resend email ----------
      if (path === "/api/submit/report" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const reportUserId = await verifiedUserId(request, env);
        try {
          await supabaseRpc(env, "public_submit_report", {
            p_agency_name: String(body.agency_name || "").slice(0, 200),
            p_agency_id: body.agency_id ? String(body.agency_id) : null,
            p_reason: String(body.reason || "").slice(0, 200),
            p_details: String(body.details || "").slice(0, 4000),
            p_user_id: reportUserId
          });
        } catch (e) {
          return json({ error: "Could not save the report.", detail: e.detail }, 502, origin);
        }
        const email = await sendNotificationEmail(env, {
          to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
          email_subject: "SA Recruiters | New report received",
          notification_type: "REPORT",
          notification_title: "New report received",
          notification_intro: "A user submitted a report about a listing or agency.",
          notification_body: "Agency: " + (body.agency_name || "-") + "\nReason: " + (body.reason || "-") + "\nDetails: " + (body.details || "-")
        });
        return json({ ok: true, email }, 200, origin);
      }
      if (path === "/api/submit/suggestion" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const suggestionUserId = await verifiedUserId(request, env);
        try {
          await supabaseRpc(env, "public_submit_suggestion", {
            p_type: String(body.type || "suggestion").slice(0, 50),
            p_agency_name: String(body.agency_name || "").slice(0, 200),
            p_details: String(body.details || "").slice(0, 4000),
            p_user_id: suggestionUserId
          });
        } catch (e) {
          return json({ error: "Could not save the suggestion.", detail: e.detail }, 502, origin);
        }
        const email = await sendNotificationEmail(env, {
          to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
          email_subject: "SA Recruiters | New suggestion received",
          notification_type: "SUGGESTION",
          notification_title: "New suggestion received",
          notification_intro: "A user submitted a suggestion or comment through SA Recruiters.",
          notification_body: "Type: " + (body.type || "-") + "\nAgency: " + (body.agency_name || "-") + "\nDetails: " + (body.details || "-")
        });
        return json({ ok: true, email }, 200, origin);
      }
      // ---------- "Advertise with us" application (free business advertising) ----------
      // Multipart form from the static /advertise/ page: business details plus a
      // logo and/or business card. Files go to R2 under unguessable keys, the row
      // goes to ad_requests (service role; table has no browser access) and a
      // Resend email with the files attached goes to the admin.
      if (path === "/api/submit/ad-request" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!env.MEDIA_BUCKET || !serviceKey || !env.SUPABASE_URL) {
          return json({ error: "Applications are temporarily unavailable. Please WhatsApp 071 553 1005." }, 503, origin);
        }
        let form;
        try { form = await request.formData(); } catch (e) { return json({ error: "Could not read the form. Please try again." }, 400, origin); }
        const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
        if (clean(form.get("company_site"), 50)) return json({ ok: true }, 200, origin); // honeypot: bots fill this in
        const businessName = clean(form.get("business_name"), 200);
        const contactPerson = clean(form.get("contact_person"), 200);
        const phone = clean(form.get("phone"), 60);
        const emailAddr = clean(form.get("email"), 200);
        let website = clean(form.get("website"), 300);
        const category = clean(form.get("category"), 120);
        const province = clean(form.get("province"), 80);
        const adMessage = String(form.get("ad_message") ?? "").replace(/\r/g, "").trim().slice(0, 1500);
        if (!businessName) return json({ error: "Please add your business name." }, 400, origin);
        if (!contactPerson) return json({ error: "Please add a contact person." }, 400, origin);
        if (!phone) return json({ error: "Please add a phone or WhatsApp number." }, 400, origin);
        if (emailAddr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) return json({ error: "That email address does not look right." }, 400, origin);
        if (form.get("consent") !== "yes") return json({ error: "Please tick the box to confirm we may contact you and use your logo." }, 400, origin);
        if (website && !/^https?:\/\//i.test(website)) website = "https://" + website;
        const picked = [];
        for (const [kind, limit] of [["logo", 1], ["card", 2], ["other", 2]]) {
          const list = form.getAll(kind).filter((f) => f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0).slice(0, limit);
          for (const file of list) picked.push({ kind, file });
        }
        if (!picked.some((x) => x.kind === "logo" || x.kind === "card")) {
          return json({ error: "Please upload your logo or your business card." }, 400, origin);
        }
        const stored = [];
        const uploadedKeys = [];
        const attachments = [];
        let attachBytes = 0;
        try {
          for (const { kind, file } of picked) {
            if (file.size > AD_REQUEST_MAX_FILE_BYTES) return json({ error: "Each file must be under 5MB." }, 413, origin);
            const bytes = await file.arrayBuffer();
            const detected = detectAdFileType(bytes);
            if (!detected) return json({ error: "Files must be PNG, JPG, WebP or PDF." }, 400, origin);
            const key = `ad-requests/${crypto.randomUUID()}.${detected.ext}`;
            await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: detected.type } });
            uploadedKeys.push(key);
            const niceName = `${safeFileStem(businessName)}-${kind}-${stored.length + 1}.${detected.ext}`;
            stored.push({ key, name: niceName, type: detected.type, size: bytes.byteLength, kind });
            if (attachBytes + bytes.byteLength <= AD_REQUEST_MAX_EMAIL_ATTACH_BYTES) {
              attachBytes += bytes.byteLength;
              attachments.push({ filename: niceName, content: bufferToBase64(bytes) });
            }
          }
          const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/ad_requests`, {
            method: "POST",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify({ business_name: businessName, contact_person: contactPerson, phone, email: emailAddr, website, category, province, ad_message: adMessage, files: stored, status: "new" })
          });
          if (!insertRes.ok) {
            const detail = await insertRes.text().catch(() => "");
            console.error("ad request insert failed", insertRes.status, detail.slice(0, 300));
            throw new Error("insert failed");
          }
          const rows = await insertRes.json().catch(() => []);
          const requestId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
          const fileLines = stored.length ? stored.map((f) => "- " + f.kind + ": " + publicUrlFor(env, f.key)).join("\n") : "-";
          const email = await sendNotificationEmail(env, {
            to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
            email_subject: "SA Recruiters | New FREE advertising application — " + businessName,
            notification_type: "ADVERTISING APPLICATION",
            notification_title: "New free advertising application",
            notification_intro: "A business applied for free advertising. Their logo and business card are attached to this email and saved in the admin page (Submissions → Ad requests).",
            notification_body: "Business: " + businessName +
              "\nContact person: " + contactPerson +
              "\nPhone / WhatsApp: " + phone +
              "\nEmail: " + (emailAddr || "-") +
              "\nWebsite: " + (website || "-") +
              "\nCategory: " + (category || "-") +
              "\nProvince: " + (province || "-") +
              "\nWhat the ad should say: " + (adMessage || "-") +
              "\n\nFiles:\n" + fileLines,
            reply_to: emailAddr || void 0,
            attachments
          });
          return json({ ok: true, id: requestId, email: { sent: !!email.sent } }, 200, origin);
        } catch (e) {
          for (const key of uploadedKeys) { try { await env.MEDIA_BUCKET.delete(key); } catch (_) {} }
          return json({ error: "Could not send your application. Please try again or WhatsApp 071 553 1005." }, 502, origin);
        }
      }
      // ---------- "Post a job" enquiry (public, ALWAYS open — see 20260923_add_job_post_enquiries.sql) ----------
      // Deliberately separate from /api/submit/employer-register: this is a
      // low-friction lead form (firstjobly.co.za/post-a-job style) that is
      // never gated behind a "self-registration closed" flag. Used by both
      // the in-app sheet and the static /post-a-job/ page.
      if (path === "/api/submit/job-enquiry" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const companyName = String(body.company_name || "").trim().slice(0, 200);
        const workEmail = String(body.work_email || "").trim().slice(0, 200);
        if (!companyName || !workEmail) {
          return json({ error: "Add your company name and work email." }, 400, origin);
        }
        const roleTypes = Array.isArray(body.role_types)
          ? body.role_types.map((r) => String(r).slice(0, 60)).slice(0, 20)
          : [];
        const enquiryUserId = await verifiedUserId(request, env);
        try {
          await supabaseRpc(env, "public_submit_job_enquiry", {
            p_company_name: companyName,
            p_contact_person: String(body.contact_person || "").slice(0, 200),
            p_work_email: workEmail,
            p_phone: String(body.phone || "").slice(0, 60),
            p_industry: String(body.industry || "").slice(0, 200),
            p_positions_to_fill: String(body.positions_to_fill || "").slice(0, 60),
            p_role_types: roleTypes,
            p_additional_details: String(body.additional_details || "").slice(0, 4000),
            p_website: String(body.website || "").slice(0, 300),
            p_user_id: enquiryUserId
          });
        } catch (e) {
          return json({ error: "Could not send your enquiry — please try again.", detail: e.detail }, 502, origin);
        }
        const email = await sendNotificationEmail(env, {
          to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
          email_subject: "SA Recruiters | New \"Post a job\" enquiry — " + companyName,
          notification_type: "JOB ENQUIRY",
          notification_title: "New job posting enquiry",
          notification_intro: "An employer asked to post a job through SA Recruiters.",
          notification_body: "Company: " + companyName +
            "\nContact: " + (body.contact_person || "-") +
            "\nWork email: " + workEmail +
            "\nPhone: " + (body.phone || "-") +
            "\nIndustry: " + (body.industry || "-") +
            "\nPositions to fill: " + (body.positions_to_fill || "-") +
            "\nRoles: " + (roleTypes.length ? roleTypes.join(", ") : "-") +
            "\nWebsite: " + (body.website || "-") +
            "\nDetails: " + (body.additional_details || "-")
        });
        return json({ ok: true, email }, 200, origin);
      }
      // ---------- "Looking for work?" quick intake (public, Turnstile-protected) ----------
      // Replaces people messaging the admin free-text ("may I send my CV?") with
      // one structured request. It never creates a public profile: an admin
      // triages it and can convert it into a CV Box candidate.
      if (path === "/api/submit/job-seeker" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
        const fullName = clean(body.full_name, 200);
        const phone = clean(body.phone, 60);
        const email = clean(body.email, 200);
        if (!fullName) return json({ error: "Please add your full name." }, 400, origin);
        if (!phone && !email) return json({ error: "Add a phone/WhatsApp number or an email so we can reach you." }, 400, origin);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email address does not look right." }, 400, origin);
        if (body.consent !== true) return json({ error: "Please tick the consent box to continue." }, 400, origin);
        let cvLink = clean(body.cv_link, 500);
        if (cvLink) {
          if (!/^https?:\/\//i.test(cvLink)) cvLink = "https://" + cvLink;
          try { const u = new URL(cvLink); if (!/^https?:$/.test(u.protocol)) throw new Error("bad"); }
          catch (_) { return json({ error: "The CV link is not a valid web address." }, 400, origin); }
        }
        // Keep message line breaks (useful when someone pastes their whole note).
        const message = String(body.message ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, 4000);
        const workStatus = ["citizen_pr", "work_visa", "unsure"].includes(body.work_status) ? body.work_status : "unsure";
        const seekerUserId = await verifiedUserId(request, env);
        try {
          await supabaseRpc(env, "public_submit_job_seeker", {
            p_full_name: fullName,
            p_phone: phone,
            p_email: email,
            p_location: clean(body.location, 200),
            p_looking_for: clean(body.looking_for, 500),
            p_qualification: clean(body.qualification, 300),
            p_work_status: workStatus,
            p_availability: clean(body.availability, 100),
            p_message: message,
            p_cv_link: cvLink,
            p_user_id: seekerUserId
          });
        } catch (e) {
          return json({ error: "Could not send your request — please try again.", detail: e.detail }, 502, origin);
        }
        const statusLabel = { citizen_pr: "SA citizen / permanent resident", work_visa: "Valid SA work visa/permit", unsure: "Not specified" }[workStatus];
        const adminEmail = await sendNotificationEmail(env, {
          to_email: env.ADMIN_NOTIFY_EMAIL || "sarecruiters.directory@gmail.com",
          email_subject: "SA Recruiters | New job seeker — " + fullName,
          notification_type: "JOB SEEKER",
          notification_title: "New \"Looking for work?\" request",
          notification_intro: "A job seeker asked for help through SA Recruiters. Review it under Submissions → Job seekers.",
          notification_body: "Name: " + fullName +
            "\nPhone: " + (phone || "-") +
            "\nEmail: " + (email || "-") +
            "\nLocation: " + (clean(body.location, 200) || "-") +
            "\nLooking for: " + (clean(body.looking_for, 500) || "-") +
            "\nQualification: " + (clean(body.qualification, 300) || "-") +
            "\nWork status: " + statusLabel +
            "\nAvailability: " + (clean(body.availability, 100) || "-") +
            "\nCV link: " + (cvLink || "-") +
            "\n\n" + (message || "-")
        });
        // Instant, useful reply so the person is not left waiting. It makes no
        // promise of placement — SA Recruiters is a directory, not an employer.
        let autoReply = { sent: false };
        if (email) {
          const site = "https://sa-recruiters.co.za";
          autoReply = await sendNotificationEmail(env, {
            to_email: email,
            email_subject: "SA Recruiters | We received your request",
            notification_type: "JOB SEEKER",
            notification_title: "Thanks, " + fullName.split(" ")[0] + " — we've got your details",
            notification_intro: "Our team will review your request. In the meantime, these will help you move faster:",
            notification_body: "1. Join the free CV Box so employers can find you:\n" + site + "/?section=candidates" +
              "\n\n2. Browse the latest vacancies and set up alerts for the roles you want:\n" + site + "/?section=vacancies" +
              "\n\n3. Build a professional CV in the app (menu → CV Builder).\n\n" +
              "Please note: SA Recruiters is a directory — we cannot guarantee placement, and we never charge job seekers to apply for vacancies. Beware of anyone asking you to pay for a job."
          });
        }
        return json({ ok: true, email: adminEmail, auto_reply: autoReply.sent === true }, 200, origin);
      }
      // ---------- Employer self-service registration (no Google sign-in, no CV Box profile) ----------
      // A brand-new employer registers here and gets back a working Smart
      // Manager link (manage_token) for the row this same call created —
      // see public_register_employer() for why that's safe even though
      // manage_token is otherwise locked down from anon reads.
      if (path === "/api/submit/employer-register" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const name = String(body.name || "").trim().slice(0, 200);
        if (!name) return json({ error: "Add at least the company name." }, 400, origin);
        const id = String(body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
        let rows;
        try {
          rows = await supabaseRpc(env, "public_register_employer", {
            p_id: id,
            p_name: name,
            p_industry: String(body.industry || "").slice(0, 200),
            p_website: String(body.website || "").slice(0, 300),
            p_contact: String(body.contact || "").slice(0, 200),
            p_email: String(body.email || "").slice(0, 200),
            p_location: String(body.location || "").slice(0, 200),
            p_address: String(body.address || "").slice(0, 300),
            p_photo: body.photo ? String(body.photo).slice(0, 500000) : null
          });
        } catch (e) {
          const closed = /closed/i.test(e.detail || "");
          return json({ error: closed ? "Employer self-registration is currently closed — please contact SA Recruiters directly." : "Could not register your company. Please try again." }, closed ? 403 : 502, origin);
        }
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row || !row.manage_token) return json({ error: "Registration failed — please try again." }, 502, origin);
        const managerLink = `${origin || "https://sa-recruiters.co.za"}/?manage_employer=${row.manage_token}`;
        let email = { sent: false };
        if (body.email) {
          email = await sendNotificationEmail(env, {
            to_email: String(body.email),
            email_subject: "SA Recruiters | Your employer Manager Link",
            notification_type: "EMPLOYER MANAGER LINK",
            notification_title: "Welcome to SA Recruiters",
            notification_intro: "Your company has been registered. Save this link \u2014 it's how you manage your listing and post vacancies. Treat it like a password: don't share it publicly.",
            notification_body: "Manager Link: " + managerLink
          });
        }
        return json({ ok: true, manage_token: row.manage_token, manager_link: managerLink, email }, 200, origin);
      }
      // Resend a lost Manager Link by registered email. Always returns the
      // same generic response whether or not a match was found, so this
      // can't be used to probe which emails belong to registered employers.
      if (path === "/api/employer/resend-link" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const emailAddr = String(body.email || "").trim();
        if (!emailAddr) return json({ error: "Add the email you registered with." }, 400, origin);
        let rows;
        try {
          rows = await supabaseRpc(env, "public_resend_employer_link", { p_email: emailAddr });
        } catch (e) {
          return json({ error: "Could not look that up. Please try again." }, 502, origin);
        }
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row && row.manage_token) {
          const managerLink = `${origin || "https://sa-recruiters.co.za"}/?manage_employer=${row.manage_token}`;
          await sendNotificationEmail(env, {
            to_email: emailAddr,
            email_subject: "SA Recruiters | Your Manager Link",
            notification_type: "EMPLOYER MANAGER LINK",
            notification_title: "Here's your Manager Link",
            notification_intro: "As requested, here's the link to manage your SA Recruiters company listing.",
            notification_body: "Manager Link: " + managerLink
          });
        }
        return json({ ok: true }, 200, origin);
      }
      if (path === "/api/admin/send-vacancy-alerts" && request.method === "POST") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        const body = await request.json().catch(() => ({}));
        const vacancy = body.vacancy && typeof body.vacancy === "object" ? body.vacancy : {};
        const recipients = Array.isArray(body.recipients) ? body.recipients.slice(0, 200) : [];
        if (!vacancy.title || !recipients.length) {
          return json({ error: "Vacancy title and recipients are required." }, 400, origin);
        }
        const results = [];
        for (const recipient of recipients) {
          const email = String(recipient.email || "").trim();
          const candidateId = String(recipient.candidate_id || "");
          if (!email || !candidateId) {
            results.push({ candidate_id: candidateId, sent: false, error: "Missing recipient details." });
            continue;
          }
          const sent = await sendNotificationEmail(env, {
            to_email: email,
            email_subject: `SA Recruiters | New vacancy: ${String(vacancy.title).slice(0, 180)}`,
            notification_type: "VACANCY ALERT",
            notification_title: "New vacancy opportunity",
            notification_intro: "A new vacancy matching your CV Box preferences has been posted.",
            notification_body: [
              `Role: ${vacancy.title || "-"}`,
              `Company: ${vacancy.company || "-"}`,
              `Location: ${vacancy.location || "-"}`,
              `Employment type: ${vacancy.employment_type || "-"}`,
              `Closing date: ${vacancy.closing_date || "-"}`,
              `Apply: ${vacancy.link || vacancy.email || vacancy.phone || "-"}`
            ].join("\n")
          });
          results.push({ candidate_id: candidateId, sent: !!sent.sent, error: sent.sent ? null : sent.reason || "Resend failed." });
        }
        return json({ ok: true, sent: results.filter((row) => row.sent).length, matched: results.length, results }, 200, origin);
      }
      if (path === "/api/jobs/adzuna" && request.method === "GET") {
        // Adzuna live job search for /find-jobs/ (see adzuna.js). App ID/Key stay in Worker secrets.
        return await adzunaSearchResponse(request, env, origin, json);
      }
      if (path.startsWith("/api/ai/") || path.startsWith("/api/admin/ai/")) {
        // Gemini features (see ai-routes.js). Admin-only, or signed-in + Turnstile + rate limit.
        const aiResponse = await handleAiRequest(request, env, origin, path, { json, isAdminRequest, verifiedUserId, verifyTurnstile, employerPosterKey });
        if (aiResponse) return aiResponse;
      }
      if (path === "/api/cv-box/tidy" && request.method === "POST") {
        // Free Workers AI: fixes typos/grammar and keeps 1 profession + 1 alternate for ONE CV Box profile.
        // Allowed for a profile created in the last 3 hours, its signed-in owner, or an admin (see cv-tidy.js).
        const body = await request.json().catch(() => ({}));
        const tidyId = String(body.id ?? "").trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(tidyId)) return json({ error: "Choose a valid CV Box profile." }, 400, origin);
        const tidyAdmin = await isAdminRequest(request, env);
        let tidyAllowed = tidyAdmin;
        if (!tidyAllowed) {
          let tidyRow = null;
          try { tidyRow = await fetchProfile(env, tidyId); } catch (e) { return json({ error: "Profile could not be loaded." }, 502, origin); }
          if (!tidyRow) return json({ error: "Profile not found." }, 404, origin);
          const fresh = Date.now() - new Date(tidyRow.created_at).getTime() < 3 * 3600000;
          const owner = tidyRow.user_id ? (await verifiedUserId(request, env)) === tidyRow.user_id : false;
          tidyAllowed = fresh || owner;
        }
        if (!tidyAllowed) return json({ error: "Not allowed." }, 403, origin);
        const tidied = await tidyCandidateById(env, tidyId, { force: tidyAdmin && body.force === true });
        if (!tidied.ok) return json({ error: tidied.error }, tidied.status || 500, origin);
        return json({ ok: true, changed: tidied.changes || [], skipped: !!tidied.skipped }, 200, origin);
      }
      if (path === "/api/admin/cv-box/tidy" && request.method === "POST") {
        // Admin: tidy existing CV Box profiles in small batches (replaces cleaning them by hand in Supabase).
        // Body: { limit?: 1-10 (default 5), dry_run?: true, force?: true, ids?: [...] }. Call again until pending_before is 0.
        if (!await isAdminRequest(request, env)) return json({ error: "Not authorized." }, 401, origin);
        const body = await request.json().catch(() => ({}));
        const dryRun = body.dry_run === true;
        const batch = Math.min(Math.max(parseInt(body.limit, 10) || 5, 1), 10);
        let ids;
        let pendingBefore = null;
        if (Array.isArray(body.ids) && body.ids.length) {
          ids = body.ids.map(String).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, batch);
        } else {
          try { const listed = await listUntidied(env, { limit: batch }); ids = listed.ids; pendingBefore = listed.pending; }
          catch (e) { console.error("cv-tidy list failed", e); return json({ error: "Could not list CV Box profiles." }, 502, origin); }
        }
        const results = [];
        for (const id of ids) {
          const r = await tidyCandidateById(env, id, { force: body.force === true, dryRun });
          results.push({ id, ok: r.ok, skipped: !!r.skipped, changes: r.changes || [], patch: dryRun ? r.patch : undefined, profession: r.profession, alternate: r.alternate, alternateSource: r.alternateSource, merged: r.merged, needsAlternate: r.needsAlternate, usedAi: r.usedAi, note: r.note || undefined, error: r.ok ? undefined : r.error });
        }
        return json({ ok: true, processed: results.length, pending_before: pendingBefore, dry_run: dryRun, results }, 200, origin);
      }
      if (path === "/api/admin/cv-scan" && request.method === "POST") {
        // Admin CV Box: read the uploaded CV, merge the positions found on it
        // into the profile, and say whether it can be auto-approved + verified.
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        const body = await request.json().catch(() => ({}));
        const candidate = body.candidate && typeof body.candidate === "object" ? body.candidate : {};
        const key = candidateCvKey(candidate.cv_link, env);
        if (!key || !env.MEDIA_BUCKET) {
          return json({ error: "This CV is not stored with SA Recruiters, so it cannot be scanned automatically." }, 422, origin);
        }
        const object = await env.MEDIA_BUCKET.get(key);
        if (!object) return json({ error: "The CV file could not be found." }, 404, origin);
        const contentType = String(object.httpMetadata?.contentType || "").split(";")[0].toLowerCase()
          || (key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".png") ? "image/png" : "image/jpeg");
        const scanStart = Date.now();
        const cvBytes = await object.arrayBuffer();
        console.log("cv-scan start", key, contentType, cvBytes.byteLength, "bytes");
        const scanned = await scanCvWithGemini(env, cvBytes, contentType);
        console.log("cv-scan done", scanned.ok ? "ok" : "failed: " + scanned.error, Date.now() - scanStart, "ms");
        if (!scanned.ok) return json({ error: scanned.error }, scanned.status, origin);
        const existing = await existingCvBoxCandidates(request, env);
        if (!existing) return json({ error: "Duplicate checking is temporarily unavailable. The CV was not approved." }, 503, origin);
        const duplicate = findDuplicateCandidate(existing, candidate, scanned.scan);
        // Skills feed candidate-to-vacancy matching. Kept in D1 only (skills, never contact details).
        if (candidate.id && scanned.scan.is_cv && scanned.scan.skills && scanned.scan.skills.length) {
          await putCached(env, "cv-skills", String(candidate.id).slice(0, 80), { model: scanned.model, result: { skills: scanned.scan.skills } });
        }
        // One profession + one alternate: similar titles are merged, the CV supplies a different alternate.
        const pair = pairPositions(candidate.position, scanned.scan.positions);
        const typedBefore = splitTitles(candidate.position);
        const merged = { text: pair.text, list: [pair.profession, pair.alternate].filter(Boolean), added: [pair.profession, pair.alternate].filter((t) => t && !typedBefore.some((x) => similarPosition(x, t))) };
        const corrections = cvProfileCorrections(scanned.scan, { ...candidate, position: merged.text });
        const verdict = evaluateCvScan(scanned.scan, { ...candidate, ...corrections, position: merged.text }, { contentType });
        if (duplicate) verdict.reasons.unshift(`This candidate already exists in the CV Box (${duplicate.name}; matched by ${duplicate.matchedBy})`);
        verdict.autoApprove = verdict.reasons.length === 0;
        const recipient = String(candidate.contact_email || scanned.scan.email || "").trim();
        let feedback = { sent: false, reason: "No candidate email available" };
        if (recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) && !candidate.admin_notes?.includes(`[cv-feedback] ${candidate.cv_link || ""}`)) {
          const issueLines = verdict.reasons.length ? verdict.reasons.map((reason) => `- ${reason}`) : ["- No issues found. Your CV passed the checks."];
          const correctionLines = Object.entries(corrections).map(([field, value]) => `- ${field.replaceAll("_", " ")}: ${value}`);
          feedback = await sendNotificationEmail(env, {
            to_email: recipient,
            email_subject: `SA Recruiters | CV review for ${String(candidate.full_name || scanned.scan.full_name || "your profile").slice(0, 120)}`,
            notification_title: duplicate ? "CV submission not accepted" : (verdict.autoApprove ? "CV review complete" : "CV needs attention"),
            notification_type: "CV Box review",
            notification_intro: duplicate ? "We could not add this CV because a matching candidate is already in the SA Recruiters CV Box." : (verdict.autoApprove ? "Your CV passed our initial checks." : "We reviewed your CV and found a few items to correct before it can be accepted."),
            notification_body: [...(duplicate ? [] : correctionLines.length ? ["We corrected or filled these profile details:", ...correctionLines, ""] : []), "Review result:", ...issueLines, "", "If you believe this is incorrect, reply to this email with an updated CV or corrected details."]
              .join("\n"),
            reply_to: recipient
          });
        }
        return json({ ok: true, scan: scanned.scan, position: merged.text, positions: merged.list, added: merged.added, corrections, duplicate, feedback, verdict }, 200, origin);
      }
      if (path === "/api/generate-cv" && request.method === "POST") {
        // Require a signed-in SA Recruiters user (the app is auth-gated
        // already) so the Gemini quota isn't open to anonymous scraping.
        const cvUserId = await verifiedUserId(request, env);
        if (!cvUserId) {
          return json({ error: "Please sign in to use the CV Builder." }, 401, origin);
        }
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        const rawInput = String(body.rawInput || "").trim().slice(0, 6000);
        if (!rawInput) {
          return json({ error: "Please add some details about your experience first." }, 400, origin);
        }
        const result = await generateCvWithGemini(env, {
          fullName: String(body.fullName || "").slice(0, 200),
          targetRole: String(body.targetRole || "").slice(0, 200),
          rawInput
        });
        if (!result.ok) return json({ error: result.error }, result.status, origin);
        return json({ ok: true, cv: result.cv }, 200, origin);
      }
      if (path === "/api/account/delete" && request.method === "POST") {
        // Self-service account deletion (GDPR/POPIA-style right to erasure).
        // The user's access token is verified server-side; the Supabase admin
        // API then removes the auth user. auth.users cascades delete the
        // saved_vacancies rows (FK ON DELETE CASCADE), and reports/suggestions
        // keep only a nullified user_id (ON DELETE SET NULL). The CV Box
        // listing is a separate pool_candidates row, cleared here explicitly.
        const deleteUserId = await verifiedUserId(request, env);
        if (!deleteUserId) {
          return json({ error: "Please sign in to delete your account." }, 401, origin);
        }
        const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!adminKey) {
          return json({ error: "Account deletion is not configured." }, 503, origin);
        }
        const authHeaders = {
          apikey: adminKey,
          Authorization: `Bearer ${adminKey}`,
          "Content-Type": "application/json"
        };
        try {
          // POPIA: also erase what the AI features saved about this person's CV Box profile
          // (skills read from the CV, photo check). Look the ids up before the rows are deleted.
          if (env.DB) {
            try {
              const owned = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?select=id,photo_url&user_id=eq.${deleteUserId}`, { headers: authHeaders });
              const rows = owned.ok ? await owned.json().catch(() => []) : [];
              for (const row of Array.isArray(rows) ? rows : []) {
                await env.DB.prepare("DELETE FROM ai_results WHERE kind = 'cv-skills' AND subject_id = ?").bind(String(row.id)).run();
                const photoKey = row.photo_url ? decodeURIComponent(String(row.photo_url).split("/candidate-photos/")[1] ? "candidate-photos/" + String(row.photo_url).split("/candidate-photos/")[1] : "") : "";
                if (photoKey) await env.DB.prepare("DELETE FROM ai_results WHERE kind = 'photo-check' AND subject_id = ?").bind(photoKey).run();
              }
            } catch (cleanupError) {
              console.error("AI data cleanup on account deletion failed", cleanupError);
            }
          }
          // CV Box listing rows are linked by user_id but not FK-cascaded.
          const poolRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?user_id=eq.${deleteUserId}`, {
            method: "DELETE",
            headers: authHeaders
          });
          if (!poolRes.ok) return json({ error: "Could not remove your CV Box listing." }, 502, origin);
          const delRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${deleteUserId}`, {
            method: "DELETE",
            headers: authHeaders
          });
          if (!delRes.ok) {
            const detail = await delRes.text().catch(() => "");
            return json({ error: "Could not delete the account.", detail: detail.slice(0, 200) }, 502, origin);
          }
        } catch (e) {
          return json({ error: "Account deletion failed — please try again." }, 502, origin);
        }
        return json({ ok: true }, 200, origin);
      }
      if (path === "/api/upload/candidate-cv" && request.method === "POST") {
        if (!await publicUploadAllowed(request)) return json({ error: "Upload limit reached or spam protection is unavailable. Please try again later." }, 429, origin);
        const contentType = request.headers.get("Content-Type") || "";
        const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];
        if (!allowedTypes.includes(contentType.split(";")[0].toLowerCase())) {
          return json({ error: "Only PDF, PNG, or JPG CV files are allowed." }, 400, origin);
        }
        const bytes = await readUploadBytes(request, MAX_PHOTO_BYTES);
        if (bytes === null) return json({ error: "CV too large (max 3MB)." }, 413, origin);
        if (bytes.byteLength === 0) return json({ error: "Empty file." }, 400, origin);
        const signature = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
        const isPdf = signature.length >= 4 && signature[0] === 0x25 && signature[1] === 0x50 && signature[2] === 0x44 && signature[3] === 0x46;
        const isPng = signature.length >= 8 && signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47 && signature[4] === 0x0d && signature[5] === 0x0a && signature[6] === 0x1a && signature[7] === 0x0a;
        const isJpeg = signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
        if (!(isPdf || isPng || isJpeg)) return json({ error: "The file contents do not match a supported CV type." }, 400, origin);
        const ext = isPdf ? "pdf" : isPng ? "png" : "jpg";
        const actualType = isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
        const key = `candidate-cvs/${randomKey()}.${ext}`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: actualType } });
        return json({ url: publicUrlFor(env, key), key }, 200, origin);
      }
      if (path === "/api/upload/candidate-photo" && request.method === "POST") {
        if (!await publicUploadAllowed(request)) return json({ error: "Upload limit reached or spam protection is unavailable. Please try again later." }, 429, origin);
        const contentType = request.headers.get("Content-Type") || "";
        if (!/^image\/(jpeg|png)(?:;|$)/i.test(contentType)) {
          return json({ error: "Only JPEG or PNG photo uploads are allowed." }, 400, origin);
        }
        const bytes = await readUploadBytes(request, MAX_PHOTO_BYTES);
        if (bytes === null) return json({ error: "Photo too large (max 3MB)." }, 413, origin);
        if (bytes.byteLength === 0)
          return json({ error: "Empty file." }, 400, origin);
        const signature = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
        const isPng = signature.length >= 8 && signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47 && signature[4] === 0x0d && signature[5] === 0x0a && signature[6] === 0x1a && signature[7] === 0x0a;
        const isJpeg = signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
        if (!(isJpeg || isPng)) return json({ error: "The photo contents are not a valid JPEG or PNG image." }, 400, origin);
        const allowedPrefixes = ["candidate-photos", "candidate-banners", "agency-logos", "employer-logos", "vacancy-photos"];
        const reqPrefix = url.searchParams.get("prefix");
        const prefix = allowedPrefixes.includes(reqPrefix) ? reqPrefix : "candidate-photos";
        const photoType = isPng ? "image/png" : "image/jpeg";
        const photoExt = isPng ? "png" : "jpg";
        const key = `${prefix}/${randomKey()}.${photoExt}`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: photoType } });
        return json({ url: publicUrlFor(env, key), key }, 200, origin);
      }
      if (path === "/api/submit/poster" && request.method === "POST") {
        // CV Pictures were retired from the app, so public uploads are closed.
        return json({ error: "CV pictures are no longer available." }, 410, origin);
      }
      if (false && path === "/api/submit/poster" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.startsWith("image/")) {
          return json({ error: "Only image uploads are allowed." }, 400, origin);
        }
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) return json({ error: "Choose your CV picture first." }, 400, origin);
        if (bytes.byteLength > MAX_POSTER_BYTES) return json({ error: "CV picture too large (max 5MB)." }, 413, origin);
        const key = `employer-posters/${randomKey()}.jpg`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
        const imageUrl = publicUrlFor(env, key);
        const submittedCaption = (url.searchParams.get("caption") || "").trim();
        const caption = submittedCaption || await inferEmployerPosterTitle(env, bytes, key) || "CV picture";
        try {
          const posterId = await supabaseRpc(env, "public_submit_poster", {
            p_image_url: imageUrl,
            p_caption: caption.slice(0, 500)
          });
          // The feed reads from the D1 mirror, which otherwise only refreshes on the
          // 6-hourly sync. Mirror the row now so the person sees their CV picture at once.
          if (env.DB && posterId) {
            try {
              const createdAt = new Date();
              const expiresAt = new Date(createdAt.getTime() + 90 * 86400000);
              await env.DB.prepare("INSERT OR REPLACE INTO employer_posters (id, employer_id, agency_id, image_url, caption, vacancy_id, created_at, expires_at) VALUES (?, NULL, NULL, ?, ?, NULL, ?, ?)")
                .bind(String(posterId), imageUrl, caption.slice(0, 500), createdAt.toISOString(), expiresAt.toISOString()).run();
              await bumpPublicDataVersion(env);
            } catch (mirrorError) { console.warn("Could not mirror CV picture to D1", mirrorError); }
          }
          return json({ ok: true, id: posterId, url: imageUrl, caption: caption.slice(0, 120) }, 200, origin);
        } catch (e) {
          try { await env.MEDIA_BUCKET.delete(key); } catch (_) {}
          return json({ error: "Could not publish your CV picture." }, 502, origin);
        }
      }
      if (path === "/api/upload/tipchat-image" && request.method === "POST") {
        const imageUserId = await verifiedUserId(request, env);
        if (!imageUserId) return json({ error: "Please sign in to upload listing photos." }, 401, origin);
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.startsWith("image/jpeg")) return json({ error: "Listing photos must be JPEG images." }, 400, origin);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) return json({ error: "Empty image." }, 400, origin);
        if (bytes.byteLength > MAX_POSTER_BYTES) return json({ error: "Listing photo too large (max 5MB)." }, 413, origin);
        if (!looksLikeJpeg(bytes)) return json({ error: "That listing photo is not a valid JPEG." }, 400, origin);
        if (!await tipchatImageUploadAllowed(imageUserId)) return json({ error: "Too many listing photos. Please try again later." }, 429, origin);
        const key = `tipchat-marketplace/${imageUserId}/${randomKey()}.jpg`;
        await env.MEDIA_BUCKET.put(key, bytes, {
          httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
          customMetadata: { owner: imageUserId, purpose: "tipchat-marketplace" }
        });
        return json({ ok: true, url: publicUrlFor(env, key), key }, 200, origin);
      }
      if (path === "/api/upload/tipchat-image" && request.method === "DELETE") {
        const imageUserId = await verifiedUserId(request, env);
        if (!imageUserId) return json({ error: "Please sign in." }, 401, origin);
        const imageKey = url.searchParams.get("key") || "";
        if (!new RegExp(`^tipchat-marketplace/${imageUserId.replace(/[^A-Za-z0-9_-]/g, "")}/[A-Za-z0-9]+\\.jpg$`).test(imageKey)) return json({ error: "Invalid image key." }, 400, origin);
        const head = await env.MEDIA_BUCKET.head(imageKey);
        if (!head) return json({ ok: true }, 200, origin);
        if (!head.customMetadata || head.customMetadata.owner !== imageUserId) return json({ error: "Not allowed." }, 403, origin);
        await env.MEDIA_BUCKET.delete(imageKey);
        return json({ ok: true }, 200, origin);
      }
      if (path === "/api/upload/employer-poster" && request.method === "POST") {
        const posterUserId = await verifiedUserId(request, env);
        if (!posterUserId) {
          return json({ error: "Please sign in to upload a poster." }, 401, origin);
        }
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.startsWith("image/")) {
          return json({ error: "Only image uploads are allowed." }, 400, origin);
        }
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0)
          return json({ error: "Empty file." }, 400, origin);
        if (bytes.byteLength > MAX_POSTER_BYTES) {
          return json({ error: "Poster too large (max 5MB)." }, 413, origin);
        }
        if (!looksLikeJpeg(bytes)) {
          return json({ error: "Posters must be JPEG images." }, 400, origin);
        }
        if (!await posterUploadAllowed(posterUserId)) {
          return json({ error: "Too many poster uploads. Please try again in an hour." }, 429, origin);
        }
        const key = `employer-posters/${randomKey()}.jpg`;
        await env.MEDIA_BUCKET.put(key, bytes, {
          httpMetadata: { contentType: "image/jpeg" },
          customMetadata: { owner: posterUserId }
        });
        const submittedCaption = (url.searchParams.get("caption") || "").trim();
        const caption = submittedCaption || await inferEmployerPosterTitle(env, bytes, key) || "Vacancy poster";
        return json({ url: publicUrlFor(env, key), key, caption }, 200, origin);
      }
      if (path === "/api/upload/employer-poster" && request.method === "DELETE") {
        const deleteUserId = await verifiedUserId(request, env);
        if (!deleteUserId) {
          return json({ error: "Please sign in." }, 401, origin);
        }
        const posterKey = url.searchParams.get("key") || "";
        if (!/^employer-posters\/[A-Za-z0-9]+\.jpg$/.test(posterKey)) {
          return json({ error: "Invalid poster key." }, 400, origin);
        }
        const head = await env.MEDIA_BUCKET.head(posterKey);
        if (!head) return json({ ok: true }, 200, origin);
        if (!head.customMetadata || head.customMetadata.owner !== deleteUserId) {
          return json({ error: "Not allowed." }, 403, origin);
        }
        await env.MEDIA_BUCKET.delete(posterKey);
        return json({ ok: true }, 200, origin);
      }
      if (path === "/api/upload/daily-track" && request.method === "POST") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        const contentType = request.headers.get("Content-Type") || "audio/mpeg";
        const trackId = url.searchParams.get("id") || randomKey();
        const ext = (url.searchParams.get("ext") || "mp3").replace(/[^a-z0-9]/gi, "");
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0)
          return json({ error: "Empty file." }, 400, origin);
        if (bytes.byteLength > MAX_TRACK_BYTES) {
          return json({ error: "Track too large (max 25MB)." }, 413, origin);
        }
        const key = `daily-tracks/${trackId}.${ext}`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
        return json({ url: publicUrlFor(env, key), key }, 200, origin);
      }
      if (path === "/api/migrate-photos" && request.method === "POST") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        return await migratePhotos(request, env, origin);
      }
      if (path === "/api/migrate-agency-logos" && request.method === "POST") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        return await migrateBase64Logos(request, env, origin, "agencies", "agency-logos");
      }
      if (path === "/api/migrate-employer-logos" && request.method === "POST") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        return await migrateBase64Logos(request, env, origin, "employers", "employer-logos");
      }
      if (path === "/api/delete" && request.method === "DELETE") {
        if (!await isAdminRequest(request, env)) {
          return json({ error: "Not authorized." }, 401, origin);
        }
        const key = url.searchParams.get("key");
        if (!key)
          return json({ error: "Missing key." }, 400, origin);
        await env.MEDIA_BUCKET.delete(key);
        return json({ ok: true }, 200, origin);
      }
      return json({ error: "Not found." }, 404, origin);
    } catch (e) {
      Sentry.captureException(e);
      return json({ error: e.message || "Server error." }, 500, origin);
    }
  }
};
var worker_sentry = Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    environment: "production",
    tracesSampleRate: 0.1,
    sendDefaultPii: false
  }),
  worker_default
);
export {
  parseAtsXml,
  atsDate,
  atsJobFilterText,
  atsJobMatchesFilters,
  worker_sentry as default
};

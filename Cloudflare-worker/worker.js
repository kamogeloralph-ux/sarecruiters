var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var MAX_PHOTO_BYTES = 3 * 1024 * 1024;
var MAX_TRACK_BYTES = 25 * 1024 * 1024;
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
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
    return res.ok;
  } catch (e) {
    return false;
  }
}
__name(isAdminRequest, "isAdminRequest");
function randomKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
__name(randomKey, "randomKey");

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
//  The authorization logic (token checks, inserts) lives IN the database as
//  SECURITY DEFINER functions (see supabase/migrations/20260918_lock_down_manager_tokens.sql),
//  so the Worker never needs the service role and nothing sensitive is decided here.
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

// ============================================================
//  Transactional email via Resend (server-side replacement for the old
//  client-side EmailJS send). RESEND_API_KEY is a wrangler secret; the
//  browser never sees it. Email is best-effort: a failure is logged and
//  reported in the response but never blocks the database insert.
// ============================================================
const EMAIL_MAX_BODY = 8000;
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
  const from = env.EMAIL_FROM || "SA Recruiters <onboarding@resend.dev>";
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
        html: notificationEmailHtml(payload)
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
function publicUrlFor(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${key}`;
}
__name(publicUrlFor, "publicUrlFor");
var STARTUP_CACHE_TTL = 60;
var STARTUP_STALE_TTL = 300;
var STARTUP_VACANCY_PAGE_SIZE = 1e3;
var STARTUP_DEDICATED_SOURCES = [
  "himalayas",
  "adzuna",
  "government",
  "dpsa",
  "retail",
  "shoprite",
  "picknpay",
  "woolworths",
  "truworths",
  "spar",
  "career_board",
  "learnerships"
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
    "source_type"
  ].join(",");
  const vacancyFilter = `(${[
    "agency_id.neq.general",
    "employer_id.not.is.null",
    "source_type.not.is.null"
  ].join(",")})`;
  const dedicatedSources = `(${STARTUP_DEDICATED_SOURCES.join(",")})`;
  const [agencies, branches, vacancies, dedicatedVacancies, employers, generalCount, generalPoolCount, settings, poolCount] = await Promise.all([
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
    // supabaseGetAll() pages through all of them, matching how dedicatedVacancies
    // is already fetched just below.
    supabaseGetAll(env, "vacancies", {
      select: vacancyColumns,
      or: vacancyFilter,
      source_type: `not.in.${dedicatedSources}`,
      order: "created_at.desc"
    }, STARTUP_VACANCY_PAGE_SIZE),
    supabaseGetAll(env, "vacancies", {
      select: vacancyColumns,
      source_type: `in.${dedicatedSources}`,
      order: "created_at.desc"
    }, STARTUP_VACANCY_PAGE_SIZE),
    supabaseGet(env, "employers", {
      select: "id,name,industry,website,contact,email,location,address,photo,verified",
      order: "created_at.desc"
    }),
    // STRICT general count (source_type IS NULL only). Used ONLY as an addend
    // in counts.vacancies below, alongside vacancies.length and
    // dedicatedVacancies.length — those two already include every row that
    // has ANY source_type set (see vacancyFilter's source_type.not.is.null
    // branch), so this bucket must be the true, non-overlapping complement:
    // rows with no source_type at all. Using "not in dedicatedSources" here
    // instead would double-count every general-pool row scraped by a
    // non-dedicated source (careerjunction/jobmail/graduates24/etc.) — that
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
    Promise.all(["public_vacancy_posting", "public_employer_registration", "public_employer_directory"].map((key) => supabaseGet(env, "app_settings", { select: "key,value", key: `eq.${key}` }))),
    // pool_candidates itself is admin-only under RLS now (see
    // CREATE_POOL_PUBLIC_ACCESS.sql) -- counting it with the anon key here
    // always returned 0, which is why the home "Candidates" stat showed 0
    // until someone opened the Talent Pool screen (which queries the public
    // view directly and got the real number). Count the public view instead,
    // matching getPoolCandidateCount() on the client.
    supabaseGet(env, "pool_candidates_public", { select: "id", limit: "0" }, { prefer: "count=exact" })
  ]);
  const settingMap = Object.fromEntries(settings.map(({ body }) => {
    const row = Array.isArray(body) ? body[0] : null;
    return [row?.key, row?.value];
  }).filter(([key]) => key));
  const readCount = /* @__PURE__ */ __name((headers) => {
    const range = headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);
    return match ? Number(match[1]) : null;
  }, "readCount");
  return {
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    agencies: agencies.body || [],
    branches: branches.body || [],
    vacancies: [...vacancies, ...dedicatedVacancies],
    employers: employers.body || [],
    counts: {
      agencies: Array.isArray(agencies.body) ? agencies.body.length : 0,
      branches: Array.isArray(branches.body) ? branches.body.length : 0,
      vacancies: (readCount(generalCount.headers) ?? 0) + vacancies.length + dedicatedVacancies.length,
      // The true "General Vacancies" tab size: NULL-source rows (generalCount)
      // plus non-dedicated-source rows (generalPoolCount). The client uses
      // this directly instead of inferring it from
      // (counts.vacancies - vacancies.length), which breaks whenever most of
      // the general pool has a non-null source_type (as it does here) — see
      // app-data.js loadAll() for the client-side half of this fix.
      general: (readCount(generalCount.headers) ?? 0) + (readCount(generalPoolCount.headers) ?? 0),
      employers: Array.isArray(employers.body) ? employers.body.length : 0,
      candidates: readCount(poolCount.headers) ?? 0
    },
    settings: {
      public_vacancy_posting: settingMap.public_vacancy_posting ?? "false",
      public_employer_registration: settingMap.public_employer_registration ?? "false",
      public_employer_directory: settingMap.public_employer_directory ?? "true"
    }
  };
}
__name(loadStartupData, "loadStartupData");
async function startupResponse(request, env, ctx, origin) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/startup", request.url), request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }
  try {
    const payload = await loadStartupData(env);
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${STARTUP_CACHE_TTL}, s-maxage=${STARTUP_CACHE_TTL}, stale-while-revalidate=${STARTUP_STALE_TTL}`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json({ error: "Startup data unavailable", detail: error.message }, 502, origin);
  }
}
__name(startupResponse, "startupResponse");
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
var worker_default = {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    try {
      if (path === "/api/startup" && request.method === "GET") {
        return await startupResponse(request, env, ctx, origin);
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
          return json({ valid: true, agency }, 200, origin);
        } catch (e) {
          return json({ error: "Token check failed.", detail: e.detail }, 502, origin);
        }
      }
      if (path === "/api/verify-employer-manager" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token) return json({ error: "Missing token." }, 400, origin);
        try {
          const rows = await supabaseRpc(env, "verify_employer_manager_token", { p_token: String(body.token) });
          const employer = Array.isArray(rows) ? rows[0] : null;
          if (!employer) return json({ valid: false }, 200, origin);
          return json({ valid: true, employer }, 200, origin);
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
        return json({ ok: true, vacancy_id: result }, 200, origin);
      }
      if (path === "/api/manager/employer-vacancy" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.token || !body.vacancy_id || !body.title) {
          return json({ error: "Missing fields." }, 400, origin);
        }
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
        return json({ ok: true, vacancy_id: result }, 200, origin);
      }

      // ---------- Public submissions: Turnstile-gated, DB insert + Resend email ----------
      if (path === "/api/submit/report" && request.method === "POST") {
        const ts = await verifyTurnstile(request, env, origin, true);
        if (!ts.ok) return json({ error: ts.error }, ts.status, origin);
        const body = await request.json().catch(() => ({}));
        try {
          await supabaseRpc(env, "public_submit_report", {
            p_agency_name: String(body.agency_name || "").slice(0, 200),
            p_agency_id: body.agency_id ? String(body.agency_id) : null,
            p_reason: String(body.reason || "").slice(0, 200),
            p_details: String(body.details || "").slice(0, 4000)
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
        try {
          await supabaseRpc(env, "public_submit_suggestion", {
            p_type: String(body.type || "suggestion").slice(0, 50),
            p_agency_name: String(body.agency_name || "").slice(0, 200),
            p_details: String(body.details || "").slice(0, 4000)
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
      if (path === "/api/upload/candidate-photo" && request.method === "POST") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.startsWith("image/")) {
          return json({ error: "Only image uploads are allowed." }, 400, origin);
        }
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0)
          return json({ error: "Empty file." }, 400, origin);
        if (bytes.byteLength > MAX_PHOTO_BYTES) {
          return json({ error: "Photo too large (max 3MB)." }, 413, origin);
        }
        const allowedPrefixes = ["candidate-photos", "agency-logos", "employer-logos"];
        const reqPrefix = url.searchParams.get("prefix");
        const prefix = allowedPrefixes.includes(reqPrefix) ? reqPrefix : "candidate-photos";
        const key = `${prefix}/${randomKey()}.jpg`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
        return json({ url: publicUrlFor(env, key), key }, 200, origin);
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
      return json({ error: e.message || "Server error." }, 500, origin);
    }
  }
};
export {
  worker_default as default
};

// ============================================================
//  SA RECRUITERS — Cloudflare-worker/ai-routes.js
// ============================================================
//  HTTP routes + the daily maintenance job for the Gemini features in ai.js.
//
//  Who may call what
//    /api/admin/ai/*  admin session only.
//    /api/ai/*        an admin, OR a signed-in user who passes Turnstile and the
//                     per-user hourly limit. Both are counted against the daily budget.
//    GET /api/ai/vacancy-summary only READS a saved summary, so it needs no sign-in and never calls Gemini.
//
//  Nothing here publishes, hides or deletes anything. Results are suggestions or
//  entries in the admin review queue (ai_flags / community_automated_flags).
// ============================================================

import {
  AI_LANGUAGES, CLEAN_SCHEMA, CV_FEEDBACK_PROMPT, CV_FEEDBACK_SCHEMA, DRAFT_SCHEMA, INTERVIEW_ANSWER_SCHEMA, INTERVIEW_QUESTIONS_SCHEMA,
  PHOTO_PROMPT, PHOTO_SCHEMA, REPLY_SCHEMA, SEARCH_SCHEMA, SUMMARY_SCHEMA,
  clean, cleanPrompt, combineScam, companyKey, dailyDraftPrompt, extractPoster, geminiJson, getCached, heuristicScamSignals,
  interviewAnswerPrompt, interviewQuestionsPrompt, isNearDuplicate, normalizeCleanItem, normalizeCvFeedback, normalizeDraft,
  normalizeInterviewAnswer, normalizeInterviewQuestions, normalizeSearchFilters, normalizeSummary, photoDecision,
  pruneAiUsage, putCached, rankCandidates, replyPrompt, reserveAiCall, screenText, searchKey, searchPrompt, sha256Hex, sniffImageType,
  summaryMentionsOnlyKnownContacts, summaryPrompt, toBase64, untrusted, userWithinLimit, vacancyFacts, vacancyFingerprint
} from "./ai.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CV_BYTES = 5 * 1024 * 1024;
const VACANCY_COLUMNS = "id, title, company, location, notes, link, email, phone, salary, closing_date, employment_type, contract_type, experience_level, source_type, created_at";

// ---------- guards ----------

function paidTierMissing(env) {
  return env.GEMINI_PAID_TIER !== "1";
}

const PAID_TIER_MESSAGE = "This feature reads personal information, so it stays off until the Gemini key is on a paid plan that does not train on your data (set GEMINI_PAID_TIER=1).";

async function guard(request, env, origin, deps, { admin = false, kind, perHour = 20, personalData = false }) {
  const fail = (error, status) => ({ ok: false, response: deps.json({ error }, status, origin) });
  if (!env.GEMINI_API_KEY) return fail("AI is not configured yet.", 503);
  if (!env.DB) return fail("AI is temporarily unavailable.", 503);
  if (personalData && paidTierMissing(env)) return fail(PAID_TIER_MESSAGE, 503);
  if (admin) {
    return await deps.isAdminRequest(request, env) ? { ok: true, userId: "admin", isAdmin: true } : fail("Not authorized.", 401);
  }
  // Signed-in user: Turnstile + hourly limit. (One auth lookup for normal users.)
  const userId = await deps.verifiedUserId(request, env);
  if (!userId) return fail("Please sign in to use this feature.", 401);
  // An admin working in the admin panel sends no Turnstile token and is not hourly-limited.
  if (!request.headers.get("cf-turnstile-response") && await deps.isAdminRequest(request, env)) return { ok: true, userId, isAdmin: true };
  const ts = await deps.verifyTurnstile(request, env, origin, true);
  if (!ts.ok) return fail(ts.error, ts.status);
  if (!await userWithinLimit(env, userId, kind, perHour)) return fail("You have used this feature a lot in the last hour. Please try again later.", 429);
  return { ok: true, userId, isAdmin: false };
}

// Reserve budget, then call Gemini.
async function callAi(env, params, { bucket = "all" } = {}) {
  if (!await reserveAiCall(env, { bucket })) return { ok: false, status: 429, error: "The daily AI limit has been reached. Please try again tomorrow." };
  return geminiJson(env, params);
}

function r2Key(url, env, folder) {
  try {
    const file = new URL(String(url || ""));
    const base = new URL(env.R2_PUBLIC_BASE_URL);
    const basePath = base.pathname.replace(/\/$/, "");
    if (file.origin !== base.origin || !file.pathname.startsWith(`${basePath}/${folder}/`)) return null;
    const key = decodeURIComponent(file.pathname.slice(basePath.length + 1));
    return key.startsWith(`${folder}/`) && !key.split("/").includes("..") ? key : null;
  } catch (_) {
    return null;
  }
}

async function readBody(request) {
  return request.json().catch(() => ({}));
}

async function loadVacancy(env, id) {
  if (!env.DB || !id) return null;
  return env.DB.prepare(`SELECT ${VACANCY_COLUMNS} FROM vacancies WHERE id = ?`).bind(String(id).slice(0, 80)).first();
}

// ---------- review queue ----------

async function addFlag(env, { type, subjectId, title = "", link = "", scam }) {
  if (!env.DB || !scam || !scam.needs_review) return false;
  try {
    // DO NOTHING on conflict: a flag an admin already dismissed or confirmed never re-opens itself.
    await env.DB.prepare(
      "INSERT INTO ai_flags (subject_type, subject_id, title, link, risk_score, level, reasons, signals, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?) ON CONFLICT(subject_type, subject_id) DO NOTHING"
    ).bind(type, String(subjectId).slice(0, 200), clean(title, 140), clean(link, 300), scam.score, scam.level, JSON.stringify(scam.reasons), JSON.stringify(scam.signals), new Date().toISOString()).run();
    return true;
  } catch (error) {
    console.error("ai flag write failed", error);
    return false;
  }
}

// ---------- 1. posters ----------

// Reads a poster once. Same image bytes -> same saved result, so it is never paid for twice.
// Also screens it for scam signs in the same call and queues it for review when needed.
export async function readPosterCached(env, bytes, { key = "", fetchImpl } = {}) {
  if (!env.GEMINI_API_KEY || !env.DB || !bytes || !bytes.byteLength) return null;
  const hash = await sha256Hex(bytes);
  const cached = await getCached(env, "poster", hash);
  if (cached) return { poster: cached.result, cached: true };
  if (!await reserveAiCall(env, { bucket: "all" })) return null;
  const mime = sniffImageType(bytes) || "image/jpeg";
  const read = await extractPoster(env, bytes, mime, { fetchImpl });
  if (!read.ok) return null;
  await putCached(env, "poster", hash, { model: read.model, result: read.poster });
  const poster = read.poster;
  const text = [poster.title, poster.company, poster.salary, poster.apply.text, poster.scam_note, ...poster.requirements].join("\n");
  const heur = heuristicScamSignals(text, { company: poster.company, hasEmail: !!poster.apply.email, hasLink: !!poster.apply.link });
  if (poster.apply.whatsapp_only && !heur.signals.includes("whatsapp_only")) { heur.signals.push("whatsapp_only"); heur.reasons.push("Only a WhatsApp/Telegram contact is given"); heur.score += 15; }
  const modelSignals = poster.scam_signals.filter((s) => !heur.signals.includes(s));
  const scam = combineScam(heur, modelSignals.length ? { risk: 25 * modelSignals.length, signals: modelSignals, reasons: poster.scam_note ? [poster.scam_note] : [] } : null);
  await addFlag(env, { type: "poster", subjectId: key || hash, title: poster.title, scam });
  return { poster, cached: false, scam };
}

async function posterExtractRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { kind: "poster", perHour: 10 });
  if (!g.ok) return g.response;
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  let bytes;
  let key = "";
  if (type.startsWith("image/")) {
    bytes = await request.arrayBuffer();
  } else {
    const body = await readBody(request);
    key = deps.employerPosterKey(body.image_url, env) || "";
    if (!key || !env.MEDIA_BUCKET) return deps.json({ error: "Send the poster image, or a poster link from SA Recruiters." }, 400, origin);
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) return deps.json({ error: "The poster could not be found." }, 404, origin);
    bytes = await object.arrayBuffer();
  }
  if (!bytes.byteLength) return deps.json({ error: "Choose a poster image first." }, 400, origin);
  if (bytes.byteLength > MAX_IMAGE_BYTES) return deps.json({ error: "Poster too large (max 5MB)." }, 413, origin);
  if (!sniffImageType(bytes)) return deps.json({ error: "Posters must be JPEG, PNG or WebP images." }, 400, origin);
  const result = await readPosterCached(env, bytes, { key });
  if (!result) return deps.json({ error: "The poster could not be read right now. You can still fill the form in by hand." }, 503, origin);
  return deps.json({ ok: true, poster: result.poster, cached: result.cached }, 200, origin);
}

// ---------- 3. summaries ----------

async function summaryReadRoute(request, env, origin, deps) {
  const url = new URL(request.url);
  const id = clean(url.searchParams.get("id"), 80);
  const lang = clean(url.searchParams.get("lang"), 4).toLowerCase();
  if (!id || !AI_LANGUAGES[lang]) return deps.json({ error: "Choose a vacancy and a language." }, 400, origin);
  const cached = env.DB ? await getCached(env, "vacancy-summary", id, lang) : null;
  const response = cached ? deps.json({ ok: true, available: true, summary: cached.result }, 200, origin) : deps.json({ ok: true, available: false }, 200, origin);
  response.headers.set("Cache-Control", cached ? "public, max-age=3600" : "no-store");
  return response;
}

async function summaryCreateRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { kind: "summary", perHour: 30 });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const lang = clean(body.lang, 4).toLowerCase();
  if (!AI_LANGUAGES[lang]) return deps.json({ error: "Choose isiZulu, Sesotho, Afrikaans or English." }, 400, origin);
  // The text comes from our own database, never from the browser.
  const vacancy = await loadVacancy(env, body.vacancy_id);
  if (!vacancy) return deps.json({ error: "That vacancy could not be found." }, 404, origin);
  const inputHash = await sha256Hex(vacancyFacts(vacancy));
  const cached = await getCached(env, "vacancy-summary", vacancy.id, lang);
  if (cached && cached.inputHash === inputHash) return deps.json({ ok: true, summary: cached.result, cached: true }, 200, origin);
  const res = await callAi(env, { parts: [{ text: summaryPrompt(vacancy, lang) }], schema: SUMMARY_SCHEMA, maxOutputTokens: 700, temperature: 0.2 });
  if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
  const summary = normalizeSummary(res.data, lang);
  if (!summary.summary || !summaryMentionsOnlyKnownContacts(summary, vacancy)) {
    return deps.json({ error: "A reliable summary could not be made for this vacancy." }, 502, origin);
  }
  await putCached(env, "vacancy-summary", vacancy.id, { lang, inputHash, model: res.model, result: summary });
  return deps.json({ ok: true, summary, cached: false }, 200, origin);
}

// ---------- 4. natural-language search ----------

async function searchRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { kind: "search", perHour: 30 });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const query = clean(body.query, 200);
  const key = searchKey(query);
  if (key.length < 2) return deps.json({ error: "Type what you are looking for, for example: cashier jobs near Benoni." }, 400, origin);
  const subject = await sha256Hex(key);
  const cached = await getCached(env, "search", subject);
  if (cached) return deps.json({ ok: true, ...cached.result, cached: true }, 200, origin);
  const res = await callAi(env, { parts: [{ text: searchPrompt(query) }], schema: SEARCH_SCHEMA, maxOutputTokens: 200 });
  if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
  const result = normalizeSearchFilters(res.data);
  await putCached(env, "search", subject, { model: res.model, result });
  return deps.json({ ok: true, ...result, cached: false }, 200, origin);
}

// ---------- 7. CV feedback and interview practice ----------

async function cvFeedbackRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { kind: "cv-feedback", perHour: 5, personalData: true });
  if (!g.ok) return g.response;
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  let cvPart;
  if (["application/pdf", "image/png", "image/jpeg"].includes(type)) {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return deps.json({ error: "The CV file is empty." }, 400, origin);
    if (bytes.byteLength > MAX_CV_BYTES) return deps.json({ error: "CV too large (max 5MB)." }, 413, origin);
    cvPart = { inlineData: { mimeType: type, data: toBase64(bytes) } };
  } else {
    const body = await readBody(request);
    const text = String(body.cv_text || "").trim();
    if (text.length < 80) return deps.json({ error: "Upload your CV or paste its text first." }, 400, origin);
    cvPart = { text: untrusted("CV", text, 8000) };
  }
  // Nothing from the CV is stored: the answer goes back to the person and no further.
  const res = await callAi(env, { parts: [{ text: CV_FEEDBACK_PROMPT }, cvPart], schema: CV_FEEDBACK_SCHEMA, maxOutputTokens: 1000, temperature: 0.3 });
  if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
  const feedback = normalizeCvFeedback(res.data);
  if (!feedback.is_cv) return deps.json({ error: "That does not look like a CV." }, 422, origin);
  return deps.json({ ok: true, feedback }, 200, origin);
}

async function interviewRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { kind: "interview", perHour: 40 });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const vacancy = await loadVacancy(env, body.vacancy_id);
  if (!vacancy) return deps.json({ error: "That vacancy could not be found." }, 404, origin);
  const inputHash = await sha256Hex(vacancyFacts(vacancy));
  let questions;
  const cached = await getCached(env, "interview-questions", vacancy.id);
  if (cached && cached.inputHash === inputHash) {
    questions = cached.result.questions;
  } else {
    const res = await callAi(env, { parts: [{ text: interviewQuestionsPrompt(vacancy) }], schema: INTERVIEW_QUESTIONS_SCHEMA, maxOutputTokens: 700, temperature: 0.4 });
    if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
    questions = normalizeInterviewQuestions(res.data);
    if (!questions.length) return deps.json({ error: "Interview questions could not be made for this vacancy." }, 502, origin);
    await putCached(env, "interview-questions", vacancy.id, { inputHash, model: res.model, result: { questions } });
  }
  if (body.step !== "answer") return deps.json({ ok: true, vacancy: { id: vacancy.id, title: vacancy.title }, questions }, 200, origin);
  // Only the saved questions can be answered, so this cannot be used as a free general chatbot.
  const question = clean(body.question, 220);
  const answer = clean(body.answer, 1500);
  if (!questions.some((q) => q.question === question)) return deps.json({ error: "Pick one of the practice questions." }, 400, origin);
  if (answer.length < 10) return deps.json({ error: "Write your answer first." }, 400, origin);
  const res = await callAi(env, { parts: [{ text: interviewAnswerPrompt(question, answer, vacancy) }], schema: INTERVIEW_ANSWER_SCHEMA, maxOutputTokens: 500, temperature: 0.3 });
  if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
  return deps.json({ ok: true, feedback: normalizeInterviewAnswer(res.data) }, 200, origin);
}

// ---------- admin routes ----------

async function adminFlagsRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const status = ["open", "dismissed", "confirmed"].includes(new URL(request.url).searchParams.get("status")) ? new URL(request.url).searchParams.get("status") : "open";
  const rows = (await env.DB.prepare("SELECT id, subject_type, subject_id, title, link, risk_score, level, reasons, signals, status, created_at FROM ai_flags WHERE status = ? ORDER BY risk_score DESC, created_at DESC LIMIT 100").bind(status).all()).results || [];
  return deps.json({ ok: true, flags: rows.map((r) => ({ ...r, reasons: safeParse(r.reasons, []), signals: safeParse(r.signals, []) })) }, 200, origin);
}

async function adminResolveRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const id = Number(body.id);
  const status = body.decision === "confirmed" ? "confirmed" : body.decision === "dismissed" ? "dismissed" : "";
  if (!Number.isInteger(id) || !status) return deps.json({ error: "Choose a flag and a decision." }, 400, origin);
  await env.DB.prepare("UPDATE ai_flags SET status = ?, reviewed_at = ? WHERE id = ?").bind(status, new Date().toISOString(), id).run();
  return deps.json({ ok: true }, 200, origin);
}

async function adminScreenRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  let text = String(body.text || "");
  let company = clean(body.company, 120);
  const vacancy = body.vacancy_id ? await loadVacancy(env, body.vacancy_id) : null;
  if (vacancy) { text = [vacancy.title, vacancy.company, vacancy.salary, vacancy.notes, vacancy.email, vacancy.phone, vacancy.link].join("\n"); company = vacancy.company || ""; }
  if (text.trim().length < 10) return deps.json({ error: "Paste the text to check, or choose a vacancy." }, 400, origin);
  const scam = await screenText(env, { text: text.slice(0, 6000), kind: clean(body.kind, 30) || "vacancy", company, hasEmail: vacancy ? !!vacancy.email : null, hasLink: vacancy ? !!vacancy.link : null });
  return deps.json({ ok: true, scam }, 200, origin);
}

async function adminMatchRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const vacancy = body.vacancy_id ? await loadVacancy(env, body.vacancy_id) : (body.vacancy && typeof body.vacancy === "object" ? body.vacancy : null);
  if (!vacancy || !(vacancy.title || vacancy.title_clean)) return deps.json({ error: "Choose a vacancy." }, 400, origin);
  const meta = vacancy.id ? await getCached(env, "vacancy-clean", vacancy.id) : null;
  const enriched = { ...vacancy, ...(meta ? { title_clean: meta.result.title_clean, industry: meta.result.industry, province: meta.result.province } : {}) };
  const people = (await env.DB.prepare("SELECT id, full_name, position, sector, location, experience_years FROM pool_candidates WHERE status = 'active' LIMIT 3000").all()).results || [];
  const skillRows = (await env.DB.prepare("SELECT subject_id, result FROM ai_results WHERE kind = 'cv-skills'").all()).results || [];
  const skills = new Map(skillRows.map((r) => [r.subject_id, safeParse(r.result, {}).skills || []]));
  const ranked = rankCandidates(people.map((p) => ({ ...p, skills: skills.get(String(p.id)) || [] })), enriched, { min: Number(body.min) || 35, limit: 50 });
  const byId = new Map(people.map((p) => [String(p.id), p]));
  return deps.json({ ok: true, matches: ranked.map((m) => ({ ...m, full_name: byId.get(String(m.candidate_id))?.full_name || "", position: byId.get(String(m.candidate_id))?.position || "", location: byId.get(String(m.candidate_id))?.location || "" })) }, 200, origin);
}

async function adminDraftRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const siteUrl = env.SITE_URL || "https://sa-recruiters.co.za";
  if (body.kind === "daily") {
    const since = new Date(Date.now() - 36 * 3600000).toISOString();
    let rows = (await env.DB.prepare("SELECT title, company, location, closing_date FROM vacancies WHERE created_at >= ? AND (closing_date IS NULL OR closing_date = '' OR closing_date >= date('now')) ORDER BY created_at DESC LIMIT 10").bind(since).all()).results || [];
    if (!rows.length) rows = (await env.DB.prepare("SELECT title, company, location, closing_date FROM vacancies WHERE (closing_date IS NULL OR closing_date = '' OR closing_date >= date('now')) ORDER BY created_at DESC LIMIT 10").all()).results || [];
    if (!rows.length) return deps.json({ error: "There are no vacancies to write about." }, 404, origin);
    const res = await callAi(env, { parts: [{ text: dailyDraftPrompt(rows, siteUrl) }], schema: DRAFT_SCHEMA, maxOutputTokens: 900, temperature: 0.7 });
    if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
    return deps.json({ ok: true, draft: normalizeDraft(res.data), based_on: rows.length }, 200, origin);
  }
  if (body.kind === "enquiry-reply" || body.kind === "seeker-reply") {
    const message = String(body.message || "").trim();
    if (message.length < 5) return deps.json({ error: "Paste the message to reply to." }, 400, origin);
    const res = await callAi(env, { parts: [{ text: replyPrompt(message, body.kind, siteUrl) }], schema: REPLY_SCHEMA, maxOutputTokens: 500, temperature: 0.5 });
    if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
    return deps.json({ ok: true, reply: String(res.data && res.data.reply || "").trim().slice(0, 1500) }, 200, origin);
  }
  return deps.json({ error: "Choose daily, enquiry-reply or seeker-reply." }, 400, origin);
}

async function adminPhotoRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin", personalData: true });
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const key = r2Key(body.photo_url, env, "candidate-photos");
  if (!key || !env.MEDIA_BUCKET) return deps.json({ error: "That photo is not stored with SA Recruiters." }, 422, origin);
  const cached = await getCached(env, "photo-check", key);
  if (cached) return deps.json({ ok: true, ...cached.result, cached: true }, 200, origin);
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return deps.json({ error: "The photo could not be found." }, 404, origin);
  const bytes = await object.arrayBuffer();
  const mime = sniffImageType(bytes);
  if (!mime) return deps.json({ error: "Photos must be JPEG, PNG or WebP." }, 422, origin);
  const res = await callAi(env, { parts: [{ text: PHOTO_PROMPT }, { inlineData: { mimeType: mime, data: toBase64(bytes) } }], schema: PHOTO_SCHEMA, maxOutputTokens: 200 });
  if (!res.ok) return deps.json({ error: res.error }, res.status, origin);
  // Only the yes/no verdict is kept; a person decides anything that is not a clear pass.
  const verdict = photoDecision(res.data);
  await putCached(env, "photo-check", key, { model: res.model, result: verdict });
  return deps.json({ ok: true, ...verdict, cached: false }, 200, origin);
}

async function adminStatusRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const today = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("SELECT count FROM ai_usage WHERE day = ? AND bucket = 'all'").bind(today).first();
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_flags WHERE status = 'open'").first();
  const done = await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM ai_results GROUP BY kind").all();
  return deps.json({ ok: true, calls_today: Number(used && used.count) || 0, daily_cap: Number(env.AI_DAILY_CAP) || 1000, open_flags: Number(open && open.n) || 0, saved_results: Object.fromEntries((done.results || []).map((r) => [r.kind, r.n])), paid_tier: !paidTierMissing(env) }, 200, origin);
}

async function adminRunRoute(request, env, origin, deps) {
  const g = await guard(request, env, origin, deps, { admin: true, kind: "admin" });
  if (!g.ok) return g.response;
  const summary = await runAiMaintenance(env);
  return deps.json({ ok: true, summary }, 200, origin);
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

// Returns a Response for AI routes, or null when the path is not one of ours.
export async function handleAiRequest(request, env, origin, path, deps) {
  const method = request.method;
  if (path === "/api/ai/poster-extract" && method === "POST") return posterExtractRoute(request, env, origin, deps);
  if (path === "/api/ai/vacancy-summary" && method === "GET") return summaryReadRoute(request, env, origin, deps);
  if (path === "/api/ai/vacancy-summary" && method === "POST") return summaryCreateRoute(request, env, origin, deps);
  if (path === "/api/ai/search" && method === "POST") return searchRoute(request, env, origin, deps);
  if (path === "/api/ai/cv-feedback" && method === "POST") return cvFeedbackRoute(request, env, origin, deps);
  if (path === "/api/ai/interview" && method === "POST") return interviewRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/flags" && method === "GET") return adminFlagsRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/flags/resolve" && method === "POST") return adminResolveRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/screen" && method === "POST") return adminScreenRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/match" && method === "POST") return adminMatchRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/draft" && method === "POST") return adminDraftRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/photo-check" && method === "POST") return adminPhotoRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/status" && method === "GET") return adminStatusRoute(request, env, origin, deps);
  if (path === "/api/admin/ai/run" && method === "POST") return adminRunRoute(request, env, origin, deps);
  return null;
}

// ---------- 5 + 2 + 6: daily maintenance (cron, or an admin pressing "run now") ----------
// Cleans scraped vacancies, screens new vacancies and community posts for scams, flags near-duplicates.
// Each step is capped so one run can never exhaust the daily budget.

async function cleanScrapedVacancies(env, { limit, batchSize = 10, dupFlagLimit = 25 }) {
  const rows = (await env.DB.prepare(
    "SELECT v.id, v.title, v.company, v.location, v.salary FROM vacancies v " +
    "LEFT JOIN ai_results r ON r.kind = 'vacancy-clean' AND r.subject_id = v.id AND r.lang = '' " +
    "WHERE r.subject_id IS NULL AND v.source_type IS NOT NULL AND v.source_type != '' AND v.title IS NOT NULL " +
    "AND (v.closing_date IS NULL OR v.closing_date = '' OR v.closing_date >= date('now')) ORDER BY v.created_at DESC LIMIT ?"
  ).bind(limit).all()).results || [];
  let cleaned = 0;
  let dupFlags = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await callAi(env, { parts: [{ text: cleanPrompt(batch) }], schema: CLEAN_SCHEMA, maxOutputTokens: 2500 });
    if (!res.ok) { if (res.status === 429) break; continue; }
    const byId = new Map(batch.map((v) => [String(v.id), v]));
    for (const item of Array.isArray(res.data && res.data.items) ? res.data.items : []) {
      const original = byId.get(String(item && item.id));
      if (!original) continue;
      byId.delete(String(original.id));
      const tidy = normalizeCleanItem(item, original);
      const record = { ...tidy, original_title: clean(original.title, 140), company: clean(original.company, 100), location: clean(original.location, 120) };
      const fingerprint = vacancyFingerprint({ ...original, title_clean: tidy.title_clean, city: tidy.city });
      await putCached(env, "vacancy-clean", original.id, { inputHash: await sha256Hex([original.title, original.company, original.location, original.salary].join("|")), model: res.model, result: record, fingerprint, companyKey: companyKey(original.company) });
      cleaned++;
      if (dupFlags < dupFlagLimit && companyKey(original.company)) {
        const others = (await env.DB.prepare("SELECT subject_id, result FROM ai_results WHERE kind = 'vacancy-clean' AND company_key = ? AND subject_id != ? LIMIT 40").bind(companyKey(original.company), String(original.id)).all()).results || [];
        const me = { id: original.id, company: original.company, location: original.location, title_clean: tidy.title_clean, city: tidy.city };
        const twin = others.map((o) => ({ id: o.subject_id, ...safeParse(o.result, {}) })).find((o) => isNearDuplicate(me, { id: o.id, company: o.company, location: o.location, title_clean: o.title_clean, city: o.city }));
        if (twin) {
          const pair = [String(original.id), String(twin.id)].sort().join("~");
          const flagged = await addFlag(env, { type: "duplicate", subjectId: pair, title: tidy.title_clean, scam: { needs_review: true, score: 10, level: "low", reasons: [`Looks like a duplicate of vacancy ${twin.id} (same employer, town and job title)`], signals: [] } });
          if (flagged) dupFlags++;
        }
      }
    }
  }
  return { cleaned, duplicate_flags: dupFlags };
}

async function screenNewVacancies(env, { limit }) {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT ${VACANCY_COLUMNS.split(", ").map((c) => "v." + c).join(", ")} FROM vacancies v ` +
    "LEFT JOIN ai_results r ON r.kind = 'vacancy-scam' AND r.subject_id = v.id AND r.lang = '' " +
    "WHERE r.subject_id IS NULL AND v.created_at >= ? ORDER BY v.created_at DESC LIMIT ?"
  ).bind(since, limit).all()).results || [];
  let screened = 0;
  let flagged = 0;
  for (const v of rows) {
    const text = [v.title, v.company, v.salary, v.notes, v.email, v.phone, v.link].join("\n");
    const scam = await screenText(env, { text, kind: "vacancy", company: v.company, hasEmail: !!v.email, hasLink: !!v.link });
    await putCached(env, "vacancy-scam", v.id, { inputHash: "", result: scam });
    screened++;
    if (await addFlag(env, { type: "vacancy", subjectId: v.id, title: v.title, link: v.link, scam })) flagged++;
  }
  return { screened, flagged };
}

// TipChat / community vacancy posts. Autopilot may already have approved them, so this is a second
// look: flags go into the existing moderation flags table (shown to moderators) and nothing is hidden.
async function screenCommunityPosts(env, { limit }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: "SUPABASE_SERVICE_ROLE_KEY not set" };
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const query = `${env.SUPABASE_URL}/rest/v1/community_posts?select=id,body,post_type,vacancy_title,vacancy_location,vacancy_application,status,created_at&status=in.(pending,approved)&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${limit}`;
  const response = await fetch(query, { headers });
  if (!response.ok) return { error: `community_posts query failed (${response.status})` };
  const posts = await response.json().catch(() => []);
  let screened = 0;
  let flagged = 0;
  for (const post of Array.isArray(posts) ? posts : []) {
    if (await getCached(env, "community-scam", post.id)) continue;
    const isVacancy = post.post_type === "vacancy";
    const text = [post.vacancy_title, post.vacancy_location, post.vacancy_application, post.body].join("\n");
    const scam = await screenText(env, { text, kind: isVacancy ? "community vacancy post" : "community discussion post", company: isVacancy ? "" : "x", discussion: !isVacancy, allowAi: isVacancy });
    await putCached(env, "community-scam", post.id, { result: scam });
    screened++;
    if (!scam.needs_review) continue;
    const write = await fetch(`${env.SUPABASE_URL}/rest/v1/community_automated_flags?on_conflict=content_type,content_id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ content_type: "post", content_id: post.id, reasons: ["ai_review", ...scam.signals].slice(0, 8), matched_terms: scam.reasons.slice(0, 4) })
    });
    if (write.ok) flagged++;
    else console.error("community flag write failed", write.status);
  }
  return { screened, flagged };
}

export async function runAiMaintenance(env) {
  if (!env.GEMINI_API_KEY || !env.DB) return { skipped: "AI is not configured" };
  const summary = {};
  const step = async (name, fn) => {
    try { summary[name] = await fn(); } catch (error) { console.error("AI maintenance step failed", name, error); summary[name] = { error: String(error && error.message || error) }; }
  };
  const n = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
  await step("clean", () => cleanScrapedVacancies(env, { limit: n(env.AI_CLEAN_LIMIT, 100) }));
  await step("vacancy_screen", () => screenNewVacancies(env, { limit: n(env.AI_SCREEN_LIMIT, 60) }));
  await step("community_screen", () => screenCommunityPosts(env, { limit: n(env.AI_COMMUNITY_LIMIT, 40) }));
  await step("prune", async () => { await pruneAiUsage(env); return "ok"; });
  return summary;
}


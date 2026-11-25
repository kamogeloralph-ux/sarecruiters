// ============================================================
//  SA RECRUITERS — Cloudflare-worker/cv-tidy.js
// ============================================================
//  Keeps CV Box profiles clean, automatically, with FREE Cloudflare Workers AI.
//
//  What it does for every profile a candidate submits (or edits):
//    1. Fixes typos and grammar in "about you" and "qualification".
//    2. Fixes typos in the job titles and tidies their capitalisation.
//    3. Keeps exactly ONE profession and ONE alternate position. If the
//       candidate typed two titles that mean the same job (for example
//       "Cashier" and "Till Operator"), they are merged into one profession
//       and the alternate is taken from a different position (typed, read from
//       the CV, or - only when the candidate's own text supports it - suggested).
//    4. Tidies ALL-CAPS / all-lowercase names.
//
//  Safety rules (all enforced in code, never by the model):
//    - The model can only suggest edits. Every edit is checked against the
//      original; if the model changed too much the original is kept.
//    - Name, phone, email, status, verified and CV link are never sent to the
//      model and never written by the AI.
//    - If Workers AI is unavailable or the daily budget is used up, the
//      rule-based tidy (positions, name, spacing) still runs.
//    - Each profile is tidied once per version of its text (cached in D1), so
//      the free daily allowance is not wasted.
// ============================================================

import { clean, fold, getCached, putCached, reserveAiCall, sha256Hex, untrusted, UNTRUSTED_NOTICE } from "./ai.js";

export const TIDY_MAX_ABOUT = 500;
export const TIDY_MAX_QUALIFICATION = 200;
export const TIDY_MAX_POSITION = 60;
// Current Cloudflare Workers AI text model. Keep this overrideable with CF_AI_MODEL,
// but do not fall back to the deprecated Llama 3.1/3.2 model family.
export const DEFAULT_CF_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

// ---------- positions: 1 profession + 1 alternate ----------

// Titles in the same row are treated as the same job. Extend freely.
const POSITION_FAMILIES = [
  ["cashier", "till operator", "checkout operator", "checkout assistant", "checkout clerk"],
  ["general worker", "general labourer", "general laborer", "labourer", "laborer", "general assistant", "factory worker"],
  ["admin clerk", "administrative clerk", "administration clerk", "office administrator", "admin assistant", "administrative assistant", "office clerk", "admin officer"],
  ["sales assistant", "sales consultant", "retail assistant", "shop assistant", "retail sales assistant"],
  ["security guard", "security officer"],
  ["driver", "delivery driver", "light delivery driver"],
  ["cleaner", "domestic worker", "domestic cleaner", "cleaning assistant", "housekeeper"],
  ["receptionist", "front desk receptionist", "front desk agent", "front desk"],
  ["call centre agent", "call center agent", "contact centre agent", "customer service agent", "customer care agent", "customer service representative", "customer service consultant"],
  ["waiter", "waitress", "waitron", "waiting staff"],
  ["stock controller", "stock clerk", "stock taker", "stockroom assistant", "stock room assistant"],
  ["packer", "general packer", "factory packer", "pack hand", "packing assistant"],
  ["teacher", "educator"],
  ["bookkeeper", "bookkeeping clerk"],
  ["gardener", "garden worker", "garden assistant"],
  ["warehouse assistant", "warehouse worker", "warehouse operator"],
  ["data capturer", "data capture clerk", "data entry clerk"],
  ["forklift driver", "forklift operator"]
];

const FAMILY_KEYS = POSITION_FAMILIES.map((family) => family.map(fold));
const SPLIT_RE = /\s*(?:,|;|\||\n|\s\/\s|\sand\s|\s&\s)\s*/i;
const SMALL_WORDS = new Set(["and", "of", "the", "for", "in", "at", "to", "a", "an"]);

function familyOf(key) {
  if (!key) return -1;
  const padded = ` ${key} `;
  for (let i = 0; i < FAMILY_KEYS.length; i++) {
    for (const phrase of FAMILY_KEYS[i]) {
      if (key === phrase || padded.includes(` ${phrase} `)) return i;
    }
  }
  return -1;
}

// "Cashier" ~ "Senior Cashier" ~ "Till Operator". Different jobs stay different.
export function similarPosition(a, b) {
  const ka = fold(a);
  const kb = fold(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length <= kb.length ? kb : ka;
  if (shorter.length >= 5 && ` ${longer} `.includes(` ${shorter} `)) return true;
  const fa = familyOf(ka);
  return fa !== -1 && fa === familyOf(kb);
}

const ACRONYMS = new Set(["hr", "it", "ict", "pa", "cnc", "hvac", "sap", "cfo", "ceo", "sme", "qa", "ux", "ui", "gis", "cad", "pdp", "prdp", "ohs", "sheq", "hse", "fmcg", "bpo", "cctv", "ecd", "ngo"]);

// "  gENERAL   worker " -> "General Worker";  "hr officer" -> "HR Officer"
export function titleCasePosition(value) {
  const text = clean(value, 120).replace(/[^A-Za-z0-9&'/()+.\- \u00C0-\u024F]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.split(" ").map((word, index) => {
    const lower = word.toLowerCase();
    if (ACRONYMS.has(lower.replace(/[^a-z]/g, ""))) return word.toUpperCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/(^|[-/'(])([a-z\u00E0-\u024F])/g, (_, lead, ch) => lead + ch.toUpperCase());
  }).join(" ").slice(0, TIDY_MAX_POSITION);
}

export function splitTitles(text) {
  return String(text || "").split(SPLIT_RE).map((p) => titleCasePosition(p)).filter(Boolean);
}

// Returns { profession, alternate, merged, text }.
//  - `typed`: what the candidate wrote (may hold 1..n titles, possibly similar)
//  - `extra`: further titles from a different source (CV scan, AI suggestion), used for the alternate
export function pairPositions(typed, extra = []) {
  const typedList = Array.isArray(typed) ? typed.flatMap(splitTitles) : splitTitles(typed);
  const extraList = (Array.isArray(extra) ? extra : []).flatMap(splitTitles);
  const distinct = [];
  const merged = [];
  for (const title of [...typedList, ...extraList]) {
    const match = distinct.find((existing) => similarPosition(existing, title));
    if (match) {
      // Keep the clearer (usually longer, more specific) wording as the profession title.
      if (fold(match) !== fold(title)) merged.push(title);
      continue;
    }
    distinct.push(title);
  }
  const profession = distinct[0] || "";
  const alternate = distinct[1] || "";
  return { profession, alternate, merged, text: [profession, alternate].filter(Boolean).join(", ") };
}

// ---------- names and plain text (rules only) ----------

const NAME_PARTICLES = new Set(["van", "der", "den", "de", "du", "le", "la", "von", "bin", "al", "da", "di", "ter", "ten"]);

export function tidyName(value) {
  const text = clean(value, 120);
  if (!text) return "";
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters || (letters !== letters.toUpperCase() && letters !== letters.toLowerCase())) return text; // already mixed case: leave it
  return text.split(" ").map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower;
    return lower.replace(/(^|[-'])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase()).replace(/^Mc([a-z])/, (_, ch) => "Mc" + ch.toUpperCase());
  }).join(" ");
}

export function basicTextTidy(value, max) {
  let text = String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  text = text.replace(/\s+([,.;:!?])/g, "$1").replace(/([,;:!?])(?=[A-Za-z])/g, "$1 ").replace(/\.(?=[A-Z][a-z])/g, ". ");
  text = text.replace(/\bi\b(?=[ ,.'!?]|$)/g, "I").replace(/\bi'm\b/gi, "I'm");
  text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
  return text.slice(0, max);
}

// ---------- accepting model edits ----------

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// A typo/grammar fix must stay close to what the candidate wrote.
export function acceptTextEdit(original, edited, max) {
  const o = clean(original, 4000);
  const e = String(edited == null ? "" : edited).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (!o) return "";
  if (!e) return basicTextTidy(o, max);
  const ratio = e.length / o.length;
  if (ratio < 0.7 || ratio > 1.35) return basicTextTidy(o, max);
  const oWords = fold(o).split(" ").filter(Boolean);
  const eWords = new Set(fold(e).split(" ").filter(Boolean));
  const kept = oWords.filter((w) => eWords.has(w)).length;
  if (oWords.length >= 4 && kept / oWords.length < 0.6) return basicTextTidy(o, max);
  return e.slice(0, max);
}

export function acceptTitleEdit(original, edited) {
  const o = titleCasePosition(original);
  const e = titleCasePosition(edited);
  if (!e) return o;
  if (!o) return e;
  return levenshtein(fold(o), fold(e)) <= Math.max(3, Math.floor(o.length * 0.4)) ? e : o;
}

// An AI-suggested alternate is accepted only when the candidate's own text points at it.
export function alternateSupported(title, ...texts) {
  const words = fold(title).split(" ").filter((w) => w.length >= 4);
  if (!words.length) return false;
  const hay = fold(texts.join(" "));
  return words.some((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2))));
}

// ---------- Workers AI ----------

export function tidyPrompt(row, wantAlternate) {
  const system = [
    "You are a careful proofreader for South African job-seeker profiles.",
    UNTRUSTED_NOTICE,
    "Return ONLY one JSON object, no other text, in this shape:",
    '{"positions":[""],"about_you":"","qualification":"","alternate":""}',
    "Rules:",
    "- Fix spelling, typos, punctuation and grammar. Keep the candidate's own meaning, voice (first person) and language.",
    "- Never add facts, skills, employers, numbers or claims that are not already written. Never remove facts.",
    "- Keep names, places and isiZulu / Sesotho / isiXhosa / Afrikaans words; correct them only when the typo is obvious.",
    "- positions: the candidate's job titles, spelling fixed, Title Case, no company names, one title per item.",
    "- about_you: at most 500 characters. qualification: at most 200 characters. Empty input stays an empty string.",
    wantAlternate
      ? "- alternate: ONE different, related job title that the candidate's own about_you or qualification clearly supports. If nothing supports it, return an empty string."
      : "- alternate: always an empty string."
  ].join("\n");
  const user = [
    untrusted("positions", row.position, 300),
    untrusted("about_you", row.about_you, 800),
    untrusted("qualification", row.qualification, 300),
    untrusted("sector", row.sector, 100)
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function parseModelJson(output) {
  let value = output && typeof output === "object" && "response" in output ? output.response : output;
  if (value && typeof value === "object") return value;
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}

async function runWorkersAi(env, messages) {
  const model = env.CF_AI_MODEL || DEFAULT_CF_MODEL;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Workers AI timed out")), Number(env.CF_AI_TIMEOUT_MS) || 20000); });
  let output;
  try { output = await Promise.race([env.AI.run(model, { messages, max_tokens: 700, temperature: 0 }), timeout]); }
  finally { clearTimeout(timer); }
  return { model, data: parseModelJson(output) };
}

// ---------- tidy one profile ----------

// `row` holds the profile's own text fields. Returns { patch, changes, usedAi, ai }.
// `patch` holds only fields that changed. Pure apart from the optional Workers AI call.
export async function tidyProfile(env, row, { extraPositions = [], allowAi = true } = {}) {
  const input = {
    full_name: String(row.full_name || ""),
    position: String(row.position || ""),
    about_you: String(row.about_you || ""),
    qualification: String(row.qualification || ""),
    sector: String(row.sector || "")
  };
  let ai = null;
  let model = "";
  let aiNote = "";
  const wantAlternate = env.CV_TIDY_AI_ALTERNATE !== "0";
  const needsAi = !!(input.about_you.trim() || input.qualification.trim() || input.position.trim());
  if (allowAi && needsAi && env.AI) {
    if (await reserveAiCall(env, { bucket: "cv-tidy", cap: Number(env.CV_TIDY_DAILY_CAP) > 0 ? Number(env.CV_TIDY_DAILY_CAP) : 300 })) {
      try {
        const run = await runWorkersAi(env, tidyPrompt(input, wantAlternate));
        ai = run.data;
        model = run.model;
        if (!ai) aiNote = "Workers AI returned unreadable output";
      } catch (error) {
        aiNote = String(error && error.message || error).slice(0, 160);
        console.error("cv-tidy Workers AI failed", aiNote);
      }
    } else {
      aiNote = "daily CV tidy budget used up";
    }
  } else if (allowAi && needsAi) {
    aiNote = "Workers AI is not bound (add [ai] binding = \"AI\" to wrangler.toml)";
  }

  // Positions: take the model's spelling fixes where they stay close, then apply the 1 + 1 rule.
  const typedTitles = splitTitles(input.position);
  const aiTitles = ai && Array.isArray(ai.positions) ? ai.positions.map((t) => String(t || "")) : [];
  const fixedTitles = typedTitles.map((title, index) => {
    const candidate = aiTitles.length === typedTitles.length ? aiTitles[index] : aiTitles.find((t) => levenshtein(fold(t), fold(title)) <= Math.max(3, Math.floor(title.length * 0.4)));
    return candidate ? acceptTitleEdit(title, candidate) : title;
  });
  const about = ai && typeof ai.about_you === "string" ? acceptTextEdit(input.about_you, ai.about_you, TIDY_MAX_ABOUT) : basicTextTidy(input.about_you, TIDY_MAX_ABOUT);
  const qualification = ai && typeof ai.qualification === "string" ? acceptTextEdit(input.qualification, ai.qualification, TIDY_MAX_QUALIFICATION) : basicTextTidy(input.qualification, TIDY_MAX_QUALIFICATION);

  let pair = pairPositions(fixedTitles, extraPositions);
  let alternateSource = pair.alternate ? "candidate" : "";
  if (pair.alternate && extraPositions.length && !splitTitles(input.position).some((t) => similarPosition(t, pair.alternate))) alternateSource = "cv";
  if (!pair.alternate && pair.profession && wantAlternate && ai && typeof ai.alternate === "string") {
    const suggestion = titleCasePosition(ai.alternate);
    if (suggestion && !similarPosition(suggestion, pair.profession) && alternateSupported(suggestion, about, qualification, input.sector)) {
      pair = pairPositions([pair.profession], [suggestion]);
      alternateSource = pair.alternate ? "ai" : "";
    }
  }

  const next = { full_name: tidyName(input.full_name), position: pair.text, about_you: about, qualification };
  const patch = {};
  const changes = [];
  for (const field of Object.keys(next)) {
    if (field === "position" && !pair.profession) continue; // never blank out a position
    if (next[field] !== input[field].trim() && !(next[field] === "" && !input[field].trim())) {
      patch[field] = next[field];
      changes.push(field);
    }
  }
  return {
    patch,
    changes,
    usedAi: !!ai,
    model,
    note: aiNote,
    profession: pair.profession,
    alternate: pair.alternate,
    alternateSource,
    merged: pair.merged,
    needsAlternate: !!pair.profession && !pair.alternate
  };
}

// ---------- tidy by id (Supabase row + D1 cache) ----------

const ROW_COLUMNS = "id,user_id,full_name,position,sector,qualification,about_you,created_at,status";

function serviceHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...(extra || {}) };
}

export async function fetchProfile(env, id) {
  const q = new URLSearchParams({ select: ROW_COLUMNS, id: `eq.${id}`, limit: "1" });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${q}`, { headers: serviceHeaders(env) });
  if (!res.ok) throw new Error(`Supabase returned ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function textHash(row) {
  return sha256Hex([row.full_name, row.position, row.about_you, row.qualification].map((v) => String(v || "").trim()).join("\u0001"));
}


// Saves the tidy text through the cv_box_tidy_apply() RPC, which keeps profile_updated_at unchanged so a
// tidy never re-ranks the CV Box cards (see supabase/migrations/20261121_cv_box_tidy_apply.sql). If that
// migration has not been applied yet, falls back to a plain update.
async function applyPatch(env, id, patch) {
  const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/cv_box_tidy_apply`, {
    method: "POST",
    headers: serviceHeaders(env, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_id: id, p_patch: patch, p_keep_ranking: true })
  });
  if (rpc.ok) return true;
  if (rpc.status !== 404) { console.error("cv-tidy rpc failed", rpc.status); return false; }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: serviceHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(patch)
  });
  if (!res.ok) console.error("cv-tidy save failed", res.status);
  return res.ok;
}

// force: tidy even when this exact text was already tidied.
export async function tidyCandidateById(env, id, { force = false, extraPositions = [], dryRun = false } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, status: 503, error: "CV tidy is not configured." };
  let row;
  try { row = await fetchProfile(env, id); } catch (error) { console.error("cv-tidy lookup failed", error); return { ok: false, status: 502, error: "Profile could not be loaded." }; }
  if (!row) return { ok: false, status: 404, error: "Profile not found." };
  const before = await textHash(row);
  if (!force) {
    const cached = await getCached(env, "cv-tidy", row.id);
    if (cached && cached.inputHash === before) return {
      ok: true,
      skipped: true,
      id: row.id,
      changes: [],
      usedAi: !!cached.model,
      model: cached.model || "",
      note: "This profile is already tidy.",
      profession: splitTitles(row.position)[0] || "",
      alternate: splitTitles(row.position)[1] || ""
    };
  }
  const result = await tidyProfile(env, row, { extraPositions });
  if (dryRun) return { ok: true, id: row.id, dryRun: true, ...result };
  if (result.changes.length) {
    const saved = await applyPatch(env, row.id, result.patch);
    if (!saved) return { ok: false, status: 502, error: "Tidied profile could not be saved." };
  }
  // Remember the tidy text so the same profile is not processed again. Only remember it when the AI
  // actually ran (or there was nothing for it to do), so a temporary AI outage is retried later.
  if (result.usedAi || !result.note) {
    await putCached(env, "cv-tidy", row.id, { inputHash: await textHash({ ...row, ...result.patch }), model: result.model, result: { changes: result.changes, alternateSource: result.alternateSource } });
  }
  return { ok: true, id: row.id, ...result };
}

// Profiles that are not tidied yet (newest first), for the admin "tidy all" button.
// One D1 query for the cache, so this stays inside the Worker's subrequest limit.
export async function listUntidied(env, { scan = 400, limit = 5 } = {}) {
  const q = new URLSearchParams({ select: ROW_COLUMNS, order: "created_at.desc", limit: String(Math.min(scan, 1000)) });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?${q}`, { headers: serviceHeaders(env) });
  if (!res.ok) throw new Error(`Supabase returned ${res.status}`);
  const rows = await res.json();
  const done = new Map();
  if (env.DB) {
    const cached = await env.DB.prepare("SELECT subject_id, input_hash FROM ai_results WHERE kind = 'cv-tidy'").all();
    for (const r of cached.results || []) done.set(String(r.subject_id), r.input_hash);
  }
  const todo = [];
  let pending = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (done.get(String(row.id)) === await textHash(row)) continue;
    pending++;
    if (todo.length < limit) todo.push(row.id);
  }
  return { ids: todo, pending };
}

// Scheduled maintenance path. Keep this deliberately small because each profile can
// use one Workers AI call plus one or two Supabase writes. A temporary AI outage is
// not cached by tidyCandidateById, so the next cron tick retries it.
export async function tidyUntidiedBatch(env, { scan = 400, limit = 3 } = {}) {
  if (!env.AI) return { skipped: "Workers AI binding is not configured" };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: "CV tidy is not configured" };
  const boundedLimit = Math.min(Math.max(Number(limit) || 3, 1), 5);
  const listed = await listUntidied(env, { scan, limit: boundedLimit });
  const results = [];
  for (const id of listed.ids) {
    try {
      const result = await tidyCandidateById(env, id);
      results.push({
        id,
        ok: result.ok,
        skipped: !!result.skipped,
        changed: result.changes || [],
        usedAi: !!result.usedAi,
        model: result.model || "",
        note: result.note || "",
        error: result.ok ? "" : result.error || "Tidy failed"
      });
    } catch (error) {
      console.error("scheduled CV tidy failed", id, error);
      results.push({ id, ok: false, skipped: false, changed: [], usedAi: false, model: "", note: "", error: "Tidy failed" });
    }
  }
  return { pending_before: listed.pending, processed: results.length, results };
}

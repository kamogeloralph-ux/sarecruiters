const AUTO_POST_SETTING = "tipchat_auto_vacancy_posts";
const LOOKBACK_DAYS = 14;
const MAX_VACANCIES_PER_ROUNDUP = 3;

function restUrl(env, table, params = {}) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function headers(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function getRows(env, table, params) {
  const response = await fetch(restUrl(env, table, params), { headers: headers(env) });
  if (!response.ok) throw new Error(`${table} query failed (${response.status})`);
  return await response.json();
}

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function bucketKey(date = new Date()) {
  const day = Math.floor(date.getTime() / (LOOKBACK_DAYS * 86400000));
  return String(day);
}

export function formatVacancyRoundup(vacancies, siteUrl) {
  const lines = vacancies.map((vacancy) => {
    const title = clean(vacancy.title, 110);
    const location = clean(vacancy.location, 80);
    const link = clean(vacancy.link, 180);
    return `• ${title} — ${location}${link ? `\n  Apply: ${link}` : ""}`;
  });
  return [
    "New opportunities on SA Recruiters:",
    ...lines,
    "View the full vacancy details and apply directly on SA Recruiters.",
    "Check the closing date and application instructions before applying.",
    siteUrl ? clean(siteUrl, 180) : ""
  ].filter(Boolean).join("\n");
}

export async function publishTipchatVacancyRoundup(env, now = new Date()) {
  const settingRows = await getRows(env, "app_settings", {
    select: "key,value", key: `eq.${AUTO_POST_SETTING}`, limit: "1"
  });
  if (!enabled(settingRows[0] && settingRows[0].value)) return { skipped: "disabled" };

  const groupRows = await getRows(env, "community_groups", {
    select: "id", slug: "eq.interview-tips", is_public: "eq.true", limit: "1"
  });
  const groupId = groupRows[0] && groupRows[0].id;
  if (!groupId) return { skipped: "group-unavailable" };

  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString();
  const existing = await getRows(env, "community_posts", {
    select: "system_key", is_official: "eq.true", created_at: `gte.${since}`,
    system_key: "like.tipchat-vacancy-*", limit: "200"
  });
  const promoted = new Set((existing || []).map((row) => String(row.system_key || "").split("-")[2]).filter(Boolean));
  const today = now.toISOString().slice(0, 10);
  const vacancies = await getRows(env, "vacancies", {
    select: "id,title,location,link,closing_date,created_at",
    title: "not.is.null", location: "not.is.null", link: "not.is.null",
    or: `(closing_date.is.null,closing_date.gte.${today})`,
    order: "created_at.desc,id.desc", limit: "100"
  });
  const chosen = (vacancies || []).filter((row) => {
    const id = String(row.id || "");
    return id && !promoted.has(id) && clean(row.title, 110) && clean(row.location, 80) && /^https?:\/\//i.test(String(row.link || ""));
  }).slice(0, MAX_VACANCIES_PER_ROUNDUP);
  if (!chosen.length) return { skipped: "no-eligible-vacancies" };

  const systemKey = `tipchat-vacancy-${chosen[0].id}-${bucketKey(now)}`;
  const body = formatVacancyRoundup(chosen, env.SITE_URL || "https://sa-recruiters.co.za");
  const response = await fetch(restUrl(env, "community_posts", { on_conflict: "system_key" }), {
    method: "POST",
    headers: { ...headers(env), Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      group_id: groupId,
      author_id: null,
      author_label: "SA Recruiters",
      body,
      status: "approved",
      is_official: true,
      system_key: systemKey,
      post_type: "vacancy",
      vacancy_title: chosen.length === 1 ? clean(chosen[0].title, 140) : "Daily vacancy roundup",
      vacancy_location: chosen.length === 1 ? clean(chosen[0].location, 120) : "South Africa",
      vacancy_application: chosen.length === 1 ? clean(chosen[0].link, 300) : null
    })
  });
  if (!response.ok) throw new Error(`community_posts insert failed (${response.status})`);
  const inserted = await response.json().catch(() => []);
  return { posted: Array.isArray(inserted) ? inserted.length : 1, vacancies: chosen.map((row) => String(row.id)), system_key: systemKey };
}

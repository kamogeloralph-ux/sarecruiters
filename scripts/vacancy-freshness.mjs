// ============================================================
//  SA RECRUITERS — scripts/vacancy-freshness.mjs
// ============================================================
//  One shared definition of "this vacancy is out of date", used by the
//  scrapers (skip at discovery), the link verifier (delete stale rows
//  even when their URL still resolves), and the one-off purge script.
//
//  Signals, in order of strength:
//    1. closing_date in the past  — the listing itself says applications
//       closed. Definitive when parseable.
//    2. posting age — JobMail posts "15 September 2026" and Graduates24
//       posts "Posted: 3 Feb 2021" on every card. Anything older than the
//       source's max age is stale regardless of whether the URL still
//       resolves (Graduates24 in particular never removes old posts, so a
//       2021 learnership stays listed — and was being served to users).
//    3. link dead — handled by verify-jobmail.mjs (now generalized).
//
//  A vacancy is kept only when NO available signal says it's stale. An
//  unparseable date is never treated as stale by itself — age-based rules
//  only fire on dates we actually understood.
// ============================================================

// Same per-source ceilings as delete_expired_vacancies() in
// supabase/migrations/20260919b_per_source_vacancy_ttl.sql, applied to
// posting dates rather than row age.
export const MAX_AGE_DAYS = {
  jobmail: 21,
  agency: 21,
  learnerships: 30,
  retail: 30,
  shoprite: 30,
  picknpay: 30,
  woolworths: 30,
  truworths: 30,
  spar: 30,
  adzuna: 45,
  himalayas: 45,
  government: 90, // DPSA circulars close on fixed dates but stay listed long
};

export const DEFAULT_MAX_AGE_DAYS = 60;

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9,
  november: 10, nov: 10, december: 11, dec: 11,
};

// Parses "17 Sep 2026", "15 September 2026", "2026-09-17", "17/09/2026"
// (day-first — South African convention) into a Date at UTC midnight.
export function parseDateString(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (m) {
    const day = +m[1], month = +m[2];
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(+m[3], month - 1, day));
    }
    return null;
  }
  m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(+m[3], month, +m[1]));
  }
  m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(+m[3], month, +m[2]));
  }
  return null;
}

export function maxAgeDaysForSource(sourceType) {
  return MAX_AGE_DAYS[sourceType] ?? DEFAULT_MAX_AGE_DAYS;
}

function daysBetween(fromDate, toDate) {
  return Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

// ---- Closing-date signal ------------------------------------------------
// A listing whose closing date has passed is out of date. Adds a 2-day
// grace period because scraped "Closes:" text is occasionally off by a
// day around midnight boundaries, and because some sites keep the page
// up briefly after closing.
export function closingDateIsPast(closingDate, now = new Date()) {
  const date = parseDateString(closingDate);
  if (!date) return false;
  return date.getTime() < now.getTime() - 2 * 86_400_000;
}

// ---- Posting-age signal --------------------------------------------------
// `postedText` is whatever the source shows ("Posted: 3 Feb 2021",
// "15 September 2026"). `fallbackDate` is the row's own created_at when
// the listing shows no date at all.
export function postingIsTooOld({ postedText, fallbackDate, sourceType, now = new Date() }) {
  const maxAgeDays = maxAgeDaysForSource(sourceType);
  const posted = parseDateString(postedText) ||
    (fallbackDate ? new Date(fallbackDate) : null);
  if (!posted || Number.isNaN(posted.getTime())) return false;
  return daysBetween(posted, now) > maxAgeDays;
}

// ---- Combined verdict ----------------------------------------------------
// Used at discovery (scrapers) and purge time. `job` needs:
//   { closing_date, postedText?, notes?, created_at?, source_type }
// Posted text is looked for in job.postedText first, then in notes (where
// jobmail stores "15 September 2026" and graduates24 "Posted: 3 Feb 2021").
export function extractPostedText(job) {
  if (job.postedText) return job.postedText;
  const notes = job.notes || '';
  const m = notes.match(/Posted:?\s*(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i);
  if (m) return m[1];
  // JobMail stores a bare date line in notes.
  const bare = notes.match(/^(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})\b/);
  if (bare) return bare[1];
  return '';
}

export function isStaleVacancy(job, now = new Date()) {
  if (closingDateIsPast(job.closing_date, now)) {
    return { stale: true, reason: 'closing date passed' };
  }
  const postedText = extractPostedText(job);
  if (postingIsTooOld({
    postedText,
    fallbackDate: job.created_at,
    sourceType: job.source_type,
    now,
  })) {
    const posted = parseDateString(postedText) || job.created_at;
    return { stale: true, reason: `posted ${posted} (older than ${maxAgeDaysForSource(job.source_type)} days)` };
  }
  return { stale: false, reason: '' };
}

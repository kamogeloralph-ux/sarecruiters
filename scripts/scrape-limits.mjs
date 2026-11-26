// ============================================================
//  SA RECRUITERS — scripts/scrape-limits.mjs
// ============================================================
//  One place to read numeric limits from the environment.
//
//  Why this exists: almost every scraper used to wrap its limit in
//      Math.min(Math.max(value, 250), 500)
//  which silently forced every source into a 250-500 window. A value outside
//  that window was ignored without any message, so the ceiling could not be
//  raised from the workflow even deliberately, and the floor made it
//  impossible to run a quick low-volume test. Limits are now explicit:
//  each caller states its own default and its own sane [min, max] range, and
//  a value that is out of range or not a number falls back to the default.
// ============================================================

export function envInt(raw, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Parses a comma-separated list, trimming blanks. Returns `fallback` when the
// variable is unset or empty so an empty repository variable never yields [].
export function envList(raw, fallback = []) {
  const list = String(raw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

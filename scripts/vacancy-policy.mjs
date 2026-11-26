// ============================================================
//  SA RECRUITERS — scripts/vacancy-policy.mjs
// ============================================================
//  Retention rules shared by enforce-vacancy-caps.mjs (which deletes) and
//  static-vacancy-filter.mjs (which builds the SEO snapshot). Dependency-free
//  on purpose so both can import it and tests can run without installs.
//
//  Before this file the two disagreed: the delete job kept up to 250-500 per
//  company while the snapshot filter kept 50, so the SEO/sitemap inventory was
//  silently a fraction of what the app serves.
// ============================================================
import { envInt } from './scrape-limits.mjs';

// Newest N vacancies kept per real agency / employer / unlinked company.
export const DEFAULT_MAX_PER_POSTER = 500;

export function posterCapFromEnv(env = process.env) {
  const cap = envInt(env.MAX_PER_POSTER, DEFAULT_MAX_PER_POSTER, { min: 25, max: 5000 });
  const companyCap = envInt(env.MAX_PER_COMPANY, cap, { min: 25, max: 5000 });
  return { cap, companyCap };
}

// Aggregators label anonymous advertisers with a placeholder. Those rows come from many
// different employers, so grouping them as "one company" and trimming to the cap would
// delete real, unrelated vacancies.
const GENERIC_COMPANY_LABELS = new Set([
  'private advertiser', 'confidential', 'confidential company', 'anonymous', 'undisclosed',
  'not specified', 'not disclosed', 'various', 'n/a', 'na', 'unknown', 'company confidential',
  'private employer', 'employer', 'jobs', 'direct employer',
]);

export function isGenericCompanyLabel(normalizedName) {
  return GENERIC_COMPANY_LABELS.has(String(normalizedName || '').trim().toLowerCase());
}

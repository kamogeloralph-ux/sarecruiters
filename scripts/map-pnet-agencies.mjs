import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const PNET_JOBS_URL = 'https://www.pnet.co.za/jobs';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUEST_TIMEOUT_MS = positiveInt(process.env.PNET_MAP_TIMEOUT_MS, 30_000);
const REQUEST_DELAY_MS = positiveInt(process.env.PNET_MAP_DELAY_MS, 1_500);
const AUTO_APPLY_THRESHOLD = confidenceThreshold(process.env.PNET_AUTO_APPLY_THRESHOLD, 0.95);
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersPnetMapper/1.0 (+https://sa-recruiters.co.za)';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function confidenceThreshold(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeCompanyName(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(proprietary|pty|limited|ltd|incorporated|inc|cc|close|corporation|corp)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalizeCompanyName(value).split(' ').filter((token) => token.length > 1));
}

export function scoreCompanyMatch(agencyName, candidateName) {
  const agency = normalizeCompanyName(agencyName);
  const candidate = normalizeCompanyName(candidateName);
  if (!agency || !candidate) return 0;
  if (agency === candidate) return 1;
  if (agency.includes(candidate) || candidate.includes(agency)) return 0.93;

  const left = tokens(agency);
  const right = tokens(candidate);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function absoluteUrl(href) {
  try {
    return new URL(href, PNET_JOBS_URL).toString();
  } catch {
    return null;
  }
}

function companyNameFromSlug(url) {
  const match = url.match(/\/cmp\/en\/([^/]+)\/jobs/i);
  if (!match) return '';
  return decodeURIComponent(match[1])
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function extractEmployerCandidates(html) {
  const $ = cheerio.load(html);
  const candidates = new Map();
  $('a[href*="/cmp/en/"]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'));
    if (!href) return;
    const match = href.match(/^(https:\/\/www\.pnet\.co\.za\/cmp\/en\/[^/]+\/jobs)(?:[/?#]|$)/i);
    if (!match) return;
    const url = match[1];
    const label = clean($(element).text()) || companyNameFromSlug(url);
    if (!candidates.has(url) || label.length > candidates.get(url).name.length) {
      candidates.set(url, { name: label, url });
    }
  });
  return [...candidates.values()];
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`Pnet returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function bestCandidate(agency, candidates) {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, confidence: scoreCompanyMatch(agency.name, candidate.name) }))
    .sort((left, right) => right.confidence - left.confidence || left.url.localeCompare(right.url));
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  const status = !best ? 'no_match'
    : best.confidence >= AUTO_APPLY_THRESHOLD && (!second || best.confidence - second.confidence >= 0.08) ? 'high_confidence'
      : best.confidence >= 0.55 ? 'review' : 'no_match';
  return {
    agency_id: agency.id,
    agency_name: agency.name,
    query_url: `${PNET_JOBS_URL}?q=${encodeURIComponent(agency.name)}`,
    candidate_url: best?.url || null,
    candidate_name: best?.name || null,
    confidence: best?.confidence || 0,
    status,
    alternatives: ranked.slice(1, 5),
  };
}

async function loadAgencies(includeMapped) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  let query = supabase.from('agencies').select('id,name,pnet_url').order('name', { ascending: true }).limit(500);
  if (!includeMapped) query = query.is('pnet_url', null);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function writeReport(report, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    auto_apply_threshold: AUTO_APPLY_THRESHOLD,
    results: report,
  }, null, 2)}\n`);
}

async function applyHighConfidence(results) {
  const updates = results.filter((result) => result.status === 'high_confidence' && result.candidate_url);
  for (const result of updates) {
    const { error } = await supabase.from('agencies').update({ pnet_url: result.candidate_url }).eq('id', result.agency_id);
    if (error) throw error;
  }
  return updates.length;
}

export async function mapAgencies({ agencies, fetch = fetchPage, delayMs = 0 }) {
  const results = [];
  for (const agency of agencies) {
    const queryUrl = `${PNET_JOBS_URL}?q=${encodeURIComponent(agency.name)}`;
    try {
      const html = await fetch(queryUrl);
      const result = bestCandidate(agency, extractEmployerCandidates(html));
      results.push({ ...result, error: null });
      console.log(`[pnet-map] ${agency.name}: ${result.status} ${result.candidate_name || 'no candidate'} (${result.confidence.toFixed(2)})`);
    } catch (error) {
      results.push({
        agency_id: agency.id,
        agency_name: agency.name,
        query_url: queryUrl,
        candidate_url: null,
        candidate_name: null,
        confidence: 0,
        status: 'error',
        alternatives: [],
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`[pnet-map] ${agency.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return results;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const includeMapped = process.argv.includes('--all');
  const apply = process.argv.includes('--apply');
  const outputPath = argument('--output', 'pnet-agency-mapping.json');
  const limit = positiveInt(argument('--limit', '500'), 500);
  const agencies = (await loadAgencies(includeMapped)).slice(0, limit);
  const results = await mapAgencies({ agencies, delayMs: REQUEST_DELAY_MS });
  await writeReport(results, outputPath);
  console.log(`[pnet-map] wrote ${results.length} results to ${outputPath}`);

  if (apply) {
    const applied = await applyHighConfidence(results);
    console.log(`[pnet-map] applied ${applied} high-confidence mappings (>= ${(AUTO_APPLY_THRESHOLD * 100).toFixed(0)}%); review statuses remain unchanged`);
  } else {
    console.log(`[pnet-map] dry run only; use --apply to write high-confidence mappings (>= ${(AUTO_APPLY_THRESHOLD * 100).toFixed(0)}%) to Supabase`);
  }
}

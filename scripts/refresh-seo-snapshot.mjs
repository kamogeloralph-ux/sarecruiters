import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { filterLiveVacancies } from './static-vacancy-filter.mjs';

const DEFAULT_WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
const workerUrl = (process.env.SA_RECRUITERS_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, '');
const outputPath = process.env.SEO_SNAPSHOT_PATH || new URL('../data/startup.json', import.meta.url);
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(fetchImpl, url, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch (error) {
      if (attempt === 4) throw new Error(`${label} request failed after ${attempt} attempts: ${error.message}`, { cause: error });
      await pause(250 * (2 ** (attempt - 1)));
      continue;
    }
    if (response.ok) return response.json();
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 4) {
      throw new Error(`${label} ${url} returned ${response.status} after ${attempt} attempt(s)`);
    }
    await pause(250 * (2 ** (attempt - 1)));
  }
  throw new Error(`${label} failed after retries`);
}

export async function fetchFreshSeoSnapshot(fetchImpl = fetch, baseUrl = workerUrl) {
  const startup = await fetchJsonWithRetry(fetchImpl, `${baseUrl}/api/startup`, 'Public startup endpoint');
  if (!startup || !Array.isArray(startup.agencies) || !Array.isArray(startup.branches) || !startup.generated_at) {
    throw new Error('Public startup payload is incomplete or has no generated_at timestamp');
  }
  const generatedAt = Date.parse(startup.generated_at);
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 5 * 60_000 || Date.now() - generatedAt > 72 * 60 * 60_000) {
    throw new Error(`Public startup payload is stale or invalid: ${startup.generated_at}`);
  }

  const vacancies = [];
  const seenCursors = new Set();
  let cursor = '';
  for (let page = 0; page < 500; page++) {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const payload = await fetchJsonWithRetry(fetchImpl, `${baseUrl}/api/vacancies?${params}`, 'Public vacancies endpoint');
    if (!payload || !Array.isArray(payload.vacancies)) throw new Error('Public vacancies payload is invalid');
    vacancies.push(...payload.vacancies);
    const next = payload.next_cursor || null;
    if (!next) break;
    if (seenCursors.has(next)) throw new Error('Public vacancies endpoint repeated a pagination cursor');
    seenCursors.add(next);
    cursor = next;
    if (page === 499) throw new Error('Public vacancy export exceeded the 25,000-row safety limit');
  }
  if (!vacancies.length) throw new Error('Refusing to replace SEO data with an empty vacancy inventory');
  const ids = vacancies.map((row) => row && row.id).filter(Boolean);
  if (ids.length !== vacancies.length || new Set(ids).size !== ids.length) throw new Error('Public vacancy inventory contains missing or duplicate IDs');
  const liveVacancies = filterLiveVacancies(vacancies, { now: new Date() });
  if (!liveVacancies.length) throw new Error('Refusing to replace SEO data with an empty live vacancy inventory');
  return { ...startup, vacancies: liveVacancies, generated_at: startup.generated_at, seo_refreshed_at: new Date().toISOString() };
}

async function main() {
  const snapshot = await fetchFreshSeoSnapshot();
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot)}\n`);
  console.log(`[seo-snapshot] refreshed ${snapshot.vacancies.length} vacancies from ${workerUrl}; source generated ${snapshot.generated_at}`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`[seo-snapshot] ${error.message}`);
    process.exitCode = 1;
  });
}

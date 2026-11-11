import fs from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_WORKER_URL = 'https://sarecruiters-uploader.kamogeloralph.workers.dev';
const workerUrl = (process.env.SA_RECRUITERS_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, '');
const outputPath = process.env.SEO_SNAPSHOT_PATH || new URL('../data/startup.json', import.meta.url);

export async function fetchFreshSeoSnapshot(fetchImpl = fetch, baseUrl = workerUrl) {
  const startupResponse = await fetchImpl(`${baseUrl}/api/startup`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!startupResponse.ok) throw new Error(`Public startup endpoint returned ${startupResponse.status}`);
  const startup = await startupResponse.json();
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
    const response = await fetchImpl(`${baseUrl}/api/vacancies?${params}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Public vacancies endpoint returned ${response.status}`);
    const payload = await response.json();
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
  return { ...startup, vacancies, generated_at: startup.generated_at, seo_refreshed_at: new Date().toISOString() };
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

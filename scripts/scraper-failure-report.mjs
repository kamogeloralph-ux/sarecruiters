import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sendOpsEmail } from './send-ops-email.mjs';

// A source must fail this many refreshes in a row before anyone is emailed
// (the refresh runs twice a day, so 3 = about a day and a half). Each
// source is emailed about once per outage, then a quiet "recovered" note.
export const FAIL_THRESHOLD = 3;

export function planReport(failedNow, prevState) {
  const prev = prevState || {};
  const next = {};
  const toAlert = [];
  for (const name of failedNow) {
    const before = prev[name] || { streak: 0, alerted: false };
    const entry = { streak: before.streak + 1, alerted: before.alerted };
    if (entry.streak >= FAIL_THRESHOLD && !entry.alerted) { toAlert.push({ name, streak: entry.streak }); entry.alerted = true; }
    next[name] = entry;
  }
  const recovered = Object.keys(prev).filter((name) => prev[name].alerted && !failedNow.includes(name));
  return { toAlert, recovered, next };
}

async function main() {
  const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const failedNow = [...new Set(read('failed-sources.txt').split('\n').map((l) => l.trim()).filter(Boolean))];
  let prev = {};
  try { prev = JSON.parse(read('.scraper-state/state.json') || '{}'); } catch { prev = {}; }
  const { toAlert, recovered, next } = planReport(failedNow, prev);
  mkdirSync('.scraper-state', { recursive: true });
  writeFileSync('.scraper-state/state.json', JSON.stringify(next));
  console.log(`[scrapers] failed now: ${failedNow.join(', ') || 'none'}; alerting: ${toAlert.map((a) => a.name).join(', ') || 'none'}`);
  if (!toAlert.length && !recovered.length) return;
  const lines = [];
  if (toAlert.length) {
    lines.push('These sources have failed several refreshes in a row:');
    for (const a of toAlert) lines.push(`• ${a.name} (${a.streak} refreshes in a row)`);
    lines.push('', 'The other sources are still being published. See the GitHub Actions log for the error.');
  }
  if (recovered.length) lines.push('', `Recovered: ${recovered.join(', ')}`);
  await sendOpsEmail({ subject: toAlert.length ? `SA Recruiters: ${toAlert.map((a) => a.name).join(', ')} scraper keeps failing` : 'SA Recruiters: scrapers recovered', text: lines.join('\n') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 0; });
}

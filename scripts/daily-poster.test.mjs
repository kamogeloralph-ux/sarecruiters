import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { pickPosterOfTheDay } = await import('./generate-daily-poster.mjs');

const now = new Date('2026-11-10T05:00:00Z');
const row = (id, hoursAgo, extra = {}) => ({
  id, title: `Job ${id}`, company: 'Co', link: 'https://example.com/' + id,
  created_at: new Date(now - hoursAgo * 3600e3).toISOString(), ...extra,
});

test('picks the newest fresh vacancy', () => {
  assert.equal(pickPosterOfTheDay([row('a', 2), row('b', 5)], now).id, 'a');
});
test('skips rows without a title or link', () => {
  assert.equal(pickPosterOfTheDay([row('a', 1, { link: '' }), row('b', 3)], now).id, 'b');
});
test('returns null when there is nothing eligible', () => {
  assert.equal(pickPosterOfTheDay([], now), null);
});
test('falls back to a rotating pick when nothing is fresh', () => {
  const rows = [row('a', 100), row('b', 120)];
  assert.ok(['a', 'b'].includes(pickPosterOfTheDay(rows, now).id));
});
test('generator no longer publishes to the posters feed', () => {
  const src = readFileSync(new URL('./generate-daily-poster.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /automation\/poster|employer_posters|fetch\(/);
  const wf = readFileSync(new URL('../.github/workflows/daily-poster.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(wf, /POSTER_AUTOMATION_TOKEN|POSTERS_PER_RUN|WORKER_URL/);
});

test('poster renderer produces a 1080x1350 JPEG, including for very long text', { skip: spawnSync('python3', ['-c', 'import PIL']).status !== 0 }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poster-'));
  const script = fileURLToPath(new URL('./render-poster.py', import.meta.url));
  const cases = [
    { title: 'Pharmacist', company: 'Eastpark Pharmacy', location: 'Springs, Gauteng', closing: '30 November 2026', apply: 'Apply: sa-recruiters.co.za' },
    { title: 'Senior Regional Operations and Supply Chain Compliance Manager (Fixed Term Contract) – Africa Cluster', company: 'Imperial Logistics International Holdings (Pty) Ltd t/a Cross-Border Freight Solutions', location: 'Johannesburg Central Business District, Gauteng' },
    { title: 'Cashier' },
  ];
  cases.forEach((c, i) => {
    const input = path.join(dir, `in${i}.json`);
    const out = path.join(dir, `out${i}.jpg`);
    writeFileSync(input, JSON.stringify(c));
    const r = spawnSync('python3', [script, input, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const buf = readFileSync(out);
    assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8); // JPEG magic bytes
    const probe = spawnSync('python3', ['-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', out], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), '1080 1350');
  });
  rmSync(dir, { recursive: true, force: true });
});

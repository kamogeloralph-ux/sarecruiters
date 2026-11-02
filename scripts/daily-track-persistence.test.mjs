import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../Cloudflare-worker/worker.js', import.meta.url), 'utf8');
const appData = readFileSync(new URL('../app-data.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const adSeed = readFileSync(new URL('../supabase/seeds/20261102_ikhaya_events_legacy_house_ad.sql', import.meta.url), 'utf8');
const banner = fileURLToPath(new URL('../assets/house-ads/ikhaya-events-legacy-1640x624.png', import.meta.url));

test('Track of the Day explains the R2 audio and Supabase metadata split', () => {
  assert.match(admin, /MP3 audio is stored in Cloudflare R2; track details are saved in Supabase <code>daily_tracks<\/code>/);
  assert.match(appData, /audio file is served from Cloudflare R2; Supabase stores its metadata/);
  assert.doesNotMatch(admin, /daily_tracks<\/code> table or the <code>daily-tracks<\/code> storage bucket/);
});

test('Track of the Day surfaces metadata-read failures instead of silently showing an empty list', () => {
  const start = admin.indexOf('async function getTracks(){');
  const end = admin.indexOf('async function upsertAgency(', start);
  assert.ok(start >= 0 && end > start);
  const loader = admin.slice(start, end);
  assert.match(loader, /window\._tracksLoadError/);
  assert.match(loader, /console\.error\('daily_tracks load'/);
  assert.match(admin, /Could not load track details from Supabase/);
});

test('Track save validates size, uploads to R2, confirms the Supabase upsert, and rolls back partial uploads', () => {
  const start = admin.indexOf('async function saveTrack(){');
  const end = admin.indexOf('async function deleteTrack(', start);
  assert.ok(start >= 0 && end > start);
  const save = admin.slice(start, end);
  assert.match(save, /trackFileChosen\.size > 25 \* 1024 \* 1024/);
  assert.match(save, /R2_WORKER_URL \+ '\/api\/upload\/daily-track/);
  assert.match(save, /supabaseClient\.from\('daily_tracks'\)\.upsert\(row\)\.select\('id'\)\.single\(\)/);
  assert.match(save, /async function rollbackPendingUpload\(\)/);
  assert.match(save, /deleteR2Object\(pendingPath\)/);
  assert.match(save, /Writes require a signed-in account listed in public\.admin_users/);
  assert.match(save, /spotify_url:\s*spotifyUrl \|\| null/);
  assert.ok(save.indexOf("'/api/upload/daily-track") < save.indexOf("from('daily_tracks').upsert(row)"), 'audio must upload before the metadata row is committed');
});

test('daily-track uploads remain admin-authenticated and bounded by the Worker', () => {
  const start = worker.indexOf('if (path === "/api/upload/daily-track" && request.method === "POST")');
  const end = worker.indexOf('if (path === "/api/migrate-photos"', start);
  assert.ok(start >= 0 && end > start);
  const handler = worker.slice(start, end);
  assert.match(handler, /isAdminRequest\(request, env\)/);
  assert.match(handler, /MAX_TRACK_BYTES/);
  assert.match(handler, /env\.MEDIA_BUCKET\.put\(key, bytes/);
});

test('Ikhaya house ad keeps the supplied banner ratio and seed targeting is limited to directory top slots', () => {
  assert.match(appData, /var isIkhayaAd = \/ikhaya\/i\.test\(adIdentity\)/);
  assert.match(appData, /var imageWidth = isIkhayaAd \? 1640 : 1200/);
  assert.match(appData, /var imageHeight = isIkhayaAd \? 624 : 400/);
  assert.match(css, /\.house-ad-creative--ikhaya\{aspect-ratio:1640 \/ 624/);
  assert.match(adSeed, /ARRAY\['agencies',\s*'employers',\s*'candidates',\s*'posters'\]::text\[\]/);
  assert.match(adSeed, /'Ikhaya Events & Legacy'/);
  assert.ok(existsSync(banner), 'the source banner should be committed with the app');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, mapJoobleResults, joobleApiUrl } from './sync-jooble.mjs';

const now = new Date('2026-11-19T10:00:00Z');

test('clean strips highlight tags and entities from Jooble snippets', () => {
  assert.equal(clean('Looking for a <b>driver</b>&nbsp;in Durban &amp; area'), 'Looking for a driver in Durban & area');
});

test('maps Jooble jobs into the shared vacancy shape', () => {
  const [job] = mapJoobleResults({ jobs: [{
    id: 123456789, title: '<b>Driver</b>', company: 'Acme Logistics', location: 'Durban', link: 'https://za.jooble.org/desc/123456789',
    snippet: 'Valid <b>code 10</b> licence required', salary: 'R8 000', type: 'Full-time', updated: '2026-11-18T00:00:00.0000000',
  }] }, now);
  assert.equal(job.id, 'jooble-123456789');
  assert.equal(job.title, 'Driver');
  assert.equal(job.source_type, 'jooble');
  assert.equal(job.link, 'https://za.jooble.org/desc/123456789');
  assert.match(job.notes, /R8 000 · Full-time · Posted 2026-11-18 · Valid code 10 licence required/);
});

test('drops incomplete, duplicate and stale listings', () => {
  const jobs = mapJoobleResults({ jobs: [
    { id: 1, title: 'A', link: 'https://x/1', location: 'Durban', updated: '2026-11-18' },
    { id: 1, title: 'A again', link: 'https://x/1b' },
    { id: 2, title: '', link: 'https://x/2' },
    { id: 3, title: 'No link' },
    { id: 4, title: 'Old', link: 'https://x/4', updated: '2026-08-01' },
  ] }, now);
  assert.deepEqual(jobs.map((j) => j.id), ['jooble-1']);
  assert.deepEqual(mapJoobleResults(null, now), []);
});

test('the API key is never printed', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./sync-jooble.mjs', import.meta.url), 'utf8');
  assert.ok(!/console\.\w+\([^)]*JOOBLE_API_KEY/.test(src.replace(/check JOOBLE_API_KEY|JOOBLE_API_KEY is required/g, '')));
});

test('builds a regional Jooble API URL without exposing the key', () => {
  assert.equal(joobleApiUrl('secret-key', 'https://za.jooble.org/'), 'https://za.jooble.org/api/secret-key');
});

import { isSouthAfricanLocation as __isSA } from './sync-jooble.mjs';
test('keeps only South African locations', () => {
  for (const ok of ['Durban', 'Sandton, Gauteng', 'Cape Town, Western Cape', 'South Africa', 'Pretoria, ZA ']) assert.equal(__isSA(ok), true, ok);
  for (const bad of ['London, United Kingdom', 'Lagos, Nigeria', 'Perth, Australia', 'Austin, TX', 'Nairobi, Kenya', '', 'Remote']) assert.equal(__isSA(bad), false, bad);
});

test('za.jooble.org results from towns outside the built-in list are kept; foreign ones are still rejected', () => {
  const payload = { jobs: [
    { id: 1, title: 'Driver', link: 'https://za.jooble.org/desc/1', location: 'Sterkspruit', updated: '2026-11-18' },
    { id: 2, title: 'Cook', link: 'https://za.jooble.org/desc/2', location: '', updated: '2026-11-18' },
    { id: 3, title: 'Nurse', link: 'https://za.jooble.org/desc/3', location: 'London, United Kingdom', updated: '2026-11-18' },
  ] };
  assert.deepEqual(mapJoobleResults(payload, now).map((j) => j.id), [], 'the generic domain still needs a known SA place');
  assert.deepEqual(mapJoobleResults(payload, now, { trustDomain: true }).map((j) => j.id), ['jooble-1', 'jooble-2']);
});

test('rejections are counted so an empty source can be diagnosed from the log', () => {
  const stats = {};
  mapJoobleResults({ jobs: [
    { id: 1, title: 'A', link: 'https://x/1', location: 'Dwarsloop', updated: '2026-11-18' },
    { id: 2, title: 'B', link: 'https://x/2', location: 'Durban', updated: '2026-08-01' },
  ] }, now, { stats });
  assert.equal(stats.rejectedLocation, 1);
  assert.equal(stats.rejectedStale, 1);
  assert.equal(stats.rejectedLocations.get('Dwarsloop'), 1);
});

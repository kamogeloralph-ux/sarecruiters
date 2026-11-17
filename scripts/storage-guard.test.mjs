import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const core = read('../app-core.js');
const cards = read('../app-cards.js');

test('savedSet init survives blocked localStorage (SA-RECRUITERS-WEB-6)', () => {
  assert.doesNotMatch(core, /new Set\(JSON\.parse\(localStorage\.getItem\('savedVacancies'\)/);
  assert.match(core, /export var savedSet = new Set\(readSavedVacancies\(\)\);/);
});

test('theme init does not touch localStorage unguarded at module load', () => {
  assert.doesNotMatch(core, /localStorage\.getItem\('saTheme'\)/);
  assert.doesNotMatch(core, /localStorage\.setItem\('saTheme'/);
});

test('saving a vacancy does not throw when storage is blocked', () => {
  assert.doesNotMatch(cards, /localStorage\.setItem\('savedVacancies'/);
  assert.match(cards, /storageSet\('savedVacancies'/);
});

test('storage helpers fall back when localStorage throws', () => {
  const src = core.match(/export function storageGet[\s\S]*?\n}\nexport function storageSet[\s\S]*?\n}\nfunction readSavedVacancies[\s\S]*?\n}\n/)[0]
    .replace(/export /g, '');
  const localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  const api = new Function('localStorage', src + 'return { storageGet, storageSet, readSavedVacancies };')(localStorage);
  assert.equal(api.storageGet('saTheme', 'light'), 'light');
  assert.equal(api.storageSet('x', '1'), false);
  assert.deepEqual(api.readSavedVacancies(), []);
});

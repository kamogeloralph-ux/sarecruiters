import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(root, 'app-core.js'), 'utf8');

test('savedSet seeding does not touch localStorage unguarded at module top level', () => {
  assert.doesNotMatch(core, /export var savedSet = new Set\(JSON\.parse\(localStorage/);
  assert.match(core, /export function storageGet\(/);
  assert.match(core, /export function storageSet\(/);
});

test('initTheme reads saTheme through the safe storage helper', () => {
  assert.doesNotMatch(core, /var saved = localStorage\.getItem\('saTheme'\)/);
  assert.match(core, /storageGet\('saTheme'/);
});

test('storage helpers fall back when localStorage throws SecurityError', () => {
  const start = core.indexOf('var __saStorageWarned');
  const end = core.indexOf('export var savedSet');
  const src = core.slice(start, end).replace(/export function/g, 'function');
  const warnings = [];
  const ctx = {
    console: { warn: (...a) => warnings.push(a) },
    get localStorage() { throw new Error('SecurityError: Access is denied for this document.'); },
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.result = [storageGet("savedVacancies", "[]"), storageSet("k", "v")];', ctx);
  assert.equal(JSON.stringify(ctx.result), JSON.stringify(['[]', false]));
  assert.equal(warnings.length, 1);
});

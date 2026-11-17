import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const core = read('../app-core.js');
const vacancyV2 = read('../app-vacancy-v2.js');

test('app-core savedSet seed survives a localStorage SecurityError', () => {
  const match = core.match(/export var savedSet = (\(function \(\) \{[\s\S]*?\}\)\(\));/);
  assert.ok(match, 'savedSet should be seeded by a guarded IIFE');
  const blocked = {};
  Object.defineProperty(blocked, 'getItem', { get() { throw new Error('SecurityError'); } });
  const sandbox = {
    console: { warn() {} },
    Set,
    JSON,
    Array,
  };
  Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error("SecurityError: Failed to read the 'localStorage' property"); } });
  const result = vm.runInNewContext(match[1], sandbox);
  assert.equal(result.size, 0);
});

test('app-core theme init does not touch localStorage unguarded at module load', () => {
  assert.match(core, /\(function initTheme\(\) \{\s*var saved = 'light';\s*try \{ saved = localStorage\.getItem\('saTheme'\) \|\| 'light'; \} catch \(e\) \{\}/);
});

test('app-vacancy-v2 reads bundle readiness flags through window', () => {
  assert.doesNotMatch(vacancyV2, /[^.\w](generalVacancyCountLoaded|dedicatedVacancyCountsLoaded)\b/);
  assert.match(vacancyV2, /window\.generalVacancyCountLoaded/);
});

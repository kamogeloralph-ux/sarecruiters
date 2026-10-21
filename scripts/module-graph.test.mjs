import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FILES } = require('./bundle-app.js');
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const entry = read('app-entry.js');
const sources = Object.fromEntries(FILES.map((f) => [f, read(f)]));

// Names a module exposes: the keys of its window bridge (every top-level
// declaration is listed there) plus its set_<var> setters.
function bridgeNames(src) {
  const at = src.indexOf('// ===== window bridge');
  assert.ok(at !== -1, 'missing window bridge');
  const bridge = src.slice(at);
  const names = new Set();
  for (const m of bridge.matchAll(/Object\.assign\(window, \{([\s\S]*?)\n\}\);/g)) {
    for (const line of m[1].split('\n')) { const n = line.trim().replace(/,$/, ''); if (n) names.add(n); }
  }
  for (const m of bridge.matchAll(/^  ([A-Za-z_$][\w$]*): \{ get:/gm)) names.add(m[1]);
  for (const m of bridge.matchAll(/export function (set_[A-Za-z_$][\w$]*)\(/g)) names.add(m[1]);
  return names;
}

test('app-entry.js imports every app module, in bundle-app.js order', () => {
  const imported = [...entry.matchAll(/^import '\.\/(app-[\w-]+\.js)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imported, FILES);
});

test('every app module ends with a window bridge so inline handlers keep working', () => {
  for (const f of FILES) assert.ok(sources[f].includes('// ===== window bridge'), f + ' has no window bridge');
});

test('named imports between app modules all resolve to an export of the target', () => {
  const exportsOf = Object.fromEntries(FILES.map((f) => [f, bridgeNames(sources[f])]));
  for (const f of FILES) {
    for (const m of sources[f].matchAll(/^import \{([^}]*)\} from '\.\/(app-[\w-]+\.js)';$/gm)) {
      const target = m[2];
      assert.ok(exportsOf[target], f + ' imports from unknown module ' + target);
      for (const raw of m[1].split(',')) {
        const name = raw.trim();
        if (name) assert.ok(exportsOf[target].has(name), `${f} imports ${name} but ${target} does not export it`);
      }
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { countBySource, compareYield, renderYieldTable } from './source-yield-report.mjs';

test('counts rows per source and labels rows without a source', () => {
  assert.deepEqual(countBySource([{ source_type: 'adzuna' }, { source_type: 'adzuna' }, { source_type: null }, {}]), { adzuna: 2, '(none)': 2 });
});

test('flags a source that collapses, but not small or growing ones', () => {
  const rows = compareYield({ adzuna: 3000, jooble: 30, himalayas: 400, new: 0 }, { adzuna: 150, jooble: 0, himalayas: 450, new: 9 });
  const by = Object.fromEntries(rows.map((r) => [r.source, r]));
  assert.equal(by.adzuna.collapsed, true);
  assert.equal(by.jooble.collapsed, false, 'previous count below the noise floor');
  assert.equal(by.himalayas.collapsed, false);
  assert.equal(by.new.delta, 9);
});

test('renders a markdown table including ATS feed health', () => {
  const md = renderYieldTable(compareYield({}, { adzuna: 5 }), [{ id: 'myjobmag', mode: 'pull', rows_held: 12, last_status: 'ok:12/12 removed:0', last_synced_at: 'now' }]);
  assert.match(md, /\| adzuna \| 5 \| 0 \| \+5 \|/);
  assert.match(md, /myjobmag/);
});

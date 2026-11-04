import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('admin persistence helpers return false for database errors and true after success', () => {
  for (const name of ['upsertEmployer', 'removeEmployer', 'upsertBranch', 'removeBranch', 'removeVacancy']) {
    const match = admin.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
    assert.ok(match, `${name} helper exists`);
    assert.match(match[0], /return false/, `${name} reports failure`);
    assert.match(match[0], /return true/, `${name} reports confirmed success`);
    assert.match(match[0], /catch\s*\(/, `${name} handles rejected network promises`);
  }
});

test('failed employer and branch saves leave their editor open', () => {
  assert.match(admin, /var employerSaved = await upsertEmployer\(payload\);\s*if \(employerSaved === false\) return;/);
  assert.match(admin, /var branchSaved = await upsertBranch\([\s\S]*?\);\s*if \(branchSaved === false\) return;/);
});

test('failed employer, branch, and vacancy deletes do not show success or optimistically remove data', () => {
  assert.match(admin, /var employerRemoved = await removeEmployer\(id\);\s*if \(employerRemoved === false\) return;[\s\S]*?showToast\('Employer deleted'\)/);
  assert.match(admin, /var branchRemoved = await removeBranch\(id\);\s*if \(branchRemoved === false\) return;[\s\S]*?showToast\('Branch deleted'\)/);
  assert.match(admin, /var vacancyRemoved = await removeVacancy\(id\);\s*if \(vacancyRemoved === false\) return;[\s\S]*?showToast\('Vacancy deleted'\)[\s\S]*?cache\.vacancies = cache\.vacancies\.filter/);
});

// Verification harness: prove the regression tests detect the ORIGINAL bugs.
//
// A green suite on fixed code only shows the tests agree with the fix. This
// harness instead takes the CURRENT tree and re-introduces each original defect
// one at a time, then requires the specific test that guards it to fail. If a
// defect can be restored without any test failing, that test is a no-op.
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SANDBOX = '/tmp/detect-check';

// Each entry re-introduces one defect from the original implementation and
// names the test expected to catch it.
const DEFECTS = [
  {
    name: 'refreshHome only ADDS .active (stacked screens, the most literal contamination)',
    file: 'app-ui.js',
    from: /function refreshHome\(\) \{[\s\S]*?\n\}/,
    to: `function refreshHome() {
  var home = document.getElementById('screen-home');
  if (home) home.classList.add('active');
  showToast('Refreshing…');
  if (typeof saRefreshAll === 'function') saRefreshAll('home-button');
  else loadAll();
}`,
    expect: 'refreshHome switches cleanly',
  },
  {
    name: 'loadAll repaints the remembered screen instead of the visible one',
    file: 'app-data.js',
    from: /if \(typeof saRenderActiveScreen === 'function'\) saRenderActiveScreen\(\);\n  else if \(typeof renderRestoredScreenContent === 'function'\) renderRestoredScreenContent\(\);/,
    to: `if (typeof renderRestoredScreenContent === 'function') renderRestoredScreenContent();`,
    expect: 'paints the visible screen and leaves hidden screens alone',
  },
  {
    name: 'folder renderer loses its container-ownership guard',
    file: 'app-ui.js',
    from: /  \/\/ Same ownership rule as renderGeneralVacancyCards\(\): never write the folder\n  \/\/ listing while its screen is not the visible one\.\n  if \(typeof saShouldRenderContainer === 'function' && !saShouldRenderContainer\('allvacancies-list'\)\) return;\n/,
    to: '',
    expect: 'abandoned vacancy folder is not repainted',
  },
  {
    name: 'refresh no longer clears the open folder / restore marker',
    file: 'scripts/app-refresh.js',
    from: /  function resetTransientScreenState\(\) \{[\s\S]*?\n  \}\n/,
    to: `  function resetTransientScreenState() {
    // Defect restored: does nothing.
  }
`,
    expect: 'clears folder, pagination and restore markers',
  },
  {
    name: 'vacancy overview loses its container-ownership guard',
    file: 'app-ui.js',
    from: /  \/\/ The overview branch below writes #allvacancies-list directly[\s\S]*?!saShouldRenderContainer\('allvacancies-list'\)\) return;\n\n/,
    to: '',
    expect: 'vacancy overview is not repainted',
  },
];

mkdirSync(SANDBOX, { recursive: true });

let allCaught = true;
for (const defect of DEFECTS) {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });
  execSync(`cp -r ${ROOT}/. ${SANDBOX}/`, { shell: '/bin/bash' });
  rmSync(join(SANDBOX, '.git'), { recursive: true, force: true });
  // Keep dependencies resolvable. A bare removal makes jsdom unresolvable in
  // the copy, which fails the whole file rather than the one specific test.
  rmSync(join(SANDBOX, 'node_modules'), { recursive: true, force: true });
  execSync(`ln -s ${ROOT}/node_modules ${SANDBOX}/node_modules`, { shell: '/bin/bash' });

  const target = join(SANDBOX, defect.file);
  const src = readFileSync(target, 'utf8');
  if (!defect.from.test(src)) {
    console.log(`SKIP  ${defect.name}\n      (could not locate the code to revert — anchor drifted)`);
    allCaught = false;
    continue;
  }
  writeFileSync(target, src.replace(defect.from, defect.to));

  let output = '';
  try {
    output = execSync(`node --test scripts/refresh-pipeline.test.mjs 2>&1`, {
      cwd: SANDBOX, encoding: 'utf8', timeout: 180000,
    });
  } catch (e) {
    output = (e.stdout || '') + (e.stderr || '');
  }

  const failing = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const caught = failing.some((n) => n.includes(defect.expect));

  console.log(
    `${caught ? 'CAUGHT' : 'MISSED'}  ${defect.name}\n` +
    `        expected test: "${defect.expect}"\n` +
    `        failing tests: ${failing.length ? failing.join(', ') : '(none)'}`
  );
  if (!caught) allCaught = false;
}

rmSync(SANDBOX, { recursive: true, force: true });
console.log('');
console.log(allCaught
  ? 'ALL DEFECTS CAUGHT — every reverted bug fails a specific regression test.'
  : 'SOME DEFECTS WERE MISSED — the suite does not fully guard the fix.');
process.exit(allCaught ? 0 : 1);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('guide integration exposes persistent settings and required event types', () => {
  const source = read('app-guide-integration.js');
  for (const name of ['getSettings', 'setSettings', 'resetOnboarding', 'sa-guide:event', 'sa-guide:settings-changed']) {
    assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const type of ['new-jobs-loaded', 'job-saved', 'application-opened', 'profile-incomplete', 'filters-active', 'offline', 'fresh-jobs', 'empty-results']) {
    assert.match(source, new RegExp(type));
  }
});

test('settings are discoverable from the profile preferences UI', () => {
  const html = read('index.html');
  assert.match(html, /openSaGuideSettings\(\)/);
  for (const id of ['sa-guide-enabled', 'sa-guide-quiet', 'sa-guide-tips-only', 'sa-guide-intensity', 'sa-guide-settings-overlay']) {
    assert.match(html, new RegExp(id));
  }
});

test('source events are attached to real transitions', () => {
  assert.match(read('app-cards.js'), /saGuideEvent\('job-saved'/);
  assert.match(read('app-guide-integration.js'), /closest\('\.vac-apply, \.home-vacancy-apply'\)/);
  assert.match(read('app-data.js'), /saGuideEvent\('offline'/);
  assert.match(read('app-data.js'), /saGuideEvent\('new-jobs-loaded'/);
  assert.match(read('app-ui.js'), /saGuideEvent\('filters-active'/);
  assert.match(read('app-ui.js'), /saGuideEvent\('profile-incomplete'/);
});

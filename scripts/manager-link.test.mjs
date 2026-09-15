import test from 'node:test';
import assert from 'node:assert/strict';

function publicAppUrl(adminUrl, query) {
  const url = new URL(adminUrl);
  const publicPath = url.pathname.replace(/\/admin(?:\.html)?\/?$/, '/');
  return `${url.origin}${publicPath}?${query}`;
}

test('manager links target the public app when production rewrites /admin.html to /admin', () => {
  assert.equal(
    publicAppUrl('https://sa-recruiters.co.za/admin', 'manage=abc123'),
    'https://sa-recruiters.co.za/?manage=abc123',
  );
  assert.equal(
    publicAppUrl('https://sa-recruiters.co.za/admin.html', 'manage=abc123'),
    'https://sa-recruiters.co.za/?manage=abc123',
  );
});

test('manager links preserve a GitHub Pages-style deployment subpath', () => {
  assert.equal(
    publicAppUrl('https://kamogeloralph-ux.github.io/sarecruiters/admin', 'manage_employer=xyz789'),
    'https://kamogeloralph-ux.github.io/sarecruiters/?manage_employer=xyz789',
  );
});

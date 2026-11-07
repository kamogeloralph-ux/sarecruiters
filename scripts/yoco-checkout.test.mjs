import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const worker = read('../Cloudflare-worker/worker.js');
const html = read('../index.html');
const sheets = read('../app-sheets.js');
const migration = read('../Cloudflare-worker/migrations/0006_cv_download_orders.sql');
test('CV Box checkout uses server price and validates an active candidate CV', () => {
  const handler = worker.slice(worker.indexOf('async function cvCheckoutResponse'), worker.indexOf('__name(cvCheckoutResponse'));
  assert.match(handler, /env\.CV_DOWNLOAD_PRICE_CENTS \|\| "4900"/);
  assert.doesNotMatch(handler, /body\.amount/);
  assert.match(handler, /payments\.yoco\.com\/api\/checkouts/);
  assert.match(worker, /env\.YOCO_LIVE_SECRET_KEY \|\| env\.YOCO_SECRET_KEY/);
  assert.match(worker, /event\?\.metadata\?\.checkoutId \|\| event\?\.payload\?\.metadata\?\.checkoutId/);
  assert.match(handler, /Idempotency-Key/);
  assert.match(handler, /pool_candidates\?/);
  assert.match(handler, /status: "eq\.active"/);
});
test('CV Box fulfillment verifies webhook signature freshness and Yoco payment', () => {
  assert.match(worker, /webhook-signature/);
  assert.match(worker, /webhook-timestamp/);
  assert.match(worker, /subtle\.verify\("HMAC"/);
  assert.match(worker, /Math\.abs\(Date\.now\(\) \/ 1000 - seconds\) > 180/);
  assert.match(worker, /checkout\.status !== "completed"/);
  assert.match(worker, /checkout\.amount !== result\.amount_cents/);
  assert.match(worker, /\/api\/yoco\/webhook/);
});
test('paid CV delivery is gated by paid status and a 72-hour expiry', () => {
  assert.match(worker, /order\.status !== "paid"/);
  assert.match(worker, /download_expires_at/);
  assert.match(worker, /candidate-cvs\//);
  assert.match(worker, /sendCvDownloadEmail\(env, result, result\.download_token, contact\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cv_download_orders/);
  assert.match(migration, /customer_email TEXT NOT NULL/);
});
test('CV Box payment sheet collects delivery email and keeps WhatsApp fallback', () => {
  assert.match(html, /id="cv-download-email"/);
  assert.match(html, /Pay R49 and download CV/);
  assert.match(html, /id="cv-download-whatsapp"/);
  assert.match(sheets, /api\/cv-box\/checkout/);
  assert.match(sheets, /window\.location\.assign\(result\.redirectUrl\)/);
});

test('CV Box checkout displays all deployed payment-brand SVGs accessibly', () => {
  for (const [file, label] of [['yoco.svg', 'Yoco'], ['applepay.svg', 'Apple Pay'], ['googlepay.svg', 'Google Pay'], ['visa.svg', 'Visa'], ['amex.svg', 'American Express'], ['mastercard.svg', 'Mastercard']]) {
    assert.match(html, new RegExp(`<img[^>]+src="/${file}"[^>]+alt="${label}"`));
  }
  assert.match(html, /class="cv-payment-methods"/);
});

test('checkout return text waits for webhook confirmation and removes its one-time query flag', () => {
  const ui = read('../app-ui.js');
  assert.match(ui, /If your payment succeeded, we’ll email your private CV download link after Yoco confirms it/);
  assert.match(ui, /params\.delete\('cvPayment'\)/);
});
test('CV Box checkout accepts the app-generated (non-UUID) candidate ids', () => {
  // Regression: candidate ids are base36 strings made by the app, so a
  // UUID-only check made every "Pay R49 and download CV" fail with
  // "Choose a valid CV Box profile."
  const handler = worker.slice(worker.indexOf('async function cvCheckoutResponse'), worker.indexOf('__name(cvCheckoutResponse'));
  const m = handler.match(/if \(!(\/\^[^\n]*?\$\/)\.test\(candidateId\)\)/);
  assert.ok(m, 'candidate id validation regex found');
  const idPattern = eval(m[1]);
  const sampleId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  assert.ok(idPattern.test(sampleId), 'base36 app id is accepted');
  assert.ok(idPattern.test('0b8f2a0c-3f3e-4c55-9d5a-7a1c2b3d4e5f'), 'uuid still accepted');
  assert.ok(idPattern.test('12345'), 'numeric id accepted');
  for (const bad of ['', ' ', 'a b', "x'y", 'a&id=eq.1', '../x', 'a'.repeat(65)]) assert.ok(!idPattern.test(bad), `rejects ${JSON.stringify(bad)}`);
  assert.match(handler, /body\.candidateId \?\? ""/);
  assert.match(sheets, /candidateId: String\(c\.id\)/);
});

test('paid CV email includes the candidate contact details and the owner is alerted on payment', () => {
  assert.match(worker, /fetchCvCandidateContact\(env, result\.candidate_id\)/);
  assert.match(worker, /contact_phone,contact_email/);
  assert.match(worker, /Candidate contact details/);
  assert.doesNotMatch(worker, /Candidate contact details are not included/);
  assert.doesNotMatch(html, /Candidate contact details are not included/);
  assert.match(worker, /CV payment received/);
  assert.match(worker, /ADMIN_NOTIFY_EMAIL/);
});

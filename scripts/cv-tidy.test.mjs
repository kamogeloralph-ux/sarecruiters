import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptTextEdit, acceptTitleEdit, alternateSupported, basicTextTidy, pairPositions, similarPosition, tidyName, tidyProfile, titleCasePosition } from '../Cloudflare-worker/cv-tidy.js';

const fakeDb = { prepare: () => ({ bind: () => ({ first: async () => ({ count: 1 }) }) }) };
const aiReturning = (obj) => ({ run: async () => ({ response: JSON.stringify(obj) }) });

test('similar titles are recognised, different jobs are not', () => {
  assert.ok(similarPosition('Cashier', 'Till Operator'));
  assert.ok(similarPosition('Administrator', 'Administrator Assistant') === true);
  assert.ok(similarPosition('General Worker', 'General Assistant'));
  assert.ok(!similarPosition('Cashier', 'Driver'));
  assert.ok(!similarPosition('Forklift Operator', 'Picker'));
});

test('one profession and one alternate: similar titles merge, the alternate must be a different job', () => {
  assert.equal(pairPositions('cashier, till operator').text, 'Cashier');
  assert.equal(pairPositions('cashier, till operator').alternate, '');
  assert.equal(pairPositions('cashier, till operator', ['Sales Assistant']).text, 'Cashier, Sales Assistant');
  assert.equal(pairPositions('Cashier, Driver, Cleaner').text, 'Cashier, Driver', 'only two are kept');
  assert.equal(pairPositions('general worker AND packer').text, 'General Worker, Packer');
  assert.equal(pairPositions('hr officer').text, 'HR Officer');
});

test('names, titles and text are tidied without inventing anything', () => {
  assert.equal(tidyName('THABO MOKOENA'), 'Thabo Mokoena');
  assert.equal(tidyName('johan van der merwe'), 'Johan van der Merwe');
  assert.equal(tidyName("Nomvula O'Neil"), "Nomvula O'Neil");
  assert.equal(titleCasePosition('  gENERAL   worker '), 'General Worker');
  assert.equal(basicTextTidy('i am hard working ,i love people. i can start now'), 'I am hard working, I love people. I can start now');
});

test('model edits that stray from the original are rejected', () => {
  const original = 'I am a hard working person with 3 years experiance in retail';
  assert.equal(acceptTextEdit(original, 'I am a hard-working person with 3 years of experience in retail.', 500), 'I am a hard-working person with 3 years of experience in retail.');
  assert.match(acceptTextEdit(original, 'Seasoned executive with 15 years leading global teams and an MBA from Wits', 500), /hard working/, 'invented content is thrown away');
  assert.equal(acceptTitleEdit('Cashir', 'Cashier'), 'Cashier');
  assert.equal(acceptTitleEdit('Cashier', 'Chief Executive Officer'), 'Cashier');
  assert.ok(alternateSupported('Sales Assistant', 'I worked in sales for two years'));
  assert.ok(!alternateSupported('Pilot', 'I worked in sales for two years'));
});

test('tidyProfile fixes typos, merges similar positions and keeps contact/identity untouched', async () => {
  const env = { DB: fakeDb, AI: aiReturning({ positions: ['Cashier', 'Till Operator'], about_you: 'I am hard working and have 3 years of experience in sales.', qualification: 'Matric', alternate: 'Sales Assistant' }) };
  const row = { full_name: 'THABO MOKOENA', position: 'cashir, till operater', about_you: 'i am hard working and have 3 years experiance in sales', qualification: 'matric', sector: 'Retail' };
  const out = await tidyProfile(env, row);
  assert.equal(out.patch.position, 'Cashier, Sales Assistant');
  assert.equal(out.alternateSource, 'ai');
  assert.equal(out.patch.full_name, 'Thabo Mokoena');
  assert.match(out.patch.about_you, /experience/);
  assert.deepEqual(Object.keys(out.patch).sort(), ['about_you', 'full_name', 'position', 'qualification']);
});

test('an unsupported AI alternate is not used, and the AI turned off still tidies by rules', async () => {
  const env = { DB: fakeDb, AI: aiReturning({ positions: ['Cashier'], about_you: '', qualification: '', alternate: 'Airline Pilot' }) };
  const out = await tidyProfile(env, { full_name: 'Thabo Mokoena', position: 'cashier', about_you: 'i like people', qualification: '', sector: 'Retail' });
  assert.equal(out.alternate, '');
  assert.equal(out.needsAlternate, true);
  const noAi = await tidyProfile({ DB: fakeDb }, { full_name: 'Thabo Mokoena', position: 'general worker, general labourer', about_you: 'i like people', qualification: '', sector: '' });
  assert.equal(noAi.patch.position, 'General Worker');
  assert.equal(noAi.patch.about_you, 'I like people');
  assert.equal(noAi.usedAi, false);
});

test('a broken or failing model never blanks a profile', async () => {
  const bad = { DB: fakeDb, AI: { run: async () => { throw new Error('boom'); } } };
  const out = await tidyProfile(bad, { full_name: 'Thabo Mokoena', position: 'Driver', about_you: 'I drive.', qualification: 'Code 14', sector: '' });
  assert.deepEqual(out.changes, []);
  assert.equal(out.usedAi, false);
  const junk = { DB: fakeDb, AI: { run: async () => ({ response: 'sorry I cannot' }) } };
  assert.deepEqual((await tidyProfile(junk, { full_name: 'A B', position: 'Driver', about_you: '', qualification: '', sector: '' })).changes, []);
});

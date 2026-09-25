import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhakisaVacancies } from './sync-phakisa.mjs';

const fixture = `
<div class="job-spec">
  <div id="job_spec_title"><div class="job-spec-value">Warehouse Supervisor</div><a href="/wi/vacancy?id=phakisa_holdings&amp;vacancy_ref=JHB000999">details</a></div>
  <div id="start_date"><time datetime="2026-09-20">20 Sep 2026</time> - <time datetime="2026-10-20">20 Oct 2026</time></div>
  <div id="job_spec_type"><div class="job-spec-value">Contractor</div></div>
  <div id="job_spec_ref">#JHB000999</div>
  <div id="location"><div class="job-spec-value">Gauteng, JHB - Eastern Suburbs</div></div>
  <div id="salary"><div class="job-spec-value">R18,000 monthly</div></div>
  <div id="description"><div class="job-spec-value">Manage a warehouse team.</div></div>
  <div id="apply_button"><a href="/wi/application_form.php?id=phakisa_holdings&amp;vacancy_ref=JHB000999">Apply</a></div>
</div>
<div class="job-spec">
  <div id="job_spec_title"><div class="job-spec-value">Expired Driver</div><a href="/wi/vacancy?id=phakisa_holdings&amp;vacancy_ref=JHB000998">details</a></div>
  <div id="start_date"><time datetime="2026-08-01">1 Aug 2026</time> - <time datetime="2026-09-01">1 Sep 2026</time></div>
  <div id="job_spec_ref">#JHB000998</div>
  <div id="apply_button"><a href="/wi/application_form.php?id=phakisa_holdings&amp;vacancy_ref=JHB000998">Apply</a></div>
</div>`;

test('parses current Phakisa vacancies into direct application records', () => {
  const rows = parsePhakisaVacancies(fixture, new Date('2026-09-25T00:00:00Z'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Warehouse Supervisor');
  assert.equal(rows[0].location, 'Gauteng, JHB - Eastern Suburbs');
  assert.equal(rows[0].employment_type, 'Contractor');
  assert.equal(rows[0].closing_date, '2026-10-20');
  assert.equal(rows[0].salary, 'R18,000 monthly');
  assert.match(rows[0].link, /application_form\.php/);
  assert.equal(rows[0].source_type, 'agency');
});

test('uses stable reference IDs and does not import duplicate references', () => {
  const duplicate = fixture.replace('</div>\n<div class="job-spec">', '</div>\n<div class="job-spec">').replace('Expired Driver', 'Warehouse Supervisor').replace('JHB000998', 'JHB000999');
  const rows = parsePhakisaVacancies(duplicate, new Date('2026-09-25T00:00:00Z'));
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^agency-[a-f0-9]{20}$/);
});

test('rejects an application URL that leaves the trusted Placement Partner host', () => {
  const malicious = fixture.replace('/wi/application_form.php?id=phakisa_holdings&amp;vacancy_ref=JHB000999', 'https://example.invalid/apply');
  const rows = parsePhakisaVacancies(malicious, new Date('2026-09-25T00:00:00Z'));
  assert.equal(rows.length, 0);
});

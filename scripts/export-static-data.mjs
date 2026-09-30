import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { filterLiveVacancies, splitVacancyNotes } from './static-vacancy-filter.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const output = path.join(root, 'data', 'startup.json');
const notesOutput = path.join(root, 'data', 'vacancy-notes.json');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });
const pageSize = 1000;

async function readAll(table, columns, order = 'id') {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from(table).select(columns).order(order, { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function publicVacancy(row) {
  const allowed = ['id','agency_id','employer_id','title','company','company_photo','location','closing_date','notes','link','email','phone','remote','experience_level','employment_type','contract_type','work_schedule','hours','salary','start_date','created_at','source_type','is_featured','featured_until','featured_order'];
  return Object.fromEntries(allowed.map((key) => [key, row[key] ?? null]));
}

const [agencies, branches, employers, rawVacancies] = await Promise.all([
  readAll('agencies', 'id,name,website,contact,email,location,address,cvpref,photo,companies,trades,verified,created_at', 'created_at'),
  readAll('branches', 'id,agency_id,name,location,phone,email', 'name'),
  readAll('employers', 'id,name,industry,website,contact,email,location,address,photo,verified,created_at', 'created_at'),
  readAll('vacancies', 'id,agency_id,employer_id,title,company,company_photo,location,closing_date,notes,link,email,phone,remote,experience_level,employment_type,contract_type,work_schedule,hours,salary,start_date,created_at,source_type,is_featured,featured_until,featured_order', 'created_at'),
]);
const publicRows = rawVacancies.map(publicVacancy).filter((row) => row.id && row.title && row.link);
// Only publish (and count) what the app keeps live: drop closed listings and apply the same
// newest-50-per-poster cap the daily enforce-vacancy-caps job applies to the database.
const liveVacancies = filterLiveVacancies(publicRows);
// Descriptions are shipped separately (data/vacancy-notes.json) so the startup payload stays small.
const { lean: vacancies, notes: vacancyNotes } = splitVacancyNotes(liveVacancies);
console.log(`[static-data] ${publicRows.length} rows read, ${vacancies.length} live after expiry + per-poster caps`);
const dedicated = {
  himalayas: ['himalayas'], adzuna: ['adzuna'], government: ['government', 'dpsa'],
  retail: ['retail', 'shoprite', 'picknpay', 'woolworths', 'truworths', 'spar'],
  learnerships: ['learnerships'], careers_page: ['careers_page'],
};
const isDedicated = (row) => Object.values(dedicated).some((types) => types.includes(String(row.source_type || '').toLowerCase()));
const isGeneral = (row) => !row.employer_id && (!row.agency_id || row.agency_id === 'general') && !isDedicated(row);
const featured = vacancies.filter((row) => row.is_featured && (!row.featured_until || new Date(row.featured_until).getTime() >= Date.now())).sort((a, b) => (Number(a.featured_order) || 0) - (Number(b.featured_order) || 0) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12);
const counts = { vacancies: vacancies.length, general: vacancies.filter(isGeneral).length, dedicated: {}, employers: employers.length, agencies: agencies.length, candidates: 0 };
for (const [name, types] of Object.entries(dedicated)) counts.dedicated[name] = vacancies.filter((row) => types.includes(String(row.source_type || '').toLowerCase())).length;
const payload = {
  schema: 1,
  updated_at: new Date().toISOString(),
  agencies: agencies.map(({ manage_token, ...row }) => row),
  branches,
  employers: employers.map(({ manage_token, ...row }) => row),
  vacancies,
  featured_vacancies: featured,
  counts,
  notes_url: 'data/vacancy-notes.json',
  settings: { public_vacancy_posting: false, public_employer_registration: false, public_employer_directory: true },
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(payload));
await fs.writeFile(notesOutput, JSON.stringify(vacancyNotes));
console.log(`[static-data] wrote ${vacancies.length} vacancies, ${agencies.length} agencies, ${employers.length} employers to ${output}`);

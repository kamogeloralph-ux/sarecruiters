import fs from 'node:fs/promises';
import { filterLiveVacancies } from './static-vacancy-filter.mjs';

const file = process.argv[2] || 'data/startup.json';
const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
const rows = Array.isArray(snapshot.vacancies) ? snapshot.vacancies : [];
if (!rows.length) throw new Error('snapshot contains zero vacancies');
const ids = rows.map((row) => row.id).filter(Boolean);
if (ids.length !== rows.length) throw new Error('snapshot contains a vacancy without an id');
if (new Set(ids).size !== ids.length) throw new Error('snapshot contains duplicate vacancy ids');
const live = filterLiveVacancies(rows, { now: new Date() });
if (live.length !== rows.length) throw new Error(`snapshot contains ${rows.length - live.length} expired/capped rows after export`);
if (!snapshot.counts || typeof snapshot.counts.candidates !== 'number') throw new Error('snapshot counts are missing');
console.log(`[snapshot] valid: ${rows.length} vacancies, ${snapshot.counts.candidates} candidates, generated ${snapshot.generated_at || 'unknown'}`);

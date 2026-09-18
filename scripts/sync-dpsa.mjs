import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DPSA_BASE = 'https://www.dpsa.gov.za';
const DPSA_PAGE_BASE = `${DPSA_BASE}/newsroom/psvc`;
const GOVERNMENT_TIMEOUT_MS = Number(process.env.GOVERNMENT_TIMEOUT_MS || process.env.DPSA_TIMEOUT_MS || 30_000);
const GOVERNMENT_MAX_CIRCULAR = Number(process.env.GOVERNMENT_MAX_CIRCULAR || process.env.DPSA_MAX_CIRCULAR || 60);
const GOVERNMENT_YEARS = String(process.env.GOVERNMENT_YEARS || process.env.DPSA_YEARS || new Date().getUTCFullYear())
  .split(',').map((year) => Number(year.trim())).filter(Boolean);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugPart(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function circularPageUrl(number, year) {
  return `${DPSA_PAGE_BASE}/circular-${number}-of-${year}/`;
}

function parsePostingDate(text) {
  const match = clean(text).match(/Posting Date\s*:?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  return match ? match[1] : '';
}

function parseDateValue(text) {
  const match = clean(text).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;
  const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  const month = months[match[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]))).toISOString().slice(0, 10);
}

function absolutize(url, pageUrl) {
  try { return new URL(url, pageUrl).href; } catch { return ''; }
}

export function parseCircularPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const heading = clean($('h1').first().text() || $('title').first().text());
  const circularMatch = heading.match(/Circular\s+(\d+)\s+of\s+(\d{4})/i) || pageUrl.match(/circular-(\d+)-of-(\d{4})/i);
  if (!circularMatch) return null;
  const number = Number(circularMatch[1]);
  const year = Number(circularMatch[2]);
  const bodyText = clean($('body').text());
  const postingDate = parsePostingDate(bodyText);
  const links = [];
  $('a[href]').each((_, anchor) => {
    const href = clean($(anchor).attr('href'));
    if (!/\.pdf(?:$|\?)/i.test(href)) return;
    links.push({ url: absolutize(href, pageUrl), label: clean($(anchor).text()) });
  });
  const pdf = links.find((item) => /PSV\s*CIRCULAR/i.test(item.url) || /CIRCULAR/i.test(item.label))?.url || links[0]?.url || '';
  if (!pdf) return null;
  const departmentPdfs = links.filter((item) => item.url && item.url !== pdf);
  return {
    id: `government-circular-${year}-${String(number).padStart(2, '0')}`,
    title: `Government Public Service Vacancy Circular ${number} of ${year}`,
    company: 'South African Government',
    location: 'South Africa',
    notes: clean([postingDate ? `Posting date: ${postingDate}.` : '', 'Official government public-service vacancy circular archive record.', `Circular page: ${pageUrl}`].filter(Boolean).join(' ')),
    link: pdf,
    departmentPdfs,
    agency_id: 'general',
    source_type: 'government',
    source_checked_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    created_at: parseDateValue(postingDate) || new Date().toISOString(),
  };
}

function parseDepartmentName(lines) {
  const line = lines.find((item) => /\bDEPARTMENT\b|\bMUNICIPALITY\b|\bPROVINCIAL GOVERNMENT\b/i.test(item));
  return clean(line?.replace(/^ANNEXURE\s+[A-Z]\s*/i, '') || 'South African Government Department');
}

function parsePostBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(clean);
  const starts = [];
  lines.forEach((line, index) => {
    if (/^POST\s+\d+\/\d+\s*:/i.test(line)) starts.push(index);
  });
  return starts.map((start, index) => lines.slice(start, starts[index + 1] || lines.length).join('\n')).filter(Boolean);
}

function fieldFromBlock(block, label) {
  const match = block.match(new RegExp(`(?:^|\\n)${label}\\s*:?\\s*(.*?)(?=\\n[A-Z][A-Z /-]{2,30}\\s*:|$)`, 'is'));
  return match ? clean(match[1]) : '';
}

export function parseGovernmentPdfText(text, { circularNumber, year, pdfUrl, sourceFile = '' } = {}) {
  const fullText = String(text || '').replace(/\r/g, '');
  const lines = fullText.split('\n').map(clean).filter(Boolean);
  const company = parseDepartmentName(lines);
  const closingDate = parseDateValue(fullText.match(/CLOSING DATE\s*:?\s*([^\n]+)/i)?.[1] || '');
  const blocks = parsePostBlocks(fullText);
  return blocks.map((block, index) => {
    const header = block.match(/^POST\s+(\d+\/\d+)\s*:\s*([\s\S]*?)(?=\s+REF\s+NO\s*:|\n|$)/i);
    const postNumber = header?.[1] || `${index + 1}`;
    const ref = block.match(/REF\s+NO\s*:\s*([^\n]+)/i)?.[1] ? clean(block.match(/REF\s+NO\s*:\s*([^\n]+)/i)[1]) : '';
    let title = clean(header?.[2] || '').replace(/\s+/g, ' ');
    if (!title) title = clean(block.split('\n')[0].replace(/^POST\s+[^:]+:\s*/i, ''));
    const centre = fieldFromBlock(block, 'CENTRE');
    const salary = fieldFromBlock(block, 'SALARY');
    const requirements = fieldFromBlock(block, 'REQUIREMENTS');
    const duties = fieldFromBlock(block, 'DUTIES');
    const id = `government-${year}-${String(circularNumber).padStart(2, '0')}-${slugPart(sourceFile || 'department')}-${slugPart(postNumber)}-${slugPart(ref).slice(0, 24) || index + 1}`;
    const notes = clean([
      ref ? `Reference: ${ref}.` : '',
      salary ? `Salary: ${salary}.` : '',
      requirements ? `Requirements: ${requirements}` : '',
      duties ? `Duties: ${duties}` : '',
      `Government vacancy from Public Service Vacancy Circular ${circularNumber} of ${year}.`,
    ].filter(Boolean).join(' ')).slice(0, 12000);
    return {
      id, title, company, location: centre || 'South Africa', closing_date: closingDate,
      notes, link: pdfUrl, agency_id: 'general', source_type: 'government',
      source_checked_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
      created_at: closingDate ? new Date(`${closingDate}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
    };
  }).filter((job) => job.title && !/^ANNEXURE|^CONTENTS$/i.test(job.title));
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOVERNMENT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/pdf,text/html' } });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } finally { clearTimeout(timer); }
}

async function pdfToText(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'government-pdf-'));
  const pdfPath = path.join(dir, 'source.pdf');
  const txtPath = path.join(dir, 'source.txt');
  try {
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync('pdftotext', ['-layout', pdfPath, txtPath], { maxBuffer: 20 * 1024 * 1024 });
    return await fs.readFile(txtPath, 'utf8');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export async function discoverCirculars({ years = GOVERNMENT_YEARS, maxCircular = GOVERNMENT_MAX_CIRCULAR } = {}) {
  const found = [];
  for (const year of years) {
    for (let number = maxCircular; number >= 1; number -= 1) {
      const pageUrl = circularPageUrl(number, year);
      try {
        const html = await fetch(new Request(pageUrl, { headers: { accept: 'text/html' } })).then((response) => response.ok ? response.text() : null);
        if (!html) continue;
        const circular = parseCircularPage(html, pageUrl);
        if (circular) found.push(circular);
      } catch (error) { console.warn(`[government] unable to inspect ${pageUrl}: ${error.message}`); }
    }
  }
  return found;
}

export async function discoverGovernmentVacancies(options = {}) {
  const circulars = await discoverCirculars(options);
  const jobs = [];
  for (const circular of circulars) {
    for (const department of circular.departmentPdfs || []) {
      try {
        const buffer = await fetchBuffer(department.url);
        if (!buffer) continue;
        const text = await pdfToText(buffer);
        jobs.push(...parseGovernmentPdfText(text, { circularNumber: circular.id.match(/-(\d+)$/)?.[1] || '', year: circular.id.match(/government-circular-(\d+)-/)?.[1] || '', pdfUrl: department.url, sourceFile: department.url.split('/').pop() }));
      } catch (error) { console.warn(`[government] unable to parse ${department.url}: ${error.message}`); }
    }
  }
  return jobs;
}

export async function upsertGovernmentVacancies(vacancies) {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!vacancies.length) return 0;
  const { error } = await supabase.from('vacancies').upsert(vacancies, { onConflict: 'id' });
  if (error) throw error;
  return vacancies.length;
}

async function main() {
  const vacancies = await discoverGovernmentVacancies();
  const unique = [...new Map(vacancies.map((vacancy) => [vacancy.id, vacancy])).values()];
  console.log(`[government] discovered ${unique.length} vacancies from DPSA public-service circulars across ${GOVERNMENT_YEARS.join(', ')}`);
  const count = await upsertGovernmentVacancies(unique);
  console.log(`[government] upserted ${count} vacancy records`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`[government] sync failed: ${error.message}`); process.exitCode = 1; });
}

export { circularPageUrl, slugPart };
export const parseCircularPageForTest = parseCircularPage;
export const parseGovernmentPdfTextForTest = parseGovernmentPdfText;

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

export const PHAKISA_FEED_URL = 'https://webapp.placementpartner.com/wi/weblinks.php?id=phakisa_holdings&logo=0';
export const PHAKISA_WEBSITE_URL = 'https://www.phakisaholdings.co.za/phakisa-vacancies/';
const TRUSTED_FEED_ORIGIN = new URL(PHAKISA_FEED_URL).origin;
const USER_AGENT = process.env.SCRAPER_USER_AGENT || 'SARecruitersPhakisaSync/1.0 (+https://sa-recruiters.co.za)';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href) {
  try { return new URL(href, PHAKISA_FEED_URL).toString(); } catch { return ''; }
}

function stableId(reference) {
  return `agency-${crypto.createHash('sha1').update(`Phakisa Holdings-${reference}`).digest('hex').slice(0, 20)}`;
}

function fieldText(card, selector) {
  return clean(card.find(selector).first().text());
}

export function parsePhakisaVacancies(html, now = new Date()) {
  const $ = cheerio.load(html);
  const checkedAt = now.toISOString();
  const jobs = [];
  const seenReferences = new Set();

  $('.job-spec').each((_, element) => {
    const card = $(element);
    const title = fieldText(card, '#job_spec_title .job-spec-value');
    const reference = clean(card.find('#job_spec_ref').text()).replace(/^#/, '');
    const dates = card.find('#start_date time').map((__, time) => $(time).attr('datetime') || '').get().filter(Boolean);
    const closingDate = dates[dates.length - 1] || '';
    const startDate = dates[0] || '';
    const detailHref = card.find('#job_spec_title a').attr('href') || '';
    const applyHref = card.find('#apply_button a').attr('href') || detailHref;
    const detail = clean(card.find('#description .job-spec-value').text());

    if (!title || !reference || seenReferences.has(reference) || !applyHref) return;
    seenReferences.add(reference);

    // Placement Partner publishes the closing date in the listing. Do not
    // import a position whose end date is already before today's date, while
    // retaining rows with malformed/missing dates for manual review.
    if (/^\d{4}-\d{2}-\d{2}$/.test(closingDate) && closingDate < now.toISOString().slice(0, 10)) return;

    const applyUrl = absoluteUrl(applyHref);
    if (!/^https?:\/\//i.test(applyUrl) || new URL(applyUrl).origin !== TRUSTED_FEED_ORIGIN) return;
    jobs.push({
      id: stableId(reference),
      agency_id: null,
      employer_id: null,
      title,
      company: 'Phakisa Holdings',
      company_photo: null,
      location: fieldText(card, '#location .job-spec-value'),
      link: applyUrl,
      email: '',
      phone: '+27119161737',
      remote: null,
      experience_level: '',
      employment_type: fieldText(card, '#job_spec_type .job-spec-value'),
      contract_type: '',
      work_schedule: '',
      hours: '',
      salary: fieldText(card, '#salary .job-spec-value'),
      start_date: startDate,
      closing_date: closingDate,
      notes: detail,
      source_type: 'agency',
      source_checked_at: checkedAt,
      last_verified_at: checkedAt,
    });
  });

  return jobs;
}

async function fetchFeed() {
  const response = await fetch(PHAKISA_FEED_URL, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Phakisa feed returned HTTP ${response.status}`);
  return response.text();
}

async function deleteStaleVacancies(agencyId, currentIds) {
  const { data: existing, error: readError } = await supabase
    .from('vacancies')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('source_type', 'agency')
    .limit(500);
  if (readError) throw readError;
  const staleIds = (existing || []).map((row) => row.id).filter((id) => !currentIds.has(id));
  if (!staleIds.length) return 0;
  const { error } = await supabase.from('vacancies').delete().in('id', staleIds);
  if (error) throw error;
  return staleIds.length;
}

export async function syncPhakisa() {
  if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { data: agencies, error: agencyError } = await supabase
    .from('agencies')
    .select('id,name,photo')
    .ilike('name', '%Phakisa%')
    .limit(10);
  if (agencyError) throw agencyError;
  const agency = (agencies || []).find((row) => /phakisa holdings/i.test(row.name));
  if (!agency) throw new Error('Phakisa Holdings agency record was not found');

  const html = await fetchFeed();
  const jobs = parsePhakisaVacancies(html);
  if (!jobs.length) throw new Error('Phakisa feed returned zero current vacancies; refusing to delete existing rows');

  const checkedAt = new Date().toISOString();
  const rows = jobs.map((job) => ({
    ...job,
    agency_id: agency.id,
    company_photo: agency.photo || null,
    source_checked_at: checkedAt,
    last_verified_at: checkedAt,
  }));
  const { error: upsertError } = await supabase.from('vacancies').upsert(rows, { onConflict: 'id' });
  if (upsertError) throw upsertError;
  const removed = await deleteStaleVacancies(agency.id, new Set(rows.map((row) => row.id)));
  const { error: statusError } = await supabase.from('agencies').update({
    site_vacancy_url: PHAKISA_FEED_URL,
    site_scrape_status: 'ok',
    site_scrape_reason: `Placement Partner feed: ${rows.length} current vacancies`,
    site_scraped_at: checkedAt,
  }).eq('id', agency.id);
  if (statusError) throw statusError;

  return { agency: agency.name, discovered: rows.length, upserted: rows.length, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await syncPhakisa();
  console.log(`[phakisa] completed: ${JSON.stringify(result)}`);
}

-- Agency ATS feeds and external vacancy identity for the existing D1 vacancies table.
CREATE TABLE IF NOT EXISTS agency_ats_feeds (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  feed_url TEXT,
  api_key_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_status TEXT
);

ALTER TABLE vacancies ADD COLUMN external_ref TEXT;
ALTER TABLE vacancies ADD COLUMN ats_feed_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vacancies_ats_ref
  ON vacancies(ats_feed_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_ats_feed_id
  ON vacancies(ats_feed_id);

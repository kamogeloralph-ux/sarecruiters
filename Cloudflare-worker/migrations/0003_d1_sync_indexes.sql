-- SA Recruiters — D1 sync and vacancy query indexes
-- These indexes reduce row scans for the Worker API and startup aggregates.
-- IF NOT EXISTS keeps this migration safe to re-run during rollout.

CREATE INDEX IF NOT EXISTS vacancies_source_created_id_idx
  ON vacancies (source_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS vacancies_agency_created_id_idx
  ON vacancies (agency_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS vacancies_employer_created_id_idx
  ON vacancies (employer_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS vacancies_remote_created_id_idx
  ON vacancies (remote, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS vacancies_closing_date_idx
  ON vacancies (closing_date);

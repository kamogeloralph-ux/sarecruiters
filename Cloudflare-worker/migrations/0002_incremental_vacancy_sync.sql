-- Apply with Wrangler before deploying the incremental Worker sync.
-- Existing rows use created_at as their initial watermark value.

ALTER TABLE vacancies ADD COLUMN updated_at TEXT;

UPDATE vacancies
SET updated_at = COALESCE(created_at, datetime('now'))
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS vacancies_updated_at_idx
  ON vacancies (updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS vacancies_created_at_id_idx
  ON vacancies (created_at DESC, id DESC);

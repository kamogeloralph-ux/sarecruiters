-- Supporting indexes for the Cloudflare serving layer.
-- Primary-key indexes already cover app_settings and sync_meta lookups.
-- IF NOT EXISTS makes this safe when an index was created manually already.
CREATE INDEX IF NOT EXISTS agencies_created_at_idx
  ON agencies (created_at DESC);

CREATE INDEX IF NOT EXISTS branches_name_idx
  ON branches (name ASC);

CREATE INDEX IF NOT EXISTS employers_created_at_idx
  ON employers (created_at DESC);

CREATE INDEX IF NOT EXISTS employer_posters_created_at_idx
  ON employer_posters (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS employer_posters_expires_at_idx
  ON employer_posters (expires_at);

-- Already present in production, retained here so new environments receive
-- the same status lookup optimization.
CREATE INDEX IF NOT EXISTS idx_vacancies_status
  ON vacancies (status);

-- Public poster metadata is mirrored into D1 so visitor feeds do not query Supabase directly.
CREATE TABLE IF NOT EXISTS employer_posters (
  id TEXT PRIMARY KEY,
  employer_id TEXT,
  agency_id TEXT,
  image_url TEXT,
  caption TEXT,
  vacancy_id TEXT,
  created_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS employer_posters_created_at_idx
  ON employer_posters (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS employer_posters_expires_at_idx
  ON employer_posters (expires_at);

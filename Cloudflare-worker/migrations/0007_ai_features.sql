-- AI features (Gemini). Everything the model produces is stored here once so a vacancy,
-- poster or search is processed a single time, not on every visit.

-- One row per (kind, subject, language). kind examples: poster, vacancy-summary,
-- vacancy-clean, vacancy-scam, search, interview-questions, cv-skills.
CREATE TABLE IF NOT EXISTS ai_results (
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT '',
  input_hash TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL,
  fingerprint TEXT,
  company_key TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, subject_id, lang)
);
CREATE INDEX IF NOT EXISTS ai_results_fingerprint_idx ON ai_results (kind, fingerprint);
CREATE INDEX IF NOT EXISTS ai_results_company_idx ON ai_results (kind, company_key);
CREATE INDEX IF NOT EXISTS ai_results_created_idx ON ai_results (kind, created_at);

-- Daily budget + per-user hourly limits. `day` holds a date (YYYY-MM-DD) or an hour (YYYY-MM-DDTHH).
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);

-- Admin review queue for things the AI or rules found suspicious. Nothing here is acted on
-- automatically: an admin decides.
CREATE TABLE IF NOT EXISTS ai_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('poster','vacancy','duplicate')),
  subject_id TEXT NOT NULL,
  title TEXT,
  link TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'low',
  reasons TEXT NOT NULL DEFAULT '[]',
  signals TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','confirmed')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS ai_flags_open_idx ON ai_flags (status, risk_score DESC, created_at DESC);

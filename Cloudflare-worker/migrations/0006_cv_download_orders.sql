-- Private checkout and fulfillment records for paid CV Box downloads.
-- This table is only accessed by the Worker; never include it in public startup data.
CREATE TABLE IF NOT EXISTS cv_download_orders (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  cv_url TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL CHECK (status IN ('creating','pending','paid','failed','refunded')),
  checkout_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  download_token TEXT,
  download_expires_at TEXT,
  email_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS cv_download_orders_status_created_idx
  ON cv_download_orders(status, created_at DESC);

-- House ads are served from D1 by the Worker. Creative files belong in R2/public object storage.
CREATE TABLE IF NOT EXISTS house_ads (
  id TEXT PRIMARY KEY,
  advertiser_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'home',
  target_screens TEXT NOT NULL DEFAULT '[]',
  ad_slot TEXT NOT NULL DEFAULT 'top',
  ad_format TEXT NOT NULL DEFAULT 'auto',
  ad_details TEXT NOT NULL DEFAULT '',
  cta_text TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS house_ads_active_schedule_idx
  ON house_ads (is_active, starts_at, ends_at, ad_slot, sort_order, created_at);

CREATE INDEX IF NOT EXISTS house_ads_updated_at_idx
  ON house_ads (updated_at);

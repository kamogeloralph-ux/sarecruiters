-- We Work Remotely is intrinsically a remote source. Keep that behavior explicit
-- instead of coupling the Worker to a feed ID or agency display name.
ALTER TABLE agency_ats_feeds ADD COLUMN remote_by_default INTEGER NOT NULL DEFAULT 0;

INSERT INTO agency_ats_feeds (
  id, agency_id, agency_name, feed_url, is_active, include_terms, remote_by_default
)
VALUES (
  'weworkremotely',
  'weworkremotely',
  'We Work Remotely',
  'https://weworkremotely.com/remote-jobs.rss',
  1,
  '["south africa","south african"]',
  1
)
ON CONFLICT(id) DO UPDATE SET
  agency_id = excluded.agency_id,
  agency_name = excluded.agency_name,
  feed_url = excluded.feed_url,
  is_active = excluded.is_active,
  include_terms = excluded.include_terms,
  remote_by_default = excluded.remote_by_default;

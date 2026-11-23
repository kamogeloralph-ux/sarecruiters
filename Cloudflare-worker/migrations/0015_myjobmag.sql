-- Register MyJobMag's South Africa XML feed for existing deployments.
INSERT INTO agency_ats_feeds (id, agency_id, agency_name, feed_url, is_active)
VALUES (
  'myjobmag',
  'myjobmag',
  'MyJobMag',
  'https://www.myjobmag.co.za/jobsxml.xml',
  1
)
ON CONFLICT(id) DO UPDATE SET
  agency_id = excluded.agency_id,
  agency_name = excluded.agency_name,
  feed_url = excluded.feed_url,
  is_active = excluded.is_active;

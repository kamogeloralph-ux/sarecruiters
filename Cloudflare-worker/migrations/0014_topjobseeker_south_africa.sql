-- Consolidate the four city-specific TopJob Seeker feeds into the national feed.
-- This migration is needed because 0012 may already be applied in production.
INSERT INTO agency_ats_feeds (id, agency_id, agency_name, feed_url, is_active)
VALUES (
  'topjobseeker-south-africa',
  'topjobseeker',
  'TopJob Seeker',
  'https://topjobseeker.com/?feed=job_feed&job_types=contract%2Cfreelance%2Cfull-time%2Cinternship%2Cpart-time%2Cremote%2Ctemporary%2Cvolunteer&search_location=South+Africa&job_categories&search_keywords',
  1
)
ON CONFLICT(id) DO UPDATE SET
  agency_id = excluded.agency_id,
  agency_name = excluded.agency_name,
  feed_url = excluded.feed_url,
  is_active = excluded.is_active;

-- Keep the legacy IDs for migration history, but prevent them from syncing again.
UPDATE agency_ats_feeds
SET is_active = 0
WHERE id IN (
  'topjobseeker-johannesburg',
  'topjobseeker-pretoria',
  'topjobseeker-cape-town',
  'topjobseeker-durban'
);

-- Remove only the obsolete city-feed rows; the next national sync repopulates
-- the same source with one canonical feed identity and no stale duplicates.
DELETE FROM vacancies
WHERE ats_feed_id IN (
  'topjobseeker-johannesburg',
  'topjobseeker-pretoria',
  'topjobseeker-cape-town',
  'topjobseeker-durban'
);

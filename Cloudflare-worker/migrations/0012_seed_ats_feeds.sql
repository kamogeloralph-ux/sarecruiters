-- Register the public ATS/RSS sources used by the app.
-- The IDs are stable so this migration is safe to apply more than once.
INSERT INTO agency_ats_feeds (id, agency_id, agency_name, feed_url, is_active)
VALUES
  ('topjobseeker-south-africa', 'topjobseeker', 'TopJob Seeker', 'https://topjobseeker.com/?feed=job_feed&job_types=contract%2Cfreelance%2Cfull-time%2Cinternship%2Cpart-time%2Cremote%2Ctemporary%2Cvolunteer&search_location=South+Africa&job_categories&search_keywords', 1),
  ('govposts', 'govposts', 'GovPosts', 'https://govposts.co.za/feeds/jobs.xml', 1)
ON CONFLICT(id) DO UPDATE SET
  agency_id = excluded.agency_id,
  agency_name = excluded.agency_name,
  feed_url = excluded.feed_url,
  is_active = excluded.is_active;

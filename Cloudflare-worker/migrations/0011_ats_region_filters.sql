-- Optional per-feed text filters for ATS XML items.
ALTER TABLE agency_ats_feeds ADD COLUMN include_terms TEXT;
ALTER TABLE agency_ats_feeds ADD COLUMN exclude_terms TEXT;

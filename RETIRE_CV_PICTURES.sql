-- CV Pictures were removed from the app (replaced by the Scam Check).
-- The code no longer shows, accepts or serves them, but the old pictures are still stored.
-- They can contain phone numbers and other personal details, so delete them once you are happy.
-- NOTHING here runs automatically. Read each step first.

-- 1) Supabase (SQL editor). Look before you delete:
--    SELECT count(*) AS pictures, count(employer_id) AS linked_to_an_employer FROM employer_posters;
--    If "linked_to_an_employer" is not 0, those rows belong to employers: delete only the public ones below.
--
-- DELETE FROM employer_posters WHERE employer_id IS NULL AND agency_id IS NULL;

-- 2) Cloudflare D1 (the mirror the Worker reads). Run in the D1 console for your database:
--
-- DELETE FROM employer_posters WHERE employer_id IS NULL AND agency_id IS NULL;

-- 3) Cloudflare R2: the image files are in the media bucket under the prefix  employer-posters/
--    Delete that folder from the R2 dashboard (or with `wrangler r2 object delete`) after step 1,
--    so the pictures can no longer be opened by their direct links.

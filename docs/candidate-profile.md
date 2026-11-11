# Candidate Career Profile

The Profile tab's **My career profile** hub brings together the signed-in user's existing CV Box profile, the latest private job-seeker request, CV Box screening status, and the latest AI-generated CV. The CV Box row remains the source of truth for the discoverable candidate listing; job-seeker requests remain private admin-intake records and are not converted or published automatically.

Signed-in job-seeker and new CV Box forms prefill basic details from the user's own existing records to reduce repeated entry. The job-seeker consent checkbox is intentionally reset and must be accepted for each new request.

When a candidate has not created a CV Box row yet, the form also reuses the saved CV Builder name, target role and first education entry. To add the generated document itself to the CV Box, open the saved CV in the Builder, use **Print / Save as PDF**, then attach that PDF in **Manage CV Box**; the private generated document is not silently published or used as a paid-download file.

## Enable private cloud CV saving

Apply `supabase/migrations/20261110_candidate_cv_profiles.sql` to the Supabase project before expecting the generated CV to persist across devices. The table uses owner-only row-level security. It stores only the generated CV JSON and target role; the unstructured notes sent to the AI Builder are not stored. Existing data is not rewritten by the migration.

If the migration has not been applied, CV generation still works for that session, while the app logs the save failure and tells the candidate the database migration is needed. The hub degrades gracefully when this table is unavailable.

## CV scan / review

The existing CV scan is part of the CV Box review process, not a separate candidate-side file analyzer. The hub displays the candidate's current CV Box status and explains that review is performed on the uploaded CV. It does not expose the private CV file or scanner internals to public directory users.

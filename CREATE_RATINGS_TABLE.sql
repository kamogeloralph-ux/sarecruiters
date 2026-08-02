-- ============================================================
--  SA RECRUITERS — CREATE ratings TABLE
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--  Then click "Run"
--
--  This creates the public ratings table so users can rate
--  agencies with emojis. Ratings are public (anyone can see
--  them) and anyone can submit a rating.
-- ============================================================

-- Create the ratings table
CREATE TABLE IF NOT EXISTS public.ratings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agency_id UUID NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🙂',
    name TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Policy: anyone can read all ratings (public visibility)
DROP POLICY IF EXISTS "ratings_select_all" ON public.ratings;
CREATE POLICY "ratings_select_all" ON public.ratings
    FOR SELECT USING (true);

-- Policy: anyone can insert a new rating (public can rate)
DROP POLICY IF EXISTS "ratings_insert_all" ON public.ratings;
CREATE POLICY "ratings_insert_all" ON public.ratings
    FOR INSERT WITH CHECK (true);

-- Policy: anyone can delete a rating (for admin cleanup)
DROP POLICY IF EXISTS "ratings_delete_all" ON public.ratings;
CREATE POLICY "ratings_delete_all" ON public.ratings
    FOR DELETE USING (true);

-- Policy: anyone can update a rating (for admin editing)
DROP POLICY IF EXISTS "ratings_update_all" ON public.ratings;
CREATE POLICY "ratings_update_all" ON public.ratings
    FOR UPDATE USING (true) WITH CHECK (true);

-- Add an index for faster lookups by agency
CREATE INDEX IF NOT EXISTS idx_ratings_agency_id ON public.ratings(agency_id);

-- Verify the table was created
-- SELECT * FROM public.ratings LIMIT 5;

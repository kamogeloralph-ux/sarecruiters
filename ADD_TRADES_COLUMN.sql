-- ============================================================
--  SA RECRUITERS — ADD trades COLUMN TO agencies TABLE
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--
--  The app has a "Trades / Industries" field in the agency form.
--  This script adds the `trades` column so manually entered trades
--  are saved permanently to Supabase.
--
--  IMPORTANT: The app now SENDS trades to Supabase on every save.
--  If this column does NOT exist yet, the app will detect the error,
--  retry the save WITHOUT trades (so the rest of the agency record
--  still saves), and log a console warning. Trades entered manually
--  will only persist after this column is added — so run this once.
--
--  After running this, the app will automatically start saving
--  trades data to Supabase (no further code changes needed).
-- ============================================================

-- Add the trades column (text, nullable, default empty string)
alter table public.agencies add column if not exists trades text default '';

-- Verify it was added
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'agencies'
-- order by ordinal_position;

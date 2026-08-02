-- ============================================================
--  SA RECRUITERS — ADD trades COLUMN TO agencies TABLE
-- ============================================================
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--
--  The app has a "Trades / Industries" field in the agency form
--  but the agencies table is missing the `trades` column, which
--  causes "Could not save" errors. This script adds the column.
--
--  After running this, the app will automatically start saving
--  trades data to Supabase (no code changes needed — the app
--  already strips `trades` from the payload as a safety measure
--  until this column exists, then sends it once the column is
--  present).
-- ============================================================

-- Add the trades column (text, nullable, default empty string)
alter table public.agencies add column if not exists trades text default '';

-- Verify it was added
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'agencies'
-- order by ordinal_position;

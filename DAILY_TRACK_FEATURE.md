# Daily Track — "Track of the Day" Feature

## Overview
A unique music feature that adds a "Track of the Day" player to the public app's Profile
section (below the logo), and a full track management section in the admin console where the
admin can upload an MP3 per day with edit/delete buttons.

## Public app (`index.html`)
A sleek audio player card appears in the Profile screen, directly below the logo and
"Check for updates" button:
- **Music note icon** (blue gradient tile) with animated equalizer bars when playing
- **"TRACK OF THE DAY"** label (accent color, uppercase)
- **Track title** (e.g. "Motivation Monday Mix")
- **Artist / subtitle** (e.g. "DJ Sbu")
- **Circular play/pause button** (accent color)
- **Progress bar** at the bottom of the card
- If no track is set for today: shows **"No track today — Check back tomorrow for a fresh pick"**

The player uses a standard HTML5 `<audio>` element. It loads today's track from the
`daily_tracks` Supabase table (newest track for today's date wins). If the table doesn't
exist yet, it gracefully shows the "No track today" message — no errors.

## Admin console (`admin.html`)
A new **"Daily Track"** section in the sidebar navigation with:
- **Upload track** button → opens a sheet with:
  - Track title (required)
  - Artist / subtitle
  - Date (which day this track plays — defaults to today)
  - MP3 file upload (required for new tracks; optional when editing)
- **Track list** — all tracks sorted by date (newest first), each showing:
  - Music note avatar
  - Title + a "Today" badge if the track's date is today
  - Artist + formatted date
  - **Edit** button — change title/artist/date, optionally replace the MP3
  - **Delete** button — removes the file from storage + the row from the table
- **Setup warning** — if the `daily_tracks` table or `daily-tracks` storage bucket hasn't
  been created yet, a red warning card tells the admin to run the SQL script
- **Progress indicator** during upload
- The dashboard also shows a "Daily Tracks" count

## Supabase setup (`CREATE_DAILY_TRACKS.sql`)
**You must run this SQL script once** in the Supabase SQL Editor
(Dashboard → SQL → New query → paste → Run):

1. Creates the `daily_tracks` table (id, title, artist, track_date, file_url, file_path, created_at)
2. Enables RLS with policies:
   - Public (anon) can **SELECT** tracks
   - Authenticated (admin) can **INSERT / UPDATE / DELETE** tracks
3. Creates a **public storage bucket** named `daily-tracks`
4. Adds storage RLS policies:
   - Public can **read/download** files
   - Authenticated (admin) can **upload / update / delete** files

After running the SQL:
- Log into the admin console (`admin.html`)
- Go to **Daily Track** → **Upload track**
- Choose an MP3, enter a title and date, save
- Open the public app → Profile → the track appears and plays

## How it works
1. Admin uploads an MP3 in `admin.html` → the file goes to the `daily-tracks` storage bucket
   and a row is inserted into `daily_tracks` with the public URL.
2. The public app (`index.html`) queries `daily_tracks` for today's date on load.
3. If a track exists, the player card shows it and the user can play/pause.
4. Only the **newest** track for a given date is shown (if the admin uploads multiple tracks
   for the same day, the latest one wins).

## Files
- `index.html` — track player UI + JS in Profile section
- `admin.html` — Daily Track nav item, section, upload sheet, CRUD functions
- `CREATE_DAILY_TRACKS.sql` — table + bucket + RLS setup script (run once)
- `sw.js` — cache version bumped v48 → v49

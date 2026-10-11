-- Allow Track of the Day entries to link to Spotify without requiring an MP3.
alter table public.daily_tracks
  add column if not exists spotify_url text;

alter table public.daily_tracks
  drop constraint if exists daily_tracks_spotify_url_https;

alter table public.daily_tracks
  add constraint daily_tracks_spotify_url_https
  check (spotify_url is null or spotify_url ~ '^https://(open\.)?spotify\.com/');
